package host

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gregidonut/sqldev/packages/cli/internal/process"
)

const (
	oldInstanceID = "i-0123456789abcdef0"
	newInstanceID = "i-0fedcba9876543210"
	oldVolumeID   = "vol-0123456789abcdef0"
	newVolumeID   = "vol-0fedcba9876543210"
	rootVolumeID  = "vol-aaaaaaaaaaaaaaaaa"
	extraVolumeID = "vol-bbbbbbbbbbbbbbbbb"
	volumeApp     = "sqldev"
	volumeAZ      = "ap-east-1a"
	volumeKind    = "t3.medium"
)

func TestReplaceDataVolumeRefusesStageBeforeAnyCall(t *testing.T) {
	for _, stage := range []string{"", "dev", "prod", "production", "Staging", "staging ", "pre-staging"} {
		t.Run(stage, func(t *testing.T) {
			runner := &world{}
			opts, _ := testOptions(runner)
			opts.ConfiguredStage = stage
			if err := ReplaceDataVolume(context.Background(), opts); err == nil {
				t.Fatal("expected refusal")
			}
			if len(runner.calls) != 0 {
				t.Fatalf("stage %q made %d calls", stage, len(runner.calls))
			}
		})
	}
}

func TestReplaceDataVolumeRefusesLinkedIdentityBeforeAWS(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(res)
		secret string
	}{
		{name: "linked stage", mutate: func(r res) { r["App.stage"] = "Staging" }},
		{name: "app name", mutate: func(r res) { r["App.name"] = "sqldev;rm" }},
		{name: "volume id", mutate: func(r res) { r["HostDataVolumeId.id"] = "vol-1;rm" }},
		{name: "missing volume link", mutate: func(r res) { delete(r, "HostDataVolumeId.id") }},
		{name: "region", mutate: func(res) {}},
		{name: "profile", mutate: func(res) {}},
		{name: "notify secret", mutate: func(r res) { r["NotifySecret.value"] = "bad\nnotify-secret" }, secret: "notify-secret"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			runner := &world{}
			opts, _ := testOptions(runner)
			opts.Resources = goodVolumeResources()
			tc.mutate(opts.Resources.(res))
			if tc.name == "region" {
				opts.Region = "ap-east-1;rm"
			}
			if tc.name == "profile" {
				opts.AWSProfile = "folio;rm"
			}
			err := ReplaceDataVolume(context.Background(), opts)
			if err == nil {
				t.Fatal("expected refusal")
			}
			if len(runner.calls) != 0 {
				t.Fatalf("refused request made %d calls", len(runner.calls))
			}
			if tc.secret != "" && strings.Contains(err.Error(), tc.secret) {
				t.Fatal("error leaked a secret value")
			}
		})
	}
}

