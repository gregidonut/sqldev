package result

import (
	"bytes"
	"context"
	"errors"
	"io"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

var ErrNotFound = errors.New("result not found")

const maxPresignExpiry = 15 * time.Minute

type Store interface {
	Put(ctx context.Context, key string, body []byte) error
	PutObject(ctx context.Context, key, contentType string, body []byte) error
	Get(ctx context.Context, key string) ([]byte, error)
	PresignGet(ctx context.Context, key, contentType string, expires time.Duration) (string, error)
}

type S3 struct {
	bucket  string
	client  *s3.Client
	presign *s3.PresignClient
}

func NewS3(ctx context.Context, bucket string) (*S3, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion("ap-east-1"))
	if err != nil {
		return nil, err
	}
	client := s3.NewFromConfig(cfg)
	return &S3{bucket: bucket, client: client, presign: s3.NewPresignClient(client)}, nil
}

func (s *S3) Put(ctx context.Context, key string, body []byte) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
		Body:   bytes.NewReader(body),
	})
	return err
}

func (s *S3) PutObject(ctx context.Context, key, contentType string, body []byte) error {
	if !allowedImageType(contentType) {
		return errors.New("result content type is not an image")
	}
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(body),
		ContentType: aws.String(contentType),
	})
	return err
}

func (s *S3) Get(ctx context.Context, key string) ([]byte, error) {
	output, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, err
	}
	defer output.Body.Close()
	return io.ReadAll(io.LimitReader(output.Body, 8<<20))
}

func (s *S3) PresignGet(ctx context.Context, key, contentType string, expires time.Duration) (string, error) {
	if !allowedImageType(contentType) {
		return "", errors.New("result content type is not an image")
	}
	if expires <= 0 || expires > maxPresignExpiry {
		return "", errors.New("presign expiry is outside the allowed range")
	}
	signed, err := s.presign.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket:              aws.String(s.bucket),
		Key:                 aws.String(key),
		ResponseContentType: aws.String(contentType),
	}, func(options *s3.PresignOptions) {
		options.Expires = expires
	})
	if err != nil {
		return "", err
	}
	return signed.URL, nil
}

func allowedImageType(contentType string) bool {
	switch contentType {
	case "image/jpeg", "image/png", "image/webp":
		return true
	default:
		return false
	}
}
