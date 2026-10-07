package api

import (
	"context"
	"net/http"

	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/utils"
	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
)

func (s *Server) BucketExists(ctx context.Context, request BucketExistsRequestObject) (BucketExistsResponseObject, error) {
	if err := s.sameBucket(request.BucketName); err != nil {
		return bucketFailure(err), nil
	}
	receipt, err := s.submit(ctx, jobs.KindBucketExists, map[string]string{"bucket": request.BucketName}, "")
	if err != nil {
		return bucketFailure(err), nil
	}
	return BucketExists202JSONResponse{JobAcceptedJSONResponse: JobAcceptedJSONResponse(receipt)}, nil
}

func (s *Server) ListStorageObjects(ctx context.Context, request ListStorageObjectsRequestObject) (ListStorageObjectsResponseObject, error) {
	if err := s.sameBucket(request.BucketName); err != nil {
		return listStorageFailure(err), nil
	}
	if !request.Params.Tab.Valid() {
		return listStorageFailure(errBadRequest), nil
	}
	receipt, err := s.submit(ctx, jobs.KindListStorage, map[string]any{
		"bucket": request.BucketName,
		"tab":    request.Params.Tab,
	}, "")
	if err != nil {
		return listStorageFailure(err), nil
	}
	return ListStorageObjects202JSONResponse{JobAcceptedJSONResponse: JobAcceptedJSONResponse(receipt)}, nil
}

func (s *Server) PresignObject(ctx context.Context, request PresignObjectRequestObject) (PresignObjectResponseObject, error) {
	if err := s.sameBucket(request.BucketName); err != nil {
		return presignFailure(err), nil
	}
	if request.Params.FileName == "" {
		return presignFailure(errBadRequest), nil
	}
	receipt, err := s.submit(ctx, jobs.KindPresign, map[string]string{
		"bucket":   request.BucketName,
		"fileName": request.Params.FileName,
	}, request.Params.IdempotencyKey)
	if err != nil {
		return presignFailure(err), nil
	}
	return PresignObject202JSONResponse{JobAcceptedJSONResponse: JobAcceptedJSONResponse(receipt)}, nil
}

func (s *Server) CommitObject(ctx context.Context, request CommitObjectRequestObject) (CommitObjectResponseObject, error) {
	if err := s.sameBucket(request.BucketName); err != nil {
		return commitFailure(err), nil
	}
	if request.Body == nil {
		return commitFailure(errBadRequest), nil
	}
	receipt, err := s.submit(ctx, jobs.KindCommit, map[string]any{
		"bucket":  request.BucketName,
		"pending": PendingUpload(*request.Body),
	}, request.Params.IdempotencyKey)
	if err != nil {
		return commitFailure(err), nil
	}
	return CommitObject202JSONResponse{JobAcceptedJSONResponse: JobAcceptedJSONResponse(receipt)}, nil
}

func (s *Server) AbortObject(ctx context.Context, request AbortObjectRequestObject) (AbortObjectResponseObject, error) {
	if err := s.sameBucket(request.BucketName); err != nil {
		return abortFailure(err), nil
	}
	if request.Body == nil {
		return abortFailure(errBadRequest), nil
	}
	receipt, err := s.submit(ctx, jobs.KindAbort, map[string]any{
		"bucket":  request.BucketName,
		"pending": PendingUpload(*request.Body),
	}, request.Params.IdempotencyKey)
	if err != nil {
		return abortFailure(err), nil
	}
	return AbortObject202JSONResponse{JobAcceptedJSONResponse: JobAcceptedJSONResponse(receipt)}, nil
}

func (s *Server) DownloadObject(ctx context.Context, request DownloadObjectRequestObject) (DownloadObjectResponseObject, error) {
	if err := s.sameBucket(request.BucketName); err != nil {
		return downloadFailure(err), nil
	}
	if _, err := utils.ParseObjectKey(request.Params.Key); err != nil {
		return downloadFailure(errBadRequest), nil
	}
	receipt, err := s.submit(ctx, jobs.KindDownload, map[string]string{
		"bucket": request.BucketName,
		"key":    request.Params.Key,
	}, "")
	if err != nil {
		return downloadFailure(err), nil
	}
	return DownloadObject202JSONResponse{JobAcceptedJSONResponse: JobAcceptedJSONResponse(receipt)}, nil
}