func TestRequireCurrentRejectsMismatchedVolume(t *testing.T) {
	linked := linkedVolume{AppName: volumeApp, VolumeID: oldVolumeID}

	cases := []struct {
		name   string
		mutate func(*ec2Instance, *ec2Volume)
		want   string
	}{
		{name: "tags", mutate: func(_ *ec2Instance, vol *ec2Volume) { vol.Tags[3].Value = "other" }, want: "tags"},
		{name: "encryption", mutate: func(_ *ec2Instance, vol *ec2Volume) { vol.Encrypted = false }, want: "not encrypted"},
		{name: "type", mutate: func(_ *ec2Instance, vol *ec2Volume) { vol.VolumeType = "gp2" }, want: "not gp3"},
		{name: "size", mutate: func(_ *ec2Instance, vol *ec2Volume) { vol.Size = 29 }, want: "size"},
		{name: "zone", mutate: func(_ *ec2Instance, vol *ec2Volume) { vol.AvailabilityZone = "ap-east-1b" }, want: "availability zone"},
		{name: "other instance", mutate: func(_ *ec2Instance, vol *ec2Volume) { vol.Attachments[0].InstanceID = newInstanceID }, want: "different instance"},
		{name: "attachment flag", mutate: func(_ *ec2Instance, vol *ec2Volume) { vol.Attachments[0].DeleteOnTermination = true }, want: "deletes with the instance"},
		{name: "two attachments", mutate: func(_ *ec2Instance, vol *ec2Volume) {
			vol.Attachments = append(vol.Attachments, vol.Attachments[0])
		}, want: "exactly one attachment"},
		{name: "not attached", mutate: func(_ *ec2Instance, vol *ec2Volume) { vol.Attachments = nil }, want: "not attached"},
		{name: "two data volumes", mutate: func(inst *ec2Instance, _ *ec2Volume) {
			cloned := *inst.BlockDeviceMappings[1].Ebs
			cloned.VolumeID = extraVolumeID
			mapping := inst.BlockDeviceMappings[1]
			mapping.DeviceName = "/dev/sdg"
			mapping.Ebs = &cloned
			inst.BlockDeviceMappings = append(inst.BlockDeviceMappings, mapping)
		}, want: "only data volume"},
		{name: "deletes on termination", mutate: func(inst *ec2Instance, _ *ec2Volume) {
			inst.BlockDeviceMappings[1].Ebs.DeleteOnTermination = true
		}, want: "deletes with the instance"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			inst := mustInstance(t, instanceDocument(oldInstanceID, oldVolumeID, false, false))
			vol := mustVolume(t, volumeDocument(volumeView{
				id: oldVolumeID, instanceID: oldInstanceID, state: "in-use", attach: "attached",
				size: 30, encrypted: true, volType: "gp3", purpose: volumePurpose, az: volumeAZ,
			}))
			tc.mutate(&inst, &vol)
			_, err := requireCurrent(linked, inst, vol)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want %q", err, tc.want)
			}
		})
	}
}

func TestReplaceDataVolumePreflightDoesNotMutate(t *testing.T) {
	runner := newWorld()
	opts, out := testOptions(runner)
	opts.Preflight = true
	opts.AssumeYes = false
	opts.Confirm = func(string) (bool, error) {
		t.Fatal("preflight must not ask for confirmation")
		return false, nil
	}
	if err := ReplaceDataVolume(context.Background(), opts); err != nil {
		t.Fatal(err)
	}
	if got := mutationNames(runner.calls); len(got) != 0 {
		t.Fatalf("preflight mutations = %v", got)
	}
	for _, script := range runner.scripts {
		if strings.Contains(script, "create_secret") || strings.Contains(script, "BEGIN") {
			t.Fatal("preflight ran a vault sync")
		}
	}
	text := out.String()
	for _, want := range []string{oldInstanceID, oldVolumeID, volumeKind, "30", volumeAZ} {
		if !strings.Contains(text, want) {
			t.Fatalf("preflight output %q missing %s", text, want)
		}
	}
	if strings.Contains(text, "notify-secret") {
		t.Fatal("preflight leaked the notify secret")
	}
}

func TestReplaceDataVolumeConfirmationGatesMutation(t *testing.T) {
	runner := newWorld()
	opts, _ := testOptions(runner)
	opts.AssumeYes = false
	var warning string
	opts.Confirm = func(message string) (bool, error) {
		warning = message
		return false, nil
	}
	if err := ReplaceDataVolume(context.Background(), opts); err == nil || err.Error() != "aborted" {
		t.Fatalf("error = %v", err)
	}
	if got := mutationNames(runner.calls); len(got) != 0 {
		t.Fatalf("declined confirmation mutated: %v", got)
	}
	for _, want := range []string{"PostgreSQL", "migration history", "DBOS", "Docker", "Vault", "no rollback", oldInstanceID, oldVolumeID} {
		if !strings.Contains(warning, want) {
			t.Fatalf("warning %q missing %s", warning, want)
		}
	}

	runner = newWorld()
	opts, out := testOptions(runner)
	opts.AssumeYes = false
	opts.Confirm = func(string) (bool, error) { return true, nil }
	if err := ReplaceDataVolume(context.Background(), opts); err != nil {
		t.Fatal(err)
	}
	assertReplaced(t, runner, out)
}

