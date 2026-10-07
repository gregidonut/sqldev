package queue

import (
	"context"
	"errors"
)

var ErrEmpty = errors.New("queue is empty")

type Sender interface {
	Send(ctx context.Context, body string) error
}

type Message struct {
	Body    string
	Receipt string
}

type Receiver interface {
	Receive(ctx context.Context) (Message, error)
	Delete(ctx context.Context, receipt string) error
}
