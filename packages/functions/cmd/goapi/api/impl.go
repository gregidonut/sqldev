package api

import (
	"context"
	"errors"
	"io"
	"mime/multipart"
	"strconv"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/bucketBasics"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/s3Actions"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/utils"
)

type Server struct{}

func (s Server) BucketExists(ctx context.Context, request BucketExistsRequestObject) (BucketExistsResponseObject, error) {
	client, err := s3Actions.NewS3Client(ctx)
	if err != nil {
		return nil, err
	}

	exists, err := bucketBasics.BucketBasics{S3Client: client}.BucketExists(ctx, request.BucketName)
	if err != nil {
		return nil, err
	}
	if !exists {
		return BucketExists404Response{}, nil
	}
	return BucketExists200Response{}, nil
}

func (s Server) DeleteObjects(ctx context.Context, request DeleteObjectsRequestObject) (DeleteObjectsResponseObject, error) {
	if request.Body == nil || len(request.Body.Keys) == 0 {
		return DeleteObjects200Response{}, nil
	}

	keys := make([]string, 0, len(request.Body.Keys))
	for _, ref := range request.Body.Keys {
		key, err := resolveObjectKeyFromRef(ref)
		if err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}

	client, err := s3Actions.NewS3Client(ctx)
	if err != nil {
		return nil, err
	}

	bypass := request.Params.BypassGovernance != nil && *request.Params.BypassGovernance
	err = bucketBasics.BucketBasics{S3Client: client}.DeleteObjects(ctx, request.BucketName, keys, bypass)
	if err != nil {
		var noBucket *types.NoSuchBucket
		if errors.As(err, &noBucket) {
			return DeleteObjects404Response{}, nil
		}
		return nil, err
	}
	return DeleteObjects200Response{}, nil
}

func (s Server) ListObjects(ctx context.Context, request ListObjectsRequestObject) (ListObjectsResponseObject, error) {
	client, err := s3Actions.NewS3Client(ctx)
	if err != nil {
		return nil, err
	}

	objects, err := bucketBasics.BucketBasics{S3Client: client}.ListObjects(ctx, request.BucketName)
	if err != nil {
		var noBucket *types.NoSuchBucket
		if errors.As(err, &noBucket) {
			return ListObjects404Response{}, nil
		}
		return nil, err
	}

	response := make(ListObjects200JSONResponse, len(objects))
	for i, object := range objects {
		size := int(aws.ToInt64(object.Size))
		response[i] = S3Object{
			Key:          object.Key,
			Size:         &size,
			LastModified: object.LastModified,
			ETag:         object.ETag,
		}
	}
	return response, nil
}

func (s Server) UploadObject(ctx context.Context, request UploadObjectRequestObject) (UploadObjectResponseObject, error) {
	objectKey, err := resolveObjectKeyFromQueryParams(
		request.Params.UserId,
		request.Params.StorageObjectId,
		request.Params.StorageObjectDataId,
		request.Params.FileName,
	)
	if err != nil {
		return nil, err
	}
	if request.Body == nil {
		return nil, errors.New("multipart body is required")
	}

	filePart, size, err := multipartFilePart(request.Body)
	if err != nil {
		return nil, err
	}
	defer filePart.Close()

	client, err := s3Actions.NewS3Client(ctx)
	if err != nil {
		return nil, err
	}

	err = bucketBasics.BucketBasics{S3Client: client}.UploadFromReader(
		ctx, request.BucketName, objectKey, filePart, size,
	)
	if err != nil {
		var apiErr smithy.APIError
		if errors.As(err, &apiErr) && apiErr.ErrorCode() == "EntityTooLarge" {
			return UploadObject413Response{}, nil
		}
		return nil, err
	}
	return UploadObject200Response{}, nil
}

