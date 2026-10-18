package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gregidonut/sqldev/packages/cli/internal/process"
)

func TestHostDataVolumeReplaceCommandSurface(t *testing.T) {
	root := newRootCommand(rejectingRunner{t: t})
	cmd, _, err := root.Find([]string{"host", "data-volume", "replace"})
	if err != nil {
		t.Fatal(err)
	}
	if cmd.Flags().Lookup("preflight") == nil || cmd.Flags().Lookup("yes") == nil {
		t.Fatal("replace is missing --preflight or --yes")
	}

	repo := testRepository(t)
	extra := newRootCommandWithArgs(rejectingRunner{t: t}, func() []string {
		return []string{"--root", repo, "--stage", "staging", "host", "data-volume", "replace", "extra"}
	})
	extra.SetArgs([]string{"--root", repo, "--stage", "staging", "host", "data-volume", "replace", "extra"})
	if err := extra.Execute(); err == nil || !strings.Contains(err.Error(), `unknown command "extra"`) {
		t.Fatalf("extra arg error = %v", err)
	}
}

func TestHostDataVolumeReplaceRefusesNonStagingBeforeAWS(t *testing.T) {
	repo := testRepository(t)
	runner := rejectingRunner{t: t}
	for _, stage := range []string{"dev", "Staging"} {
		argv := []string{"--root", repo, "--stage", stage, "host", "data-volume", "replace", "--preflight"}
		cmd := newRootCommandWithArgs(runner, func() []string { return argv })
		cmd.SetArgs(argv)
		err := cmd.Execute()
		if err == nil || !strings.Contains(err.Error(), "exact 'staging' stage") {
			t.Fatalf("stage %q error = %v", stage, err)
		}
	}
}

func TestHostDataVolumeReplacePreflightCommand(t *testing.T) {
	t.Setenv("SST_RESOURCE_App", `{"name":"sqldev","stage":"staging"}`)
	t.Setenv("SST_RESOURCE_HostDataVolumeId", `{"id":"vol-0123456789abcdef0"}`)
	t.Setenv("SST_RESOURCE_GoApi", `{"url":"https://api.example.com/staging/"}`)
	t.Setenv("SST_RESOURCE_NotifySecret", `{"value":"notify-secret"}`)

	repo := testRepository(t)
	runner := &preflightRunner{}
	argv := []string{"--root", repo, "--stage", "staging", "--aws-region", "ap-east-1", "--aws-profile", "folio", "host", "data-volume", "replace", "--preflight"}
	var out bytes.Buffer
	cmd := newRootCommandWithArgs(runner, func() []string { return argv })
	cmd.SetOut(&out)
	cmd.SetArgs(argv)
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if len(runner.mutations) != 0 {
		t.Fatalf("preflight mutations = %v", runner.mutations)
	}
	if !strings.Contains(out.String(), "vol-0123456789abcdef0") || strings.Contains(out.String(), "notify-secret") {
		t.Fatal("preflight output was missing the volume id or leaked the notify secret")
	}
	for _, call := range runner.calls {
		if call.Program == "aws" && !strings.Contains(strings.Join(call.Args, " "), "--region ap-east-1") {
			t.Fatalf("aws call missing region: %v", call.Args)
		}
	}
}

type rejectingRunner struct{ t *testing.T }

func (r rejectingRunner) Run(context.Context, process.RunRequest) error {
	r.t.Fatal("command made a subprocess call")
	return nil
}

type preflightRunner struct {
	calls     []process.RunRequest
	mutations []string
	stdout    string
}

func (r *preflightRunner) Run(_ context.Context, req process.RunRequest) error {
	r.calls = append(r.calls, req)
	joined := strings.Join(req.Args, " ")
	switch {
	case strings.Contains(joined, "terminate-instances"),
		strings.Contains(joined, "delete-volume"),
		strings.Contains(joined, " sst refresh"),
		strings.Contains(joined, " sst deploy"):
		r.mutations = append(r.mutations, joined)
	case strings.Contains(joined, "describe-instances"):
		_, _ = req.Stdout.Write([]byte(`{"Reservations":[{"Instances":[{
			"InstanceId":"i-0123456789abcdef0",
			"InstanceType":"t3.medium",
			"RootDeviceName":"/dev/xvda",
			"Placement":{"AvailabilityZone":"ap-east-1a"},
			"State":{"Name":"running"},
			"Tags":[
				{"Key":"Name","Value":"sqldev-staging-supabase"},
				{"Key":"Application","Value":"sqldev"},
				{"Key":"Stage","Value":"staging"}
			],
			"BlockDeviceMappings":[
				{"DeviceName":"/dev/xvda","Ebs":{"VolumeId":"vol-aaaaaaaaaaaaaaaaa","DeleteOnTermination":true}},
				{"DeviceName":"/dev/sdf","Ebs":{"VolumeId":"vol-0123456789abcdef0","DeleteOnTermination":false}}
			]
		}]}]}`))
	case strings.Contains(joined, "describe-volumes"):
		_, _ = req.Stdout.Write([]byte(`{"Volumes":[{
			"VolumeId":"vol-0123456789abcdef0",
			"Size":30,
			"VolumeType":"gp3",
			"Encrypted":true,
			"AvailabilityZone":"ap-east-1a",
			"State":"in-use",
			"Tags":[
				{"Key":"Name","Value":"sqldev-staging-supabase-data"},
				{"Key":"Application","Value":"sqldev"},
				{"Key":"Stage","Value":"staging"},
				{"Key":"Purpose","Value":"supabase-data"}
			],
			"Attachments":[{"InstanceId":"i-0123456789abcdef0","State":"attached","DeleteOnTermination":false}]
		}]}`))
	case strings.Contains(joined, "send-command"):
		r.stdout = `{"app_name":"sqldev","stage":"staging","app_bucket":"app","job_result_bucket":"job"}`
		_, _ = req.Stdout.Write([]byte("cmd-1\n"))
	case strings.Contains(joined, "get-command-invocation"):
		body, err := json.Marshal(map[string]string{
			"Status":                "Success",
			"StandardOutputContent": r.stdout,
			"StandardErrorContent":  "",
		})
		if err != nil {
			return err
		}
		_, _ = req.Stdout.Write(body)
	}
	return nil
}

func testRepository(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for _, name := range []string{"sst.config.ts", "package.json"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("{}"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}
