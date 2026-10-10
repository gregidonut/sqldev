package status

import (
	"context"
	"errors"
	"testing"
)

func TestUpdateProgressIsOwnerScopedAndMonotonic(t *testing.T) {
	t.Parallel()
	store := NewMemory()
	const jobID = "job-1"
	if err := store.Create(context.Background(), Record{
		JobID:  jobID,
		Owner:  "owner",
		Status: Running,
	}); err != nil {
		t.Fatal(err)
	}
	first := Progress{Phase: ProgressFrames, Completed: 3, Total: 7}
	if err := store.UpdateProgress(context.Background(), jobID, "owner", first); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateProgress(context.Background(), jobID, "other", Progress{
		Phase: ProgressFrames, Completed: 4, Total: 7,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other owner error = %v", err)
	}
	if err := store.UpdateProgress(context.Background(), jobID, "owner", Progress{
		Phase: ProgressFrames, Completed: 2, Total: 7,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stale error = %v", err)
	}
	if err := store.UpdateProgress(context.Background(), jobID, "owner", Progress{
		Phase: ProgressEncoding, Completed: 7, Total: 7,
	}); err != nil {
		t.Fatal(err)
	}
	record, err := store.Get(context.Background(), jobID)
	if err != nil {
		t.Fatal(err)
	}
	if record.Progress.Phase != ProgressEncoding || record.Progress.Completed != 7 || record.Progress.Total != 7 {
		t.Fatalf("progress = %+v", record.Progress)
	}

	record.Status = Completed
	record.Progress = Progress{}
	if err := store.Update(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateProgress(context.Background(), jobID, "owner", first); !errors.Is(err, ErrNotFound) {
		t.Fatalf("completed error = %v", err)
	}
}
