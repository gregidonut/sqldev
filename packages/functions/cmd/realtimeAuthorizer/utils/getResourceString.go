package utils

import (
	"fmt"

	"github.com/sst/sst/v3/sdk/golang/resource"
)

func GetResourceString(name, property string) (string, error) {
	raw, err := resource.Get(name, property)
	if err != nil {
		return "", err
	}

	value, ok := raw.(string)
	if !ok || value == "" {
		return "", fmt.Errorf("unexpected %s %s value", name, property)
	}

	return value, nil
}
