package status

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type Dynamo struct {
	table  string
	client *dynamodb.Client
}

type item struct {
	JobID       string `dynamodbav:"jobId"`
	Owner       string `dynamodbav:"owner"`
	Kind        string `dynamodbav:"kind"`
	Status      string `dynamodbav:"status"`
	HTTPStatus  int    `dynamodbav:"httpStatus,omitempty"`
	Body        string `dynamodbav:"body,omitempty"`
	ResultKey   string `dynamodbav:"resultKey,omitempty"`
	ContentType string `dynamodbav:"contentType,omitempty"`
	Message     string `dynamodbav:"message,omitempty"`
	ExpiresAt   int64  `dynamodbav:"expiresAt"`
}

func NewDynamo(ctx context.Context, table string) (*Dynamo, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion("ap-east-1"))
	if err != nil {
		return nil, err
	}
	return &Dynamo{table: table, client: dynamodb.NewFromConfig(cfg)}, nil
}

func (d *Dynamo) Create(ctx context.Context, record Record) error {
	value, err := attributevalue.MarshalMap(toItem(record))
	if err != nil {
		return err
	}
	_, err = d.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName:           aws.String(d.table),
		Item:                value,
		ConditionExpression: aws.String("attribute_not_exists(jobId)"),
	})
	if err != nil {
		var conflict *types.ConditionalCheckFailedException
		if errors.As(err, &conflict) {
			return ErrExists
		}
		return err
	}
	return nil
}

func (d *Dynamo) Get(ctx context.Context, jobID string) (Record, error) {
	key, err := attributevalue.MarshalMap(map[string]string{"jobId": jobID})
	if err != nil {
		return Record{}, err
	}
	result, err := d.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:      aws.String(d.table),
		Key:            key,
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return Record{}, err
	}
	if len(result.Item) == 0 {
		return Record{}, ErrNotFound
	}
	var stored item
	if err := attributevalue.UnmarshalMap(result.Item, &stored); err != nil {
		return Record{}, err
	}
	return fromItem(stored), nil
}

func (d *Dynamo) Update(ctx context.Context, record Record) error {
	_, err := d.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(d.table),
		Key: map[string]types.AttributeValue{
			"jobId": &types.AttributeValueMemberS{Value: record.JobID},
		},
		UpdateExpression: aws.String("SET #status = :status, httpStatus = :httpStatus, body = :body, resultKey = :resultKey, contentType = :contentType, message = :message"),
		ExpressionAttributeNames: map[string]string{
			"#status": "status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":status":      &types.AttributeValueMemberS{Value: record.Status},
			":httpStatus":  &types.AttributeValueMemberN{Value: strconv.Itoa(record.HTTPStatus)},
			":body":        &types.AttributeValueMemberS{Value: string(record.Body)},
			":resultKey":   &types.AttributeValueMemberS{Value: record.ResultKey},
			":contentType": &types.AttributeValueMemberS{Value: record.ContentType},
			":message":     &types.AttributeValueMemberS{Value: record.Message},
		},
		ConditionExpression: aws.String("attribute_exists(jobId)"),
	})
	if err != nil {
		var missing *types.ConditionalCheckFailedException
		if errors.As(err, &missing) {
			return ErrNotFound
		}
		return err
	}
	return nil
}

func toItem(record Record) item {
	expires := record.ExpiresAt
	if expires.IsZero() {
		expires = time.Now().Add(24 * time.Hour)
	}
	return item{
		JobID:       record.JobID,
		Owner:       record.Owner,
		Kind:        record.Kind,
		Status:      record.Status,
		HTTPStatus:  record.HTTPStatus,
		Body:        string(record.Body),
		ResultKey:   record.ResultKey,
		ContentType: record.ContentType,
		Message:     record.Message,
		ExpiresAt:   expires.Unix(),
	}
}

func fromItem(stored item) Record {
	return Record{
		JobID:       stored.JobID,
		Owner:       stored.Owner,
		Kind:        stored.Kind,
		Status:      stored.Status,
		HTTPStatus:  stored.HTTPStatus,
		Body:        []byte(stored.Body),
		ResultKey:   stored.ResultKey,
		ContentType: stored.ContentType,
		Message:     stored.Message,
		ExpiresAt:   time.Unix(stored.ExpiresAt, 0),
	}
}