func TestReplaceDataVolumeRequiresExplicitConfirmation(t *testing.T) {
	runner := newWorld()
	opts, _ := testOptions(runner)
	opts.AssumeYes = false
	opts.Confirm = nil
	if err := ReplaceDataVolume(context.Background(), opts); err == nil || !strings.Contains(err.Error(), "confirmation") {
		t.Fatalf("error = %v", err)
	}
	if got := mutationNames(runner.calls); len(got) != 0 {
		t.Fatalf("missing confirmation mutated: %v", got)
	}
}

func TestReplaceDataVolumeRefusesChangedIdentity(t *testing.T) {
	runner := newWorld()
	runner.nextOldSize = 40
	opts, _ := testOptions(runner)
	if err := ReplaceDataVolume(context.Background(), opts); err == nil || !strings.Contains(err.Error(), "identity changed") {
		t.Fatalf("error = %v", err)
	}
	if got := mutationNames(runner.calls); len(got) != 0 {
		t.Fatalf("changed identity mutated: %v", got)
	}
}

func TestReplaceDataVolumeRefusesHostIdentityMismatch(t *testing.T) {
	runner := newWorld()
	runner.badIdentity = true
	opts, _ := testOptions(runner)
	if err := ReplaceDataVolume(context.Background(), opts); err == nil || !strings.Contains(err.Error(), "identity disagrees") {
		t.Fatalf("error = %v", err)
	}
	if got := mutationNames(runner.calls); len(got) != 0 {
		t.Fatalf("identity mismatch mutated: %v", got)
	}
}

func TestReplaceDataVolumeRefusesHostCardinality(t *testing.T) {
	for _, mode := range []string{"none", "two"} {
		t.Run(mode, func(t *testing.T) {
			runner := newWorld()
			runner.hosts = mode
			opts, _ := testOptions(runner)
			if err := ReplaceDataVolume(context.Background(), opts); err == nil {
				t.Fatal("expected refusal")
			}
			if got := mutationNames(runner.calls); len(got) != 0 {
				t.Fatalf("mutations = %v", got)
			}
		})
	}
}

func TestReplaceDataVolumeOrdersMutationAndPreservesShape(t *testing.T) {
	runner := newWorld()
	opts, out := testOptions(runner)
	if err := ReplaceDataVolume(context.Background(), opts); err != nil {
		t.Fatal(err)
	}
	assertReplaced(t, runner, out)
	want := []string{
		"ec2 terminate-instances",
		"ec2 wait instance-terminated",
		"ec2 wait volume-available",
		"ec2 delete-volume",
		"ec2 wait volume-deleted",
		"sst refresh",
		"sst deploy",
	}
	if got := mutationNames(runner.calls); !sameStrings(got, want) {
		t.Fatalf("mutations = %v, want %v", got, want)
	}
	for _, call := range runner.calls {
		if call.Program == "aws" {
			if !containsArg(call.Args, "--region", "ap-east-1") {
				t.Fatalf("aws call missing region: %v", call.Args)
			}
			if envValue(call.Env, "AWS_PROFILE") != "folio" || envValue(call.Env, "AWS_REGION") != "ap-east-1" {
				t.Fatal("aws call lost the resolved profile or region")
			}
			if envValue(call.Env, "PATH") != "/usr/bin" {
				t.Fatal("aws call dropped the base environment")
			}
		}
	}
	var deploy process.RunRequest
	for _, call := range runner.calls {
		if call.Program == "bunx" && containsString(call.Args, "deploy") {
			deploy = call
		}
		if call.Program == "bunx" && call.Dir != "/repo" {
			t.Fatalf("sst dir = %s", call.Dir)
		}
	}
	if envValue(deploy.Env, "HOST_INSTANCE_TYPE") != volumeKind || envValue(deploy.Env, "HOST_VOLUME_GB") != "30" {
		t.Fatalf("deploy env instance=%q size=%q", envValue(deploy.Env, "HOST_INSTANCE_TYPE"), envValue(deploy.Env, "HOST_VOLUME_GB"))
	}
	if envValue(deploy.Env, "AWS_PROFILE") != "folio" {
		t.Fatal("deploy did not receive the resolved profile")
	}
	for _, call := range runner.calls {
		if containsString(call.Args, "delete-volume") {
			if !containsString(call.Args, oldVolumeID) || containsString(call.Args, newVolumeID) {
				t.Fatalf("deleted unexpected volume: %v", call.Args)
			}
		}
	}
	if strings.Contains(out.String(), "notify-secret") {
		t.Fatal("stdout leaked the notify secret")
	}
}