func (s *Server) CopyObject(ctx context.Context, request CopyObjectRequestObject) (CopyObjectResponseObject, error) {
	if err := s.sameBucket(request.BucketName); err != nil {
		return copyFailure(err), nil
	}
	if request.Body == nil {
		return copyFailure(errBadRequest), nil
	}
	if err := s.sameBucket(request.Body.DestinationBucket); err != nil {
		return copyFailure(err), nil
	}
	if _, err := utils.ParseObjectKey(request.Params.Key); err != nil {
		return copyFailure(errBadRequest), nil
	}
	receipt, err := s.submit(ctx, jobs.KindCopy, map[string]string{
		"bucket":              request.BucketName,
		"key":                 request.Params.Key,
		"destinationBucket":   request.Body.DestinationBucket,
		"destinationFileName": request.Body.DestinationFileName,
	}, request.Params.IdempotencyKey)
	if err != nil {
		return copyFailure(err), nil
	}
	return CopyObject202JSONResponse{JobAcceptedJSONResponse: JobAcceptedJSONResponse(receipt)}, nil
}

func (s *Server) DeleteSingleObject(ctx context.Context, request DeleteSingleObjectRequestObject) (DeleteSingleObjectResponseObject, error) {
	if err := s.sameBucket(request.BucketName); err != nil {
		return deleteOneFailure(err), nil
	}
	if _, err := utils.ParseObjectKey(request.Params.Key); err != nil {
		return deleteOneFailure(errBadRequest), nil
	}
	versionID := ""
	if request.Params.VersionId != nil {
		versionID = *request.Params.VersionId
	}
	bypass := request.Params.BypassGovernance != nil && *request.Params.BypassGovernance
	receipt, err := s.submit(ctx, jobs.KindDeleteObject, map[string]any{
		"bucket":    request.BucketName,
		"key":       request.Params.Key,
		"versionId": versionID,
		"bypass":    bypass,
	}, request.Params.IdempotencyKey)
	if err != nil {
		return deleteOneFailure(err), nil
	}
	return DeleteSingleObject202JSONResponse{JobAcceptedJSONResponse: JobAcceptedJSONResponse(receipt)}, nil
}

func (s *Server) DeleteObjects(ctx context.Context, request DeleteObjectsRequestObject) (DeleteObjectsResponseObject, error) {
	if err := s.sameBucket(request.BucketName); err != nil {
		return deleteManyFailure(err), nil
	}
	if request.Body == nil {
		return deleteManyFailure(errBadRequest), nil
	}
	for _, key := range uniqueKeys(request.Body.Keys) {
		if _, err := utils.ParseObjectKey(key); err != nil {
			return deleteManyFailure(errBadRequest), nil
		}
	}
	bypass := request.Params.BypassGovernance != nil && *request.Params.BypassGovernance
	receipt, err := s.submit(ctx, jobs.KindDeleteObjects, map[string]any{
		"bucket": request.BucketName,
		"keys":   request.Body.Keys,
		"bypass": bypass,
	}, request.Params.IdempotencyKey)
	if err != nil {
		return deleteManyFailure(err), nil
	}
	return DeleteObjects202JSONResponse{JobAcceptedJSONResponse: JobAcceptedJSONResponse(receipt)}, nil
}

func (s *Server) commitPrepared(ctx context.Context, jwt, userID string, pending PendingUpload) error {
	if err := validatePending(userID, pending); err != nil {
		return err
	}
	exists, err := s.Objects.Exists(ctx, s.Bucket, pending.S3ObjectKey)
	if err != nil {
		return err
	}
	if !exists {
		s.abortPending(ctx, jwt, pending)
		return errConflict
	}
	if _, err := s.DB.RPC(ctx, jwt, "commit_d_storage_upload", commitArgs(pending)); err != nil {
		s.deleteObjectBestEffort(ctx, pending.S3ObjectKey)
		s.abortPending(ctx, jwt, pending)
		return err
	}
	return nil
}

func uniqueKeys(keys []string) []string {
	seen := make(map[string]struct{}, len(keys))
	unique := make([]string, 0, len(keys))
	for _, key := range keys {
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		unique = append(unique, key)
	}
	return unique
}

func bucketFailure(err error) BucketExistsResponseObject {
	status, message := classify(err)
	switch status {
	case http.StatusUnauthorized:
		return BucketExists401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	case http.StatusForbidden:
		return BucketExists403JSONResponse{ForbiddenJSONResponse: ForbiddenJSONResponse{Message: message}}
	default:
		return BucketExists500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
	}
}

