package api

import (
	openapi_types "github.com/oapi-codegen/runtime/types"
	"github.com/gregidonut/sqldev/packages/functions/cmd/goapi/utils"
)

func openapiUUIDString(id openapi_types.UUID) string {
	return id.String()
}

func resolveObjectKey(userID, storageObjectID, storageObjectDataID, fileName string) (string, error) {
	return utils.BuildObjectKey(utils.ObjectKeyParts{
		UserID:              userID,
		StorageObjectID:     storageObjectID,
		StorageObjectDataID: storageObjectDataID,
		FileName:            fileName,
	})
}

func resolveObjectKeyFromRef(ref ObjectKeyRef) (string, error) {
	return resolveObjectKey(
		openapiUUIDString(ref.UserId),
		openapiUUIDString(ref.StorageObjectId),
		openapiUUIDString(ref.StorageObjectDataId),
		ref.FileName,
	)
}

func resolveObjectKeyFromQueryParams(
	userId UserIdPrefix,
	storageObjectId StorageObjectIdPrefix,
	storageObjectDataId StorageObjectDataIdPrefix,
	fileName FileName,
) (string, error) {
	return resolveObjectKey(
		openapiUUIDString(userId),
		openapiUUIDString(storageObjectId),
		openapiUUIDString(storageObjectDataId),
		fileName,
	)
}

func resolveObjectKeyFromCopyDestination(body CopyObjectJSONRequestBody) (string, error) {
	return resolveObjectKey(
		openapiUUIDString(body.DestinationUserId),
		openapiUUIDString(body.DestinationStorageObjectId),
		openapiUUIDString(body.DestinationStorageObjectDataId),
		body.DestinationFileName,
	)
}
