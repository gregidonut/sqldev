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

const (
	ProgressFrames   = "frames"
	ProgressEncoding = "encoding"
)

// Progress is the latest animation frame count. The zero value means no progress.
type Progress struct {
	Phase     string
	Completed int
	Total     int
}

// Validate rejects a range the progress bar cannot display.
func (p Progress) Validate() error {
	if p.Phase != ProgressFrames && p.Phase != ProgressEncoding {
		return errors.New("progress phase is not supported")
	}
	if p.Total < 1 || p.Completed < 0 || p.Completed > p.Total {
		return errors.New("progress range is invalid")
	}
	return nil
}

func (p Progress) IsZero() bool {
	return p == Progress{}
}

// Advances reports whether next is a newer observation of the same frame total.
func (p Progress) Advances(next Progress) bool {
	if err := next.Validate(); err != nil {
		return false
	}
	if p.IsZero() {
		return true
	}
	return p.Total == next.Total && next.Completed >= p.Completed
}

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
	Progress    Progress
}

type Store interface {
	Create(ctx context.Context, record Record) error
	Get(ctx context.Context, jobID string) (Record, error)
	Update(ctx context.Context, record Record) error
	UpdateProgress(ctx context.Context, jobID, owner string, progress Progress) error
}