func TestReplaceDataVolumeReportsPartialFailure(t *testing.T) {
	cases := []struct {
		fail      string
		phase     string
		completed string
		absent    string
	}{
		{fail: "ec2 terminate-instances", phase: "host_terminate", completed: "none", absent: "ec2 delete-volume"},
		{fail: "ec2 wait volume-available", phase: "volume_detach", completed: "host_terminated", absent: "ec2 delete-volume"},
		{fail: "ec2 delete-volume", phase: "volume_delete", completed: "volume_detached", absent: "sst refresh"},
		{fail: "sst refresh", phase: "sst_refresh", completed: "volume_deleted", absent: "sst deploy"},
		{fail: "sst deploy", phase: "sst_deploy", completed: "sst_refreshed", absent: ""},
	}
	for _, tc := range cases {
		t.Run(tc.fail, func(t *testing.T) {
			runner := newWorld()
			runner.fail = tc.fail
			opts, _ := testOptions(runner)
			err := ReplaceDataVolume(context.Background(), opts)
			if err == nil || !strings.Contains(err.Error(), tc.phase) || !strings.Contains(err.Error(), tc.completed) {
				t.Fatalf("error = %v", err)
			}
			if tc.absent != "" && containsString(mutationNames(runner.calls), tc.absent) {
				t.Fatalf("failure still ran %s: %v", tc.absent, mutationNames(runner.calls))
			}
		})
	}
}

func TestReplaceDataVolumeRejectsUnchangedReplacement(t *testing.T) {
	for _, mode := range []string{"instance", "volume", "missing"} {
		t.Run(mode, func(t *testing.T) {
			runner := newWorld()
			switch mode {
			case "instance":
				runner.sameInstance = true
			case "volume":
				runner.sameVolume = true
			case "missing":
				runner.replacementMissing = true
			}
			opts, _ := testOptions(runner)
			err := ReplaceDataVolume(context.Background(), opts)
			if err == nil || !strings.Contains(err.Error(), "replacement_verify") || !strings.Contains(err.Error(), "sst_deployed") {
				t.Fatalf("error = %v", err)
			}
		})
	}
}

func TestReplaceDataVolumeReportsReadinessAndVaultFailures(t *testing.T) {
	t.Run("readiness", func(t *testing.T) {
		runner := newWorld()
		runner.notReady = true
		opts, _ := testOptions(runner)
		opts.ReadyTimeout = time.Millisecond
		opts.ReadyInterval = time.Millisecond
		err := ReplaceDataVolume(context.Background(), opts)
		if err == nil || !strings.Contains(err.Error(), "host_ready") || !strings.Contains(err.Error(), "replacement_verified") {
			t.Fatalf("error = %v", err)
		}
		if strings.Contains(err.Error(), "notify-secret") {
			t.Fatal("error leaked the notify secret")
		}
	})
	t.Run("vault", func(t *testing.T) {
		runner := newWorld()
		runner.noVaultPriv = true
		opts, _ := testOptions(runner)
		err := ReplaceDataVolume(context.Background(), opts)
		if err == nil || !strings.Contains(err.Error(), "vault_sync") || !strings.Contains(err.Error(), "host_ready") {
			t.Fatalf("error = %v", err)
		}
		if strings.Contains(err.Error(), "notify-secret") {
			t.Fatal("error leaked the notify secret")
		}
	})
}

func TestHostVolumeIdentityContract(t *testing.T) {
	body, err := os.ReadFile("../../../../infra/host.ts")
	if err != nil {
		t.Fatal(err)
	}
	text := string(body)
	for _, want := range []string{
		`Purpose: "supabase-data"`,
		"${$app.name}-${$app.stage}-supabase-data",
		`new sst.Linkable("HostDataVolumeId"`,
		"id: dataVolume.id",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("infra/host.ts missing %s", want)
		}
	}
}

