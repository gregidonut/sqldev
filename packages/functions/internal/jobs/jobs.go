// Package jobs is the versioned contract between the API Lambda and the
// single EC2 worker. The raw Clerk JWT never crosses this boundary.
package jobs

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

const Version = 1

const (
	KindListView       = "listView"
	KindGetViewItem    = "getViewItem"
	KindCreateViewItem = "createViewItem"
	KindUpdateViewItem = "updateViewItem"
	KindGetTodoTree    = "getTodoTree"
	KindMoveTodoItems  = "moveTodoItems"
	KindCreateTodo     = "createTodo"
	KindBucketExists   = "bucketExists"
	KindListStorage    = "listStorageObjects"
	KindPresign        = "presignObject"
	KindCommit         = "commitObject"
	KindAbort          = "abortObject"
	KindDownload       = "downloadObject"
	KindCopy           = "copyObject"
	KindDeleteObject   = "deleteSingleObject"
	KindDeleteObjects  = "deleteObjects"
	KindImgproxy       = "imgproxy"
)

type Claims struct {
	Subject string `json:"sub"`
	Role    string `json:"role"`
}

type Envelope struct {
	Version int             `json:"version"`
	JobID   string          `json:"jobId"`
	Kind    string          `json:"kind"`
	Claims  Claims          `json:"claims"`
	Payload json.RawMessage `json:"payload"`
	TraceID string          `json:"traceId,omitempty"`
}

type Outcome struct {
	HTTPStatus int             `json:"httpStatus"`
	Body       json.RawMessage `json:"body,omitempty"`
	Message    string          `json:"message,omitempty"`
}

func NewID() string {
	return uuid.NewString()
}

// StableID reuses one job for the same caller, operation, and idempotency key.
func StableID(owner, kind, key string) (string, error) {
	owner = strings.TrimSpace(owner)
	kind = strings.TrimSpace(kind)
	key = strings.TrimSpace(key)
	if owner == "" || kind == "" || key == "" {
		return "", errors.New("owner, kind, and idempotency key are required")
	}
	sum := sha256.Sum256([]byte(owner + "\n" + kind + "\n" + key))
	sum[6] = (sum[6] & 0x0f) | 0x50
	sum[8] = (sum[8] & 0x3f) | 0x80
	id, err := uuid.FromBytes(sum[:16])
	if err != nil {
		return "", fmt.Errorf("stable job id: %w", err)
	}
	return id.String(), nil
}

func (e Envelope) Marshal() (string, error) {
	if err := e.Validate(); err != nil {
		return "", err
	}
	body, err := json.Marshal(e)
	if err != nil {
		return "", fmt.Errorf("encode job: %w", err)
	}
	return string(body), nil
}

func Parse(body string) (Envelope, error) {
	var envelope Envelope
	if err := json.Unmarshal([]byte(body), &envelope); err != nil {
		return Envelope{}, fmt.Errorf("decode job: %w", err)
	}
	if err := envelope.Validate(); err != nil {
		return Envelope{}, err
	}
	return envelope, nil
}

func (e Envelope) Validate() error {
	if e.Version != Version {
		return fmt.Errorf("unsupported job version %d", e.Version)
	}
	if _, err := uuid.Parse(e.JobID); err != nil {
		return errors.New("job id must be a uuid")
	}
	if !knownKind(e.Kind) {
		return errors.New("unknown job kind")
	}
	if strings.TrimSpace(e.Claims.Subject) == "" {
		return errors.New("job subject is required")
	}
	if e.Claims.Role != "authenticated" {
		return errors.New("job role is not authenticated")
	}
	return nil
}

func knownKind(kind string) bool {
	switch kind {
	case KindListView, KindGetViewItem, KindCreateViewItem, KindUpdateViewItem,
		KindGetTodoTree, KindMoveTodoItems, KindCreateTodo, KindBucketExists,
		KindListStorage, KindPresign, KindCommit, KindAbort, KindDownload,
		KindCopy, KindDeleteObject, KindDeleteObjects, KindImgproxy:
		return true
	default:
		return false
	}
}

func Mutation(kind string) bool {
	switch kind {
	case KindCreateViewItem, KindUpdateViewItem, KindMoveTodoItems, KindCreateTodo,
		KindPresign, KindCommit, KindAbort, KindCopy, KindDeleteObject, KindDeleteObjects:
		return true
	default:
		return false
	}
}
