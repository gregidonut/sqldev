package main

import (
	"testing"

	"github.com/gregidonut/sqldev/packages/functions/internal/imagor"
	"github.com/gregidonut/sqldev/packages/functions/internal/jobs"
)

func TestImageOutcomeSkipsRenderAfterAuthorizationFailure(t *testing.T) {
	called := false
	outcome, err := imageOutcome(imagePrep{
		Outcome: jobs.Outcome{HTTPStatus: 403, Message: "Forbidden"},
	}, func(imagor.Request) (jobs.Outcome, error) {
		called = true
		return jobs.Outcome{HTTPStatus: 200}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if called || outcome.HTTPStatus != 403 {
		t.Fatalf("called = %v outcome = %+v", called, outcome)
	}
}

func TestWithoutImageBytesDropsThePayload(t *testing.T) {
	outcome := withoutImageBytes(jobs.Outcome{
		HTTPStatus: 200,
		Artifact: &jobs.Artifact{
			Key:         "images/user/job",
			ContentType: "image/jpeg",
			Body:        []byte("jpeg-bytes"),
		},
	})
	if outcome.Artifact == nil || len(outcome.Artifact.Body) != 0 || outcome.Artifact.Key != "images/user/job" {
		t.Fatalf("outcome = %+v", outcome.Artifact)
	}
}

func TestImageOutcomeRendersAnAuthorizedRequest(t *testing.T) {
	outcome, err := imageOutcome(imagePrep{
		Request: imagor.Request{SourceKey: "source"},
	}, func(request imagor.Request) (jobs.Outcome, error) {
		if request.SourceKey != "source" {
			t.Fatalf("request = %+v", request)
		}
		return jobs.Outcome{HTTPStatus: 200}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if outcome.HTTPStatus != 200 {
		t.Fatalf("status = %d", outcome.HTTPStatus)
	}
}
