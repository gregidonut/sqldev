// Package jobs is the versioned contract between the API Lambda and the
// single EC2 worker. The raw Clerk JWT never crosses this boundary.
package jobs

import (
	"crypto/sha256"
	"encoding/hex"
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
	KindImagor         = "imagor"

	// KindSetStorageVisibility begins make-public or makes an object private.
	KindSetStorageVisibility = "setStorageVisibility"
	// KindConfirmOperation confirms a challenge issued by an earlier job. It is a
	// separate job on purpose: nothing waits for the user between the two.
	KindConfirmOperation = "confirmOperation"
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
	// Fingerprint binds the idempotency key to the request body for the kinds
	// where Fingerprinted reports true.
	Fingerprint string `json:"fingerprint,omitempty"`
}

// Artifact is the transformed image stored before the caller receives a URL.
type Artifact struct {
	Key         string `json:"key"`
	ContentType string `json:"contentType"`
	Body        []byte `json:"body,omitempty"`
}

type Outcome struct {
	HTTPStatus int             `json:"httpStatus"`
	Body       json.RawMessage `json:"body,omitempty"`
	Message    string          `json:"message,omitempty"`
	Artifact   *Artifact       `json:"artifact,omitempty"`
	// Fingerprint is copied from the envelope. DBOS records the outcome, so it
	// lets the worker tell an identical replay from a conflicting one after the
	// job-status record has expired and been recreated.
	Fingerprint string `json:"fingerprint,omitempty"`
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
		KindCopy, KindDeleteObject, KindDeleteObjects, KindImagor,
		KindSetStorageVisibility, KindConfirmOperation:
		return true
	default:
		return false
	}
}

func Mutation(kind string) bool {
	switch kind {
	case KindCreateViewItem, KindUpdateViewItem, KindMoveTodoItems, KindCreateTodo,
		KindPresign, KindCommit, KindAbort, KindCopy, KindDeleteObject, KindDeleteObjects,
		KindImagor, KindSetStorageVisibility, KindConfirmOperation:
		return true
	default:
		return false
	}
}

// Fingerprinted reports whether a job's idempotency key is bound to its request
// body. StableID alone ignores the body, so a key reused with a different body
// would silently return the first job's result. The confirmable kinds reject
// that instead.
func Fingerprinted(kind string) bool {
	return kind == KindSetStorageVisibility || kind == KindConfirmOperation
}

// Fingerprint is the hex SHA-256 of the kind and the encoded request payload.
// It reveals nothing about the payload to a reader of the status record.
func Fingerprint(kind string, body []byte) string {
	sum := sha256.Sum256([]byte("sqldev.request.v1\n" + kind + "\n" + string(body)))
	return hex.EncodeToString(sum[:])
}
