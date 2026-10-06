package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"

	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/utils"
)

func (s *Server) BucketExists(ctx context.Context, request BucketExistsRequestObject) (BucketExistsResponseObject, error) {
	if _, _, err := s.caller(ctx); err != nil {
		return bucketFailure(err), nil
	}
	if err := s.sameBucket(request.BucketName); err != nil {
		return bucketFailure(err), nil
	}
	exists, err := s.Objects.BucketExists(ctx, request.BucketName)
	if err != nil {
		return bucketFailure(err), nil
	}
	if !exists {
		return BucketExists404Response{}, nil
	}
	return BucketExists200Response{}, nil
}

func (s *Server) ListStorageObjects(ctx context.Context, request ListStorageObjectsRequestObject) (ListStorageObjectsResponseObject, error) {
	token, _, err := s.caller(ctx)
	if err != nil {
		return listStorageFailure(err), nil
	}
	if err := s.sameBucket(request.BucketName); err != nil {
		return listStorageFailure(err), nil
	}
	if !request.Params.Tab.Valid() {
		return listStorageFailure(errBadRequest), nil
	}
	raw, err := s.DB.RPC(ctx, token, "get_d_storage_objects", map[string]any{
		"p_tab": string(request.Params.Tab),
	})
	if err != nil {
		return listStorageFailure(err), nil
	}
	var rows []StorageObjectRow
	if err := json.Unmarshal(raw, &rows); err != nil {
		return listStorageFailure(err), nil
	}
	visible := make([]StorageObjectRow, 0, len(rows))
	for _, row := range rows {
		if row.S3ObjectKey == nil || *row.S3ObjectKey == "" {
			continue
		}
		visible = append(visible, row)
	}
	return ListStorageObjects200JSONResponse(visible), nil
}

func (s *Server) PresignObject(ctx context.Context, request PresignObjectRequestObject) (PresignObjectResponseObject, error) {
	token, _, err := s.caller(ctx)
	if err != nil {
		return presignFailure(err), nil
	}
	if err := s.sameBucket(request.BucketName); err != nil {
		return presignFailure(err), nil
	}
	prepared, err := s.prepareUpload(ctx, token, request.Params.FileName)
	if err != nil {
		return presignFailure(err), nil
	}
	pending, err := pendingFrom(prepared)
	if err != nil {
		return presignFailure(err), nil
	}
	signed, err := s.Objects.PresignPut(ctx, s.Bucket, pending.S3ObjectKey)
	if err != nil {
		s.abortPending(ctx, token, pending)
		return presignFailure(err), nil
	}
	return PresignObject200JSONResponse{
		Url:           signed,
		Key:           pending.S3ObjectKey,
		PendingUpload: pending,
	}, nil
}

func (s *Server) CommitObject(ctx context.Context, request CommitObjectRequestObject) (CommitObjectResponseObject, error) {
	token, userID, err := s.caller(ctx)
	if err != nil {
		return commitFailure(err), nil
	}
	if err := s.sameBucket(request.BucketName); err != nil {
		return commitFailure(err), nil
	}
	if request.Body == nil {
		return commitFailure(errBadRequest), nil
	}
	pending := PendingUpload(*request.Body)
	if err := s.commitPrepared(ctx, token, userID, pending); err != nil {
		return commitFailure(err), nil
	}
	return CommitObject204Response{}, nil
}

func (s *Server) AbortObject(ctx context.Context, request AbortObjectRequestObject) (AbortObjectResponseObject, error) {
	token, userID, err := s.caller(ctx)
	if err != nil {
		return abortFailure(err), nil
	}
	if err := s.sameBucket(request.BucketName); err != nil {
		return abortFailure(err), nil
	}
	if request.Body == nil {
		return abortFailure(errBadRequest), nil
	}
	pending := PendingUpload(*request.Body)
	if err := validatePending(userID, pending); err != nil {
		return abortFailure(err), nil
	}
	if _, err := s.DB.RPC(ctx, token, "abort_d_storage_upload", abortArgs(pending)); err != nil {
		return abortFailure(err), nil
	}
	return AbortObject204Response{}, nil
}