func TestOverlayEnvReplacesOnlyNamedKeys(t *testing.T) {
	got := overlayEnv([]string{"PATH=/usr/bin", "AWS_PROFILE=ambient", "KEEP=yes"}, map[string]string{
		"AWS_PROFILE": "folio",
		"AWS_REGION":  "ap-east-1",
	})
	if envValue(got, "PATH") != "/usr/bin" || envValue(got, "KEEP") != "yes" {
		t.Fatalf("base keys changed: %v", got)
	}
	if envValue(got, "AWS_PROFILE") != "folio" || envValue(got, "AWS_REGION") != "ap-east-1" {
		t.Fatalf("overlay = %v", got)
	}
}

func assertReplaced(t *testing.T, runner *world, out *bytes.Buffer) {
	t.Helper()
	text := out.String()
	for _, want := range []string{oldInstanceID, newInstanceID, oldVolumeID, newVolumeID, "vault synced"} {
		if !strings.Contains(text, want) {
			t.Fatalf("output %q missing %s", text, want)
		}
	}
	if !runner.deleted || !runner.deployed {
		t.Fatalf("deleted=%t deployed=%t", runner.deleted, runner.deployed)
	}
}

func testOptions(runner process.Runner) (ReplaceOptions, *bytes.Buffer) {
	now := time.Unix(0, 0)
	out := &bytes.Buffer{}
	return ReplaceOptions{
		ConfiguredStage: volumeStage,
		Region:          "ap-east-1",
		AWSProfile:      "folio",
		Root:            "/repo",
		Resources:       goodVolumeResources(),
		Runner:          runner,
		AssumeYes:       true,
		Stdout:          out,
		Env:             []string{"PATH=/usr/bin", "AWS_PROFILE=ambient", "KEEP=yes"},
		Now:             func() time.Time { return now },
		Sleep: func(context.Context, time.Duration) error {
			now = now.Add(replacementPoll)
			return nil
		},
		ReadyTimeout:  50 * time.Millisecond,
		ReadyInterval: 10 * time.Millisecond,
	}, out
}

type res map[string]string

func (r res) String(name, property string) (string, error) {
	value, ok := r[name+"."+property]
	if !ok || value == "" {
		return "", errors.New("unavailable")
	}
	return value, nil
}

func goodVolumeResources() res {
	return res{
		"App.stage":           volumeStage,
		"App.name":            volumeApp,
		"HostDataVolumeId.id": oldVolumeID,
		"GoApi.url":           "https://api.example.com/staging/",
		"NotifySecret.value":  "notify-secret",
	}
}

type world struct {
	calls              []process.RunRequest
	scripts            []string
	fail               string
	hosts              string
	badIdentity        bool
	notReady           bool
	noVaultPriv        bool
	sameInstance       bool
	sameVolume         bool
	replacementMissing bool
	nextOldSize        int
	oldReads           int
	deployed           bool
	deleted            bool
	lastStdout         string
}

func newWorld() *world { return &world{} }

func (w *world) Run(_ context.Context, req process.RunRequest) error {
	w.calls = append(w.calls, req)
	name := callName(req)
	if w.fail != "" && name == w.fail {
		return errors.New("boom")
	}
	switch name {
	case "ec2 describe-instances":
		_, _ = req.Stdout.Write([]byte(w.instances(req.Args)))
	case "ec2 describe-volumes":
		_, _ = req.Stdout.Write([]byte(w.volumes(req.Args)))
	case "ssm send-command":
		script := flagValue(req.Args, "--parameters")
		w.scripts = append(w.scripts, script)
		w.lastStdout = w.scriptStdout(script)
		_, _ = req.Stdout.Write([]byte("cmd-1\n"))
	case "ssm get-command-invocation":
		body, err := json.Marshal(map[string]string{
			"Status":                "Success",
			"StandardOutputContent": w.lastStdout,
			"StandardErrorContent":  "",
		})
		if err != nil {
			return err
		}
		_, _ = req.Stdout.Write(body)
	case "ec2 delete-volume":
		if !containsString(req.Args, oldVolumeID) || containsString(req.Args, newVolumeID) {
			return errors.New("refusing to delete an unexpected volume")
		}
		w.deleted = true
	case "sst deploy":
		w.deployed = true
	}
	return nil
}

