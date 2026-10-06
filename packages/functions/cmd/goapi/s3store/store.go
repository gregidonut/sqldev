package s3store

import (
	"context"
	"errors"
	"io"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/bucketBasics"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/s3Actions"
)

var (
	ErrNotFound     = errors.New("object not found")
	ErrAccessDenied = errors.New("access denied")
	ErrTooLarge     = errors.New("entity too large")
	ErrInactive     = errors.New("object is not in an active tier")
)

type Opened struct {
	Body          io.ReadCloser
	ContentLength int64
	ContentType   string
}

type Store struct {
	client  *s3.Client
	presign *s3.PresignClient
	basics  bucketBasics.BucketBasics
	actions s3Actions.S3Actions
}

func New(ctx context.Context) (*Store, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion("ap-east-1"))
	if err != nil {
		return nil, err
	}
	client := s3.NewFromConfig(cfg)
	return &Store{
		client:  client,
		presign: s3.NewPresignClient(client),
		basics:  bucketBasics.BucketBasics{S3Client: client},
		actions: s3Actions.S3Actions{S3Client: client},
	}, nil
}

func (s *Store) BucketExists(ctx context.Context, bucket string) (bool, error) {
	return s.basics.BucketExists(ctx, bucket)
}

func (s *Store) Upload(ctx context.Context, bucket, key string, body io.Reader, size int64) error {
	err := s.basics.UploadFromReader(ctx, bucket, key, body, size)
	return mapS3Error(err)
}

func (s *Store) Open(ctx context.Context, bucket, key string) (Opened, error) {
	result, err := s.basics.GetObject(ctx, bucket, key)
	if err != nil {
		return Opened{}, mapS3Error(err)
	}
	contentType := ""
	if result.ContentType != nil {
		contentType = *result.ContentType
	}
	return Opened{
		Body:          result.Body,
		ContentLength: aws.ToInt64(result.ContentLength),
		ContentType:   contentType,
	}, nil
}

func (s *Store) Delete(ctx context.Context, bucket, key, versionID string, bypass bool) error {
	return mapS3Error(s.actions.DeleteObject(ctx, bucket, key, versionID, bypass))
}

func (s *Store) DeleteMany(ctx context.Context, bucket string, keys []string, bypass bool) error {
	return mapS3Error(s.basics.DeleteObjects(ctx, bucket, keys, bypass))
}

func (s *Store) Copy(ctx context.Context, sourceBucket, destinationBucket, sourceKey, destinationKey string) error {
	return mapS3Error(s.basics.CopyObject(ctx, sourceBucket, destinationBucket, sourceKey, destinationKey))
}

func (s *Store) Exists(ctx context.Context, bucket, key string) (bool, error) {
	_, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	if err == nil {
		return true, nil
	}
	if isMissing(err) {
		return false, nil
	}
	return false, mapS3Error(err)
}

func (s *Store) PresignPut(ctx context.Context, bucket, key string) (string, error) {
	signed, err := s.presign.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	}, func(options *s3.PresignOptions) {
		options.Expires = 15 * time.Minute
	})
	if err != nil {
		return "", mapS3Error(err)
	}
	return signed.URL, nil
}

func mapS3Error(err error) error {
	if err == nil {
		return nil
	}
	if isMissing(err) {
		return ErrNotFound
	}
	var inactive *types.ObjectNotInActiveTierError
	if errors.As(err, &inactive) {
		return ErrInactive
	}
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.ErrorCode() {
		case "AccessDenied":
			return ErrAccessDenied
		case "EntityTooLarge":
			return ErrTooLarge
		case "NotFound", "NoSuchKey", "NoSuchBucket":
			return ErrNotFound
		}
	}
	return err
}

func isMissing(err error) bool {
	var noKey *types.NoSuchKey
	var notFound *types.NotFound
	var noBucket *types.NoSuchBucket
	return errors.As(err, &noKey) || errors.As(err, &notFound) || errors.As(err, &noBucket)
}