func (s *Server) UploadObject(ctx context.Context, request UploadObjectRequestObject) (UploadObjectResponseObject, error) {
	token, userID, err := s.caller(ctx)
	if err != nil {
		return uploadFailure(err), nil
	}
	if err := s.sameBucket(request.BucketName); err != nil {
		return uploadFailure(err), nil
	}
	prepared, err := s.prepareUpload(ctx, token, request.Params.FileName)
	if err != nil {
		return uploadFailure(err), nil
	}
	pending, err := pendingFrom(prepared)
	if err != nil {
		return uploadFailure(err), nil
	}
	file, size, err := filePart(request.Body)
	if err != nil {
		s.abortPending(ctx, token, pending)
		return uploadFailure(err), nil
	}
	defer file.Close()
	if err := s.Objects.Upload(ctx, s.Bucket, pending.S3ObjectKey, file, size); err != nil {
		s.abortPending(ctx, token, pending)
		return uploadFailure(err), nil
	}
	if err := s.commitPrepared(ctx, token, userID, pending); err != nil {
		return uploadFailure(err), nil
	}
	return UploadObject200Response{}, nil
}

func (s *Server) DownloadObject(ctx context.Context, request DownloadObjectRequestObject) (DownloadObjectResponseObject, error) {
	token, userID, err := s.caller(ctx)
	if err != nil {
		return downloadFailure(err), nil
	}
	if err := s.sameBucket(request.BucketName); err != nil {
		return downloadFailure(err), nil
	}
	parts, err := utils.ParseObjectKey(request.Params.Key)
	if err != nil {
		return downloadFailure(errBadRequest), nil
	}
	row, found, err := s.lookupKey(ctx, token, request.Params.Key)
	if err != nil {
		return downloadFailure(err), nil
	}
	if !found {
		return downloadFailure(errForbidden), nil
	}
	if !row.Public {
		if err := s.allow(ctx, token, userID, "d_storage_objects.read", row.StorageObjectID); err != nil {
			return downloadFailure(err), nil
		}
	}
	opened, err := s.Objects.Open(ctx, s.Bucket, request.Params.Key)
	if err != nil {
		return downloadFailure(err), nil
	}
	var contentType *string
	if opened.ContentType != "" {
		contentType = &opened.ContentType
	}
	return utils.DownloadObjectResponse{
		Body:          opened.Body,
		ContentLength: opened.ContentLength,
		ContentType:   utils.ContentTypeForObject(parts.FileName, contentType),
		Filename:      utils.ObjectFilename(parts.FileName),
	}, nil
}

func (s *Server) CopyObject(ctx context.Context, request CopyObjectRequestObject) (CopyObjectResponseObject, error) {
	token, userID, err := s.caller(ctx)
	if err != nil {
		return copyFailure(err), nil
	}
	if err := s.sameBucket(request.BucketName); err != nil {
		return copyFailure(err), nil
	}
	if request.Body == nil {
		return copyFailure(errBadRequest), nil
	}
	if err := s.sameBucket(request.Body.DestinationBucket); err != nil {
		return copyFailure(err), nil
	}
	source, err := utils.ParseObjectKey(request.Params.Key)
	if err != nil {
		return copyFailure(errBadRequest), nil
	}
	row, found, err := s.lookupKey(ctx, token, request.Params.Key)
	if err != nil {
		return copyFailure(err), nil
	}
	if !found {
		return copyFailure(errForbidden), nil
	}
	if err := s.allow(ctx, token, userID, "d_storage_objects.read", row.StorageObjectID); err != nil {
		return copyFailure(err), nil
	}
	prepared, err := s.prepareUpload(ctx, token, request.Body.DestinationFileName)
	if err != nil {
		return copyFailure(err), nil
	}
	pending, err := pendingFrom(prepared)
	if err != nil {
		return copyFailure(err), nil
	}
	sourceKey, err := utils.BuildObjectKey(source)
	if err != nil {
		s.abortPending(ctx, token, pending)
		return copyFailure(err), nil
	}
	if err := s.Objects.Copy(ctx, s.Bucket, s.Bucket, sourceKey, pending.S3ObjectKey); err != nil {
		s.abortPending(ctx, token, pending)
		return copyFailure(err), nil
	}
	if err := s.commitPrepared(ctx, token, userID, pending); err != nil {
		return copyFailure(err), nil
	}
	return CopyObject200Response{}, nil
}

