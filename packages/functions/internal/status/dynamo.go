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
	JobID             string `dynamodbav:"jobId"`
	Owner             string `dynamodbav:"owner"`
	Kind              string `dynamodbav:"kind"`
	Status            string `dynamodbav:"status"`
	HTTPStatus        int    `dynamodbav:"httpStatus,omitempty"`
	Body              string `dynamodbav:"body,omitempty"`
	ResultKey         string `dynamodbav:"resultKey,omitempty"`
	ContentType       string `dynamodbav:"contentType,omitempty"`
	Message           string `dynamodbav:"message,omitempty"`
	ExpiresAt         int64  `dynamodbav:"expiresAt"`
	Attempt           int    `dynamodbav:"attempt,omitempty"`
	ProgressPhase     string `dynamodbav:"progressPhase,omitempty"`
	ProgressCompleted int    `dynamodbav:"progressCompleted,omitempty"`
	ProgressTotal     int    `dynamodbav:"progressTotal,omitempty"`
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
	set := "SET #status = :status, httpStatus = :httpStatus, body = :body, resultKey = :resultKey, contentType = :contentType, message = :message"
	values := map[string]types.AttributeValue{
		":status":      &types.AttributeValueMemberS{Value: record.Status},
		":httpStatus":  &types.AttributeValueMemberN{Value: strconv.Itoa(record.HTTPStatus)},
		":body":        &types.AttributeValueMemberS{Value: string(record.Body)},
		":resultKey":   &types.AttributeValueMemberS{Value: record.ResultKey},
		":contentType": &types.AttributeValueMemberS{Value: record.ContentType},
		":message":     &types.AttributeValueMemberS{Value: record.Message},
	}
	// A zero attempt means this update is a status transition and must not
	// erase the retry count recorded by an earlier resubmit.
	if record.Attempt > 0 {
		set += ", attempt = :attempt"
		values[":attempt"] = &types.AttributeValueMemberN{Value: strconv.Itoa(record.Attempt)}
	}
	expression := set + " REMOVE progressPhase, progressCompleted, progressTotal"
	_, err := d.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(d.table),
		Key: map[string]types.AttributeValue{
			"jobId": &types.AttributeValueMemberS{Value: record.JobID},
		},
		UpdateExpression: aws.String(expression),
		ExpressionAttributeNames: map[string]string{
			"#status": "status",
		},
		ExpressionAttributeValues: values,
		ConditionExpression:       aws.String("attribute_exists(jobId)"),
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

// progressCondition limits a progress write to the running job of one owner.
// owner and status are DynamoDB reserved words, so both use name aliases.
const progressCondition = "attribute_exists(jobId) AND #owner = :owner AND #status = :running AND (attribute_not_exists(progressTotal) OR progressTotal = :total) AND (attribute_not_exists(progressCompleted) OR progressCompleted <= :completed)"

func (d *Dynamo) UpdateProgress(ctx context.Context, jobID, owner string, progress Progress) error {
	if err := progress.Validate(); err != nil {
		return err
	}
	_, err := d.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(d.table),
		Key: map[string]types.AttributeValue{
			"jobId": &types.AttributeValueMemberS{Value: jobID},
		},
		UpdateExpression: aws.String("SET progressPhase = :phase, progressCompleted = :completed, progressTotal = :total"),
		ExpressionAttributeNames: map[string]string{
			"#owner":  "owner",
			"#status": "status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":phase":     &types.AttributeValueMemberS{Value: progress.Phase},
			":completed": &types.AttributeValueMemberN{Value: strconv.Itoa(progress.Completed)},
			":total":     &types.AttributeValueMemberN{Value: strconv.Itoa(progress.Total)},
			":owner":     &types.AttributeValueMemberS{Value: owner},
			":running":   &types.AttributeValueMemberS{Value: Running},
		},
		ConditionExpression: aws.String(progressCondition),
	})
	if err != nil {
		var rejected *types.ConditionalCheckFailedException
		if errors.As(err, &rejected) {
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
		JobID:             record.JobID,
		Owner:             record.Owner,
		Kind:              record.Kind,
		Status:            record.Status,
		HTTPStatus:        record.HTTPStatus,
		Body:              string(record.Body),
		ResultKey:         record.ResultKey,
		ContentType:       record.ContentType,
		Message:           record.Message,
		ExpiresAt:         expires.Unix(),
		Attempt:           record.Attempt,
		ProgressPhase:     record.Progress.Phase,
		ProgressCompleted: record.Progress.Completed,
		ProgressTotal:     record.Progress.Total,
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
		Attempt:     stored.Attempt,
		Progress: Progress{
			Phase:     stored.ProgressPhase,
			Completed: stored.ProgressCompleted,
			Total:     stored.ProgressTotal,
		},
	}
}
