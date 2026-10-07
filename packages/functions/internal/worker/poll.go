package worker

import (
	"context"
	"errors"
	"log/slog"

	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
	"github.com/gregidonut/sqldev/packages/functions/internal/queue"
)

type Acceptor interface {
	Accept(ctx context.Context, envelope jobs.Envelope) error
}

// Poll receives one message at a time and deletes it only after the durable
// acceptor has recorded the workflow.
func Poll(ctx context.Context, receiver queue.Receiver, acceptor Acceptor) error {
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		message, err := receiver.Receive(ctx)
		if errors.Is(err, queue.ErrEmpty) {
			continue
		}
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			slog.Error("receive job", "error", err)
			continue
		}
		envelope, err := jobs.Parse(message.Body)
		if err != nil {
			slog.Error("invalid job message", "error", err)
			continue
		}
		if err := acceptor.Accept(ctx, envelope); err != nil {
			slog.Error("accept job", "jobId", envelope.JobID, "error", err)
			continue
		}
		if err := receiver.Delete(ctx, message.Receipt); err != nil {
			return err
		}
	}
}
