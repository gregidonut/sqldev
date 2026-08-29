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
)

type Server struct{}

func (s Server) BucketExists(ctx context.Context, request BucketExistsRequestObject) (BucketExistsResponseObject, error) {
	client, err := newS3Client(ctx)
	if err != nil {
		return nil, err
	}

	exists, err := BucketBasics{S3Client: client}.BucketExists(ctx, request.BucketName)
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

	client, err := newS3Client(ctx)
	if err != nil {
		return nil, err
	}

	bypass := request.Params.BypassGovernance != nil && *request.Params.BypassGovernance
	err = BucketBasics{S3Client: client}.DeleteObjects(ctx, request.BucketName, request.Body.Keys, bypass)
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
	client, err := newS3Client(ctx)
	if err != nil {
		return nil, err
	}

	objects, err := BucketBasics{S3Client: client}.ListObjects(ctx, request.BucketName)
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
	if request.Params.Key == "" {
		return nil, errors.New("key query parameter is required")
	}
	if request.Body == nil {
		return nil, errors.New("multipart body is required")
	}

	filePart, size, err := multipartFilePart(request.Body)
	if err != nil {
		return nil, err
	}
	defer filePart.Close()

	client, err := newS3Client(ctx)
	if err != nil {
		return nil, err
	}

	err = BucketBasics{S3Client: client}.UploadFromReader(
		ctx, request.BucketName, request.Params.Key, filePart, size,
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
	client, err := newS3Client(ctx)
	if err != nil {
		return nil, err
	}

	versionID := ""
	if request.Params.VersionId != nil {
		versionID = *request.Params.VersionId
	}
	bypass := request.Params.BypassGovernance != nil && *request.Params.BypassGovernance

	err = S3Actions{S3Client: client}.DeleteObject(
		ctx, request.BucketName, request.Params.Key, versionID, bypass,
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
	client, err := newS3Client(ctx)
	if err != nil {
		return nil, err
	}

	result, err := BucketBasics{S3Client: client}.GetObject(ctx, request.BucketName, request.Params.Key)
	if err != nil {
		var noKey *types.NoSuchKey
		if errors.As(err, &noKey) {
			return DownloadObject404Response{}, nil
		}
		return nil, err
	}

	return downloadObjectResponse{
		Body:          result.Body,
		ContentLength: aws.ToInt64(result.ContentLength),
		ContentType:   contentTypeForObject(request.Params.Key, result.ContentType),
		Filename:      objectFilename(request.Params.Key),
	}, nil
}

func (s Server) CopyObject(ctx context.Context, request CopyObjectRequestObject) (CopyObjectResponseObject, error) {
	if request.Body == nil {
		return nil, errors.New("request body is required")
	}

	client, err := newS3Client(ctx)
	if err != nil {
		return nil, err
	}

	err = BucketBasics{S3Client: client}.CopyObject(
		ctx,
		request.BucketName,
		request.Body.DestinationBucket,
		request.Params.Key,
		request.Body.DestinationKey,
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
