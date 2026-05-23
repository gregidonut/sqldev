package authorizerEvent

import (
	"encoding/base64"
	"errors"
	"strings"

	"github.com/aws/aws-lambda-go/events"
)

func GetToken(event events.IoTCoreCustomAuthorizerRequest) (string, error) {
	if event.ProtocolData == nil || event.ProtocolData.MQTT == nil {
		return "", errors.New("missing mqtt protocol data")
	}

	password := event.ProtocolData.MQTT.Password
	if len(password) == 0 {
		return "", errors.New("missing token")
	}

	// aws-lambda-go unmarshals the event password field into []byte (already decoded).
	token := strings.TrimSpace(string(password))
	if !looksLikeJWT(token) {
		if decoded, err := base64.StdEncoding.DecodeString(token); err == nil {
			token = strings.TrimSpace(string(decoded))
		}
	}

	if after, ok := strings.CutPrefix(token, "Bearer "); ok {
		token = after
	}

	if token == "" {
		return "", errors.New("empty token")
	}

	return token, nil
}

func looksLikeJWT(s string) bool {
	return strings.Count(s, ".") == 2
}
