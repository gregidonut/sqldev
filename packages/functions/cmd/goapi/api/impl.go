package api

import "context"

type Server struct{}

func (s Server) ListBuckets(ctx context.Context, request ListBucketsRequestObject) (ListBucketsResponseObject, error) {
	//TODO implement me
	panic("implement me")
}

func (s Server) CreateBucket(ctx context.Context, request CreateBucketRequestObject) (CreateBucketResponseObject, error) {
	//TODO implement me
	panic("implement me")
}

func (s Server) DeleteBucket(ctx context.Context, request DeleteBucketRequestObject) (DeleteBucketResponseObject, error) {
	//TODO implement me
	panic("implement me")
}

func (s Server) BucketExists(ctx context.Context, request BucketExistsRequestObject) (BucketExistsResponseObject, error) {
	//TODO implement me
	panic("implement me")
}

func (s Server) DeleteObjects(ctx context.Context, request DeleteObjectsRequestObject) (DeleteObjectsResponseObject, error) {
	//TODO implement me
	panic("implement me")
}

func (s Server) ListObjects(ctx context.Context, request ListObjectsRequestObject) (ListObjectsResponseObject, error) {
	//TODO implement me
	panic("implement me")
}

func (s Server) UploadObject(ctx context.Context, request UploadObjectRequestObject) (UploadObjectResponseObject, error) {
	//TODO implement me
	panic("implement me")
}

func (s Server) DeleteSingleObject(ctx context.Context, request DeleteSingleObjectRequestObject) (DeleteSingleObjectResponseObject, error) {
	//TODO implement me
	panic("implement me")
}

func (s Server) DownloadObject(ctx context.Context, request DownloadObjectRequestObject) (DownloadObjectResponseObject, error) {
	//TODO implement me
	panic("implement me")
}

func (s Server) CopyObject(ctx context.Context, request CopyObjectRequestObject) (CopyObjectResponseObject, error) {
	//TODO implement me
	panic("implement me")
}
