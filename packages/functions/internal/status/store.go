package status

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

const (
	Pending   = "pending"
	Running   = "running"
	Completed = "completed"
	Failed    = "failed"
)

var ErrNotFound = errors.New("job not found")
var ErrExists = errors.New("job already exists")

type Record struct {
	JobID       string
	Owner       string
	Kind        string
	Status      string
	HTTPStatus  int
	Body        json.RawMessage
	ResultKey   string
	ContentType string
	Message     string
	ExpiresAt   time.Time
	Attempt     int
}

type Store interface {
	Create(ctx context.Context, record Record) error
	Get(ctx context.Context, jobID string) (Record, error)
	Update(ctx context.Context, record Record) error
}
