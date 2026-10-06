package utils

import (
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

type ObjectKeyParts struct {
	UserID              string
	StorageObjectID     string
	StorageObjectDataID string
	FileName            string
}

func BuildObjectKey(parts ObjectKeyParts) (string, error) {
	if err := validateObjectKeyParts(parts); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s/%s/%s/%s",
		parts.UserID,
		parts.StorageObjectID,
		parts.StorageObjectDataID,
		parts.FileName,
	), nil
}

func ParseObjectKey(key string) (ObjectKeyParts, error) {
	trimmed := strings.TrimSpace(key)
	if trimmed == "" {
		return ObjectKeyParts{}, errors.New("object key is required")
	}
	parts := strings.SplitN(trimmed, "/", 4)
	if len(parts) < 4 {
		return ObjectKeyParts{}, errors.New("object key must contain userId, storageObjectId, storageObjectDataId, and fileName segments")
	}
	parsed := ObjectKeyParts{
		UserID:              parts[0],
		StorageObjectID:     parts[1],
		StorageObjectDataID: parts[2],
		FileName:            parts[3],
	}
	if err := validateObjectKeyParts(parsed); err != nil {
		return ObjectKeyParts{}, err
	}
	return parsed, nil
}

func validateObjectKeyParts(parts ObjectKeyParts) error {
	if _, err := uuid.Parse(parts.UserID); err != nil {
		return errors.New("userId must be a valid UUID")
	}
	if _, err := uuid.Parse(parts.StorageObjectID); err != nil {
		return errors.New("storageObjectId must be a valid UUID")
	}
	if _, err := uuid.Parse(parts.StorageObjectDataID); err != nil {
		return errors.New("storageObjectDataId must be a valid UUID")
	}
	if strings.TrimSpace(parts.FileName) == "" {
		return errors.New("fileName is required")
	}
	return nil
}