func (s Server) DeleteSingleObject(ctx context.Context, request DeleteSingleObjectRequestObject) (DeleteSingleObjectResponseObject, error) {
	objectKey, err := resolveObjectKeyFromQueryParams(
		request.Params.UserId,
		request.Params.StorageObjectId,
		request.Params.StorageObjectDataId,
		request.Params.FileName,
	)
	if err != nil {
		return nil, err
	}

	client, err := s3Actions.NewS3Client(ctx)
	if err != nil {
		return nil, err
	}

	versionID := ""
	if request.Params.VersionId != nil {
		versionID = *request.Params.VersionId
	}
	bypass := request.Params.BypassGovernance != nil && *request.Params.BypassGovernance

	err = s3Actions.S3Actions{S3Client: client}.DeleteObject(
		ctx, request.BucketName, objectKey, versionID, bypass,
	)
	if err != nil {
		var apiErr smithy.APIError
		if errors.As(err, &apiErr) && apiErr.ErrorCode() == "AccessDenied" {
			return DeleteSingleObject403Response{}, nil
		}
		return DeleteSingleObject204Response{}, nil
	}
	return DeleteSingleObject204Response{}, nil
}

func (s Server) DownloadObject(ctx context.Context, request DownloadObjectRequestObject) (DownloadObjectResponseObject, error) {
	objectKey, err := resolveObjectKeyFromQueryParams(
		request.Params.UserId,
		request.Params.StorageObjectId,
		request.Params.StorageObjectDataId,
		request.Params.FileName,
	)
	if err != nil {
		return nil, err
	}

	client, err := s3Actions.NewS3Client(ctx)
	if err != nil {
		return nil, err
	}

	result, err := bucketBasics.BucketBasics{S3Client: client}.GetObject(ctx, request.BucketName, objectKey)
	if err != nil {
		var noKey *types.NoSuchKey
		if errors.As(err, &noKey) {
			return DownloadObject404Response{}, nil
		}
		return nil, err
	}

	return utils.DownloadObjectResponse{
		Body:          result.Body,
		ContentLength: aws.ToInt64(result.ContentLength),
		ContentType:   utils.ContentTypeForObject(request.Params.FileName, result.ContentType),
		Filename:      utils.ObjectFilename(request.Params.FileName),
	}, nil
}

func (s Server) CopyObject(ctx context.Context, request CopyObjectRequestObject) (CopyObjectResponseObject, error) {
	if request.Body == nil {
		return nil, errors.New("request body is required")
	}

	sourceKey, err := resolveObjectKeyFromQueryParams(
		request.Params.UserId,
		request.Params.StorageObjectId,
		request.Params.StorageObjectDataId,
		request.Params.FileName,
	)
	if err != nil {
		return nil, err
	}

	destinationKey, err := resolveObjectKeyFromCopyDestination(*request.Body)
	if err != nil {
		return nil, err
	}

	client, err := s3Actions.NewS3Client(ctx)
	if err != nil {
		return nil, err
	}

	err = bucketBasics.BucketBasics{S3Client: client}.CopyObject(
		ctx,
		request.BucketName,
		request.Body.DestinationBucket,
		sourceKey,
		destinationKey,
	)
	if err != nil {
		var notActive *types.ObjectNotInActiveTierError
		if errors.As(err, &notActive) {
			return CopyObject409Response{}, nil
		}
		return nil, err
	}
	return CopyObject200Response{}, nil
}

func multipartFilePart(reader *multipart.Reader) (io.ReadCloser, int64, error) {
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			return nil, 0, errors.New("file part not found")
		}
		if err != nil {
			return nil, 0, err
		}
		if part.FormName() != "file" {
			part.Close()
			continue
		}

		// multipart.Part has no Size field; Content-Length is optional on parts.
		size := int64(-1)
		if cl := part.Header.Get("Content-Length"); cl != "" {
			if n, parseErr := strconv.ParseInt(cl, 10, 64); parseErr == nil {
				size = n
			}
		}
		return part, size, nil
	}
}