func (s *Server) DeleteSingleObject(ctx context.Context, request DeleteSingleObjectRequestObject) (DeleteSingleObjectResponseObject, error) {
	token, userID, err := s.caller(ctx)
	if err != nil {
		return deleteOneFailure(err), nil
	}
	if err := s.sameBucket(request.BucketName); err != nil {
		return deleteOneFailure(err), nil
	}
	if _, err := utils.ParseObjectKey(request.Params.Key); err != nil {
		return deleteOneFailure(errBadRequest), nil
	}
	row, found, err := s.lookupKey(ctx, token, request.Params.Key)
	if err != nil {
		return deleteOneFailure(err), nil
	}
	if !found {
		return deleteOneFailure(errForbidden), nil
	}
	if err := s.allow(ctx, token, userID, "d_storage_objects.delete", row.StorageObjectID); err != nil {
		return deleteOneFailure(err), nil
	}
	versionID := ""
	if request.Params.VersionId != nil {
		versionID = *request.Params.VersionId
	}
	bypass := request.Params.BypassGovernance != nil && *request.Params.BypassGovernance
	if err := s.Objects.Delete(ctx, s.Bucket, request.Params.Key, versionID, bypass); err != nil {
		return deleteOneFailure(err), nil
	}
	return DeleteSingleObject204Response{}, nil
}

func (s *Server) DeleteObjects(ctx context.Context, request DeleteObjectsRequestObject) (DeleteObjectsResponseObject, error) {
	token, userID, err := s.caller(ctx)
	if err != nil {
		return deleteManyFailure(err), nil
	}
	if err := s.sameBucket(request.BucketName); err != nil {
		return deleteManyFailure(err), nil
	}
	if request.Body == nil {
		return deleteManyFailure(errBadRequest), nil
	}
	keys := uniqueKeys(request.Body.Keys)
	if len(keys) == 0 {
		return DeleteObjects200Response{}, nil
	}
	for _, key := range keys {
		if _, err := utils.ParseObjectKey(key); err != nil {
			return deleteManyFailure(errBadRequest), nil
		}
		row, found, err := s.lookupKey(ctx, token, key)
		if err != nil {
			return deleteManyFailure(err), nil
		}
		if !found {
			return deleteManyFailure(errForbidden), nil
		}
		if err := s.allow(ctx, token, userID, "d_storage_objects.delete", row.StorageObjectID); err != nil {
			return deleteManyFailure(err), nil
		}
	}
	bypass := request.Params.BypassGovernance != nil && *request.Params.BypassGovernance
	if err := s.Objects.DeleteMany(ctx, s.Bucket, keys, bypass); err != nil {
		return deleteManyFailure(err), nil
	}
	return DeleteObjects200Response{}, nil
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

func filePart(reader *multipart.Reader) (io.ReadCloser, int64, error) {
	if reader == nil {
		return nil, 0, errBadRequest
	}
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			return nil, 0, errBadRequest
		}
		if err != nil {
			return nil, 0, err
		}
		if part.FormName() != "file" {
			_ = part.Close()
			continue
		}
		size := int64(-1)
		if header := part.Header.Get("Content-Length"); header != "" {
			if parsed, parseErr := strconv.ParseInt(header, 10, 64); parseErr == nil {
				size = parsed
			}
		}
		return part, size, nil
	}
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

func uploadFailure(err error) UploadObjectResponseObject {
	status, message := classify(err)
	switch status {
	case http.StatusUnauthorized:
		return UploadObject401JSONResponse{UnauthorizedJSONResponse: UnauthorizedJSONResponse{Message: message}}
	case http.StatusForbidden:
		return UploadObject403JSONResponse{ForbiddenJSONResponse: ForbiddenJSONResponse{Message: message}}
	case http.StatusBadRequest:
		return UploadObject400JSONResponse{BadRequestJSONResponse: BadRequestJSONResponse{Message: message}}
	case http.StatusRequestEntityTooLarge:
		return UploadObject413Response{}
	default:
		return UploadObject500JSONResponse{InternalErrorJSONResponse: InternalErrorJSONResponse{Message: message}}
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
