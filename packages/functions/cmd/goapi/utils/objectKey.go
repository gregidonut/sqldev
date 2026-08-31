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
