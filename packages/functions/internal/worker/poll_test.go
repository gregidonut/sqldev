package worker

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
	"github.com/gregidonut/sqldev/packages/functions/internal/queue"
)

func TestPollDeletesOnlyAfterAccept(t *testing.T) {
	body, err := (jobs.Envelope{
		Version: jobs.Version,
		JobID:   "11111111-1111-4111-8111-111111111111",
		Kind:    jobs.KindListView,
		Claims:  jobs.Claims{Subject: "user_a", Role: "authenticated"},
		Payload: []byte(`{"view":"igPosts"}`),
	}).Marshal()
	if err != nil {
		t.Fatal(err)
	}
	messages := queue.NewMemory()
	if err := messages.Send(context.Background(), body); err != nil {
		t.Fatal(err)
	}
	acceptor := &scriptedAcceptor{}
	acceptor.setErr(errors.New("database unavailable"))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- Poll(ctx, messages, acceptor) }()

	waitFor(t, func() bool { return acceptor.count() == 1 })
	if len(messages.Deleted()) != 0 {
		t.Fatal("message was deleted before it was accepted")
	}
	acceptor.setErr(nil)
	if err := messages.Send(context.Background(), body); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return len(messages.Deleted()) == 1 })
	cancel()
	<-done
}

func TestPollStopsWhenContextIsCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := Poll(ctx, queue.NewMemory(), &scriptedAcceptor{})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v", err)
	}
}

func waitFor(t *testing.T, ready func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if ready() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("condition was not met")
}

type scriptedAcceptor struct {
	mu    sync.Mutex
	err   error
	calls atomic.Int32
}

func (s *scriptedAcceptor) setErr(err error) {
	s.mu.Lock()
	s.err = err
	s.mu.Unlock()
}

func (s *scriptedAcceptor) count() int {
	return int(s.calls.Load())
}

func (s *scriptedAcceptor) Accept(context.Context, jobs.Envelope) error {
	s.calls.Add(1)
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.err
}
