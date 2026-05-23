package authorizerEvent

import (
	"regexp"
	"strconv"
	"time"

	"github.com/aws/aws-lambda-go/events"
)

var principalIDPattern = regexp.MustCompile(`^[a-zA-Z0-9]{1,128}$`)

// GetPrincipalID matches the SST realtime.authorizer default: mqtt username or a
// numeric timestamp. AWS IoT only allows [a-zA-Z0-9]{1,128}.
func GetPrincipalID(event events.IoTCoreCustomAuthorizerRequest) string {
	if event.ProtocolData != nil && event.ProtocolData.MQTT != nil {
		if username := event.ProtocolData.MQTT.Username; username != "" &&
			principalIDPattern.MatchString(username) {
			return username
		}
	}
	return strconv.FormatInt(time.Now().UnixMilli(), 10)
}