func listStorageFailure(err error) ListStorageObjectsResponseObject {
	status, message := classify(err)
	switch status {
	case http.StatusUnauthorized:
		return ListStorageObjects401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	case http.StatusForbidden:
		return ListStorageObjects403JSONResponse{ForbiddenJSONResponse: ForbiddenJSONResponse{Message: message}}
	case http.StatusBadRequest:
		return ListStorageObjects400JSONResponse{BadRequestJSONResponse: BadRequestJSONResponse{Message: message}}
	default:
		return ListStorageObjects500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
	}
}

func presignFailure(err error) PresignObjectResponseObject {
	status, message := classify(err)
	switch status {
	case http.StatusUnauthorized:
		return PresignObject401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	case http.StatusForbidden:
		return PresignObject403JSONResponse{ForbiddenJSONResponse: ForbiddenJSONResponse{Message: message}}
	case http.StatusBadRequest:
		return PresignObject400JSONResponse{BadRequestJSONResponse: BadRequestJSONResponse{Message: message}}
	default:
		return PresignObject500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
	}
}

func commitFailure(err error) CommitObjectResponseObject {
	status, message := classify(err)
	switch status {
	case http.StatusUnauthorized:
		return CommitObject401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	case http.StatusForbidden:
		return CommitObject403JSONResponse{ForbiddenJSONResponse: ForbiddenJSONResponse{Message: message}}
	case http.StatusBadRequest:
		return CommitObject400JSONResponse{BadRequestJSONResponse: BadRequestJSONResponse{Message: message}}
	case http.StatusConflict:
		return CommitObject409JSONResponse{ConflictJSONResponse: ConflictJSONResponse{Message: message}}
	default:
		return CommitObject500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
	}
}

func abortFailure(err error) AbortObjectResponseObject {
	status, message := classify(err)
	switch status {
	case http.StatusUnauthorized:
		return AbortObject401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	case http.StatusForbidden:
		return AbortObject403JSONResponse{ForbiddenJSONResponse: ForbiddenJSONResponse{Message: message}}
	case http.StatusBadRequest:
		return AbortObject400JSONResponse{BadRequestJSONResponse: BadRequestJSONResponse{Message: message}}
	default:
		return AbortObject500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
	}
}

func downloadFailure(err error) DownloadObjectResponseObject {
	status, message := classify(err)
	switch status {
	case http.StatusUnauthorized:
		return DownloadObject401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	case http.StatusForbidden:
		return DownloadObject403JSONResponse{ForbiddenJSONResponse: ForbiddenJSONResponse{Message: message}}
	case http.StatusBadRequest:
		return DownloadObject400JSONResponse{BadRequestJSONResponse: BadRequestJSONResponse{Message: message}}
	case http.StatusNotFound:
		return DownloadObject404Response{}
	default:
		return DownloadObject500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
	}
}

func copyFailure(err error) CopyObjectResponseObject {
	status, message := classify(err)
	switch status {
	case http.StatusUnauthorized:
		return CopyObject401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	case http.StatusForbidden:
		return CopyObject403JSONResponse{ForbiddenJSONResponse: ForbiddenJSONResponse{Message: message}}
	case http.StatusBadRequest:
		return CopyObject400JSONResponse{BadRequestJSONResponse: BadRequestJSONResponse{Message: message}}
	case http.StatusConflict:
		return CopyObject409JSONResponse{ConflictJSONResponse: ConflictJSONResponse{Message: message}}
	default:
		return CopyObject500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
	}
}

func deleteOneFailure(err error) DeleteSingleObjectResponseObject {
	status, message := classify(err)
	switch status {
	case http.StatusUnauthorized:
		return DeleteSingleObject401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	case http.StatusForbidden:
		return DeleteSingleObject403JSONResponse{ForbiddenJSONResponse: ForbiddenJSONResponse{Message: message}}
	case http.StatusBadRequest:
		return DeleteSingleObject400JSONResponse{BadRequestJSONResponse: BadRequestJSONResponse{Message: message}}
	default:
		return DeleteSingleObject500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
	}
}

func deleteManyFailure(err error) DeleteObjectsResponseObject {
	status, message := classify(err)
	switch status {
	case http.StatusUnauthorized:
		return DeleteObjects401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	case http.StatusForbidden:
		return DeleteObjects403JSONResponse{ForbiddenJSONResponse: ForbiddenJSONResponse{Message: message}}
	case http.StatusBadRequest:
		return DeleteObjects400JSONResponse{BadRequestJSONResponse: BadRequestJSONResponse{Message: message}}
	default:
		return DeleteObjects500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
	}
}