func (w *world) instances(args []string) string {
	if w.hosts == "none" && containsString(args, "tag:Name") {
		return `{"Reservations":[]}`
	}
	if w.hosts == "two" && containsString(args, "tag:Name") {
		return `{"Reservations":[{"Instances":[
			{"InstanceId":"` + oldInstanceID + `","Tags":[{"Key":"Name","Value":"sqldev-staging-supabase"},{"Key":"Application","Value":"sqldev"},{"Key":"Stage","Value":"staging"}]},
			{"InstanceId":"` + newInstanceID + `","Tags":[{"Key":"Name","Value":"sqldev-staging-supabase"},{"Key":"Application","Value":"sqldev"},{"Key":"Stage","Value":"staging"}]}
		]}]}`
	}
	if w.deployed && w.replacementMissing {
		return `{"Reservations":[]}`
	}
	id, volumeID := oldInstanceID, oldVolumeID
	if w.deployed {
		id, volumeID = newInstanceID, newVolumeID
		if w.sameInstance {
			id = oldInstanceID
		}
		if w.sameVolume {
			volumeID = oldVolumeID
		}
	}
	if containsString(args, "--instance-ids") && !containsString(args, id) {
		return `{"Reservations":[]}`
	}
	return instanceDocument(id, volumeID, false, false)
}

func (w *world) volumes(args []string) string {
	if containsString(args, oldVolumeID) {
		w.oldReads++
		if w.deleted && !w.sameVolume {
			return `{"Volumes":[]}`
		}
		size := 30
		if w.nextOldSize != 0 && w.oldReads >= 2 {
			size = w.nextOldSize
		}
		owner := oldInstanceID
		if w.deployed {
			owner = newInstanceID
		}
		return volumeDocument(volumeView{
			id: oldVolumeID, instanceID: owner, state: "in-use", attach: "attached",
			size: size, encrypted: true, volType: "gp3", purpose: volumePurpose, az: volumeAZ,
		})
	}
	if containsString(args, newVolumeID) && w.deployed {
		return volumeDocument(volumeView{
			id: newVolumeID, instanceID: newInstanceID, state: "in-use", attach: "attached",
			size: 30, encrypted: true, volType: "gp3", purpose: volumePurpose, az: volumeAZ,
		})
	}
	return `{"Volumes":[]}`
}

func (w *world) scriptStdout(script string) string {
	switch {
	case strings.Contains(script, "pg_isready"):
		if w.notReady {
			return "HOST_NOT_READY\n"
		}
		return "HOST_READY\n"
	case strings.Contains(script, "has_function_privilege"):
		if w.noVaultPriv {
			return "VAULT_NAMES_BEGIN\nVAULT_NAMES_END\nVAULT_CAN_CREATE:\nf\nVAULT_CAN_UPDATE:\nf\n"
		}
		return "VAULT_NAMES_BEGIN\nVAULT_NAMES_END\nVAULT_CAN_CREATE:\nt\nVAULT_CAN_UPDATE:\nt\n"
	case strings.Contains(script, "create_secret"):
		return "VAULT_SYNCED\nVAULT_NAMES_BEGIN\nnotify_ig_posts_view_secret\nnotify_ig_posts_view_url\nrender_md_url\nVAULT_NAMES_END\n"
	case strings.Contains(script, "app_name"):
		stage := volumeStage
		if w.badIdentity {
			stage = "prod"
		}
		return fmt.Sprintf(`{"app_name":%q,"stage":%q,"app_bucket":"app","job_result_bucket":"job"}`, volumeApp, stage)
	default:
		return ""
	}
}

type volumeView struct {
	id, instanceID, state, attach, volType, purpose, az string
	size                                                int
	encrypted                                           bool
}

