package policyBuilder

import (
	"errors"
	"fmt"
	"strings"

	"github.com/aws/aws-lambda-go/events"
)

// BuildPolicyDocuments returns a slice of pointers as required by the SDK.
func BuildPolicyDocuments(invokedFunctionArn, topicPattern string) ([]*events.IAMPolicyDocument, error) {
	parts := strings.Split(invokedFunctionArn, ":")
	if len(parts) < 5 {
		return nil, errors.New("invalid invoked function ARN")
	}

	partition := parts[1]
	region := parts[3]
	accountID := parts[4]

	topicARN := func(t string) string {
		return fmt.Sprintf("arn:%s:iot:%s:%s:topic/%s", partition, region, accountID, t)
	}
	filterARN := func(t string) string {
		return fmt.Sprintf("arn:%s:iot:%s:%s:topicfilter/%s", partition, region, accountID, t)
	}

	statements := []events.IAMPolicyStatement{
		{
			Action:   []string{"iot:Connect"},
			Effect:   "Allow",
			Resource: []string{"*"},
		},
		{
			Action:   []string{"iot:Receive"},
			Effect:   "Allow",
			Resource: []string{topicARN(topicPattern)},
		},
		{
			Action:   []string{"iot:Subscribe"},
			Effect:   "Allow",
			Resource: []string{filterARN(topicPattern)},
		},
		//{
		//	Action:   []string{"iot:Publish"},
		//	Effect:   "Allow",
		//	Resource: []string{topicARN(topicPattern)},
		//},
	}

	return []*events.IAMPolicyDocument{
		{
			Version:   "2012-10-17",
			Statement: statements,
		},
	}, nil
}
