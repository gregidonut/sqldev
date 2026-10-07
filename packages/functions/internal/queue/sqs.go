package queue

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
)

type SQS struct {
	url    string
	client *sqs.Client
}

func NewSQS(ctx context.Context, url string) (*SQS, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion("ap-east-1"))
	if err != nil {
		return nil, err
	}
	return &SQS{url: url, client: sqs.NewFromConfig(cfg)}, nil
}

func (s *SQS) Send(ctx context.Context, body string) error {
	_, err := s.client.SendMessage(ctx, &sqs.SendMessageInput{
		QueueUrl:    aws.String(s.url),
		MessageBody: aws.String(body),
	})
	return err
}

func (s *SQS) Receive(ctx context.Context) (Message, error) {
	result, err := s.client.ReceiveMessage(ctx, &sqs.ReceiveMessageInput{
		QueueUrl:            aws.String(s.url),
		MaxNumberOfMessages: 1,
		WaitTimeSeconds:     20,
	})
	if err != nil {
		return Message{}, err
	}
	if len(result.Messages) == 0 {
		return Message{}, ErrEmpty
	}
	message := result.Messages[0]
	return Message{
		Body:    aws.ToString(message.Body),
		Receipt: aws.ToString(message.ReceiptHandle),
	}, nil
}

func (s *SQS) Delete(ctx context.Context, receipt string) error {
	_, err := s.client.DeleteMessage(ctx, &sqs.DeleteMessageInput{
		QueueUrl:      aws.String(s.url),
		ReceiptHandle: aws.String(receipt),
	})
	return err
}