func instanceDocument(id, dataID string, deleteData, extra bool) string {
	flag := "false"
	if deleteData {
		flag = "true"
	}
	extraMapping := ""
	if extra {
		extraMapping = `,{"DeviceName":"/dev/sdg","Ebs":{"VolumeId":"` + extraVolumeID + `","DeleteOnTermination":false}}`
	}
	return `{
		"Reservations":[{"Instances":[{
			"InstanceId":"` + id + `",
			"InstanceType":"` + volumeKind + `",
			"RootDeviceName":"/dev/xvda",
			"Placement":{"AvailabilityZone":"` + volumeAZ + `"},
			"State":{"Name":"running"},
			"Tags":[
				{"Key":"Name","Value":"sqldev-staging-supabase"},
				{"Key":"Application","Value":"sqldev"},
				{"Key":"Stage","Value":"staging"}
			],
			"BlockDeviceMappings":[
				{"DeviceName":"/dev/xvda","Ebs":{"VolumeId":"` + rootVolumeID + `","DeleteOnTermination":true}},
				{"DeviceName":"/dev/sdf","Ebs":{"VolumeId":"` + dataID + `","DeleteOnTermination":` + flag + `}}` + extraMapping + `
			]
		}]}]
	}`
}

func volumeDocument(v volumeView) string {
	encrypted := "false"
	if v.encrypted {
		encrypted = "true"
	}
	return `{
		"Volumes":[{
			"VolumeId":"` + v.id + `",
			"Size":` + fmt.Sprintf("%d", v.size) + `,
			"VolumeType":"` + v.volType + `",
			"Encrypted":` + encrypted + `,
			"AvailabilityZone":"` + v.az + `",
			"State":"` + v.state + `",
			"Tags":[
				{"Key":"Name","Value":"sqldev-staging-supabase-data"},
				{"Key":"Application","Value":"sqldev"},
				{"Key":"Stage","Value":"staging"},
				{"Key":"Purpose","Value":"` + v.purpose + `"}
			],
			"Attachments":[{"InstanceId":"` + v.instanceID + `","State":"` + v.attach + `","DeleteOnTermination":false}]
		}]
	}`
}

func mustInstance(t *testing.T, doc string) ec2Instance {
	t.Helper()
	inst, err := parseInstance(doc)
	if err != nil {
		t.Fatal(err)
	}
	return inst
}

func mustVolume(t *testing.T, doc string) ec2Volume {
	t.Helper()
	vol, err := parseVolume(doc)
	if err != nil {
		t.Fatal(err)
	}
	return vol
}

func callName(req process.RunRequest) string {
	if req.Program == "bunx" {
		for i, arg := range req.Args {
			if arg == "sst" && i+1 < len(req.Args) {
				return "sst " + req.Args[i+1]
			}
		}
	}
	if req.Program == "aws" && len(req.Args) >= 2 {
		if req.Args[0] == "ec2" && req.Args[1] == "wait" && len(req.Args) >= 3 {
			return "ec2 wait " + req.Args[2]
		}
		return req.Args[0] + " " + req.Args[1]
	}
	return req.Program
}

func mutationNames(calls []process.RunRequest) []string {
	var names []string
	for _, call := range calls {
		switch name := callName(call); name {
		case "ec2 terminate-instances", "ec2 wait instance-terminated", "ec2 wait volume-available",
			"ec2 delete-volume", "ec2 wait volume-deleted", "sst refresh", "sst deploy":
			names = append(names, name)
		}
	}
	return names
}

func flagValue(args []string, name string) string {
	for i, arg := range args {
		if arg == name && i+1 < len(args) {
			return args[i+1]
		}
	}
	return ""
}

func containsArg(args []string, name, value string) bool {
	return flagValue(args, name) == value
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want || strings.Contains(value, want) {
			return true
		}
	}
	return false
}

func sameStrings(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

func envValue(env []string, key string) string {
	prefix := key + "="
	for _, entry := range env {
		if strings.HasPrefix(entry, prefix) {
			return strings.TrimPrefix(entry, prefix)
		}
	}
	return ""
}
