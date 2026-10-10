// Package devstack orchestrates the local development tmux session: starting,
// stopping, restarting, and inspecting the sst/worker/imagor panes, plus the
// combined destructive data reset. It composes the existing tmux, storage,
// passthrough, and SST facilities and never imports the cmd package.
package devstack

import (
	"errors"
	"regexp"
)

// localStages are the only stages the tmux lifecycle and data reset operate on.
var localStages = map[string]struct{}{
	"dev":         {},
	"local":       {},
	"development": {},
}

var prodPattern = regexp.MustCompile(`(?i)prod`)

// AssertLocalStage permits only dev, local, and development, and defensively
// rejects anything containing "prod". This is intentionally stricter than the
// generic storage production guard.
func AssertLocalStage(stage string) error {
	if stage == "" {
		return errors.New("a local stage is required (dev, local, or development)")
	}
	if prodPattern.MatchString(stage) {
		return errors.New("refusing to run local dev orchestration against a production-like stage")
	}
	if _, ok := localStages[stage]; !ok {
		return errors.New("local dev orchestration is only allowed for stages dev, local, or development")
	}
	return nil
}
