package host

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gregidonut/sqldev/packages/cli/internal/e2ereset"
	"github.com/gregidonut/sqldev/packages/cli/internal/process"
)

const (
	volumeStage       = "staging"
	volumePurpose     = "supabase-data"
	minVolumeGiB      = 30
	maxVolumeGiB      = 65536
	replacementBudget = 5 * time.Minute
	replacementPoll   = 5 * time.Second
)

var (
	errInstanceAbsent     = errors.New("instance is absent")
	errVolumeAbsent       = errors.New("volume is absent")
	errReplacementPending = errors.New("replacement is not ready")

	instanceIDPattern   = regexp.MustCompile(`^i-[A-Za-z0-9]+$`)
	volumeIDPattern     = regexp.MustCompile(`^vol-[A-Za-z0-9]+$`)
	regionPattern       = regexp.MustCompile(`^[a-z]{2}-[a-z]+-\d+$`)
	profilePattern      = regexp.MustCompile(`^[A-Za-z0-9_+=,.@-]+$`)
	appNamePattern      = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]*$`)
	instanceTypePattern = regexp.MustCompile(`^[a-z][a-z0-9-]*\.[a-z0-9]+$`)
	azPattern           = regexp.MustCompile(`^[a-z]{2}-[a-z]+-\d[a-z]$`)
)

// ResourceReader is the subset of linked SST resources this workflow reads.
type ResourceReader interface {
	String(name, property string) (string, error)
}

// ConfirmFunc asks the operator to confirm the permanent data-volume deletion.
type ConfirmFunc func(message string) (bool, error)

// ReplaceOptions configures an exact-staging data-volume replacement.
// A nil Confirm is refused unless Preflight or AssumeYes is set.
type ReplaceOptions struct {
	ConfiguredStage string
	Region          string
	AWSProfile      string
	Root            string
	Resources       ResourceReader
	Runner          process.Runner
	Preflight       bool
	AssumeYes       bool
	Stdout          io.Writer
	Env             []string
	Confirm         ConfirmFunc
	// Now and Sleep override the post-deploy readiness clock. Nil uses real time.
	Now   func() time.Time
	Sleep func(context.Context, time.Duration) error
	// ReadyTimeout and ReadyInterval override the bootstrap probe. Zero keeps
	// the executor defaults.
	ReadyTimeout  time.Duration
	ReadyInterval time.Duration
}

// volumePlan is the identity that must stay unchanged between confirmation and
// the first destructive call. It is comparable.
type volumePlan struct {
	AppName          string
	InstanceID       string
	InstanceType     string
	AvailabilityZone string
	VolumeID         string
	VolumeSize       int
}

type linkedVolume struct {
	AppName  string
	VolumeID string
}

type ec2Tag struct {
	Key   string `json:"Key"`
	Value string `json:"Value"`
}

type ec2Instance struct {
	InstanceID     string `json:"InstanceId"`
	InstanceType   string `json:"InstanceType"`
	RootDeviceName string `json:"RootDeviceName"`
	Placement      struct {
		AvailabilityZone string `json:"AvailabilityZone"`
	} `json:"Placement"`
	State struct {
		Name string `json:"Name"`
	} `json:"State"`
	Tags                []ec2Tag `json:"Tags"`
	BlockDeviceMappings []struct {
		DeviceName string `json:"DeviceName"`
		Ebs        *struct {
			VolumeID            string `json:"VolumeId"`
			DeleteOnTermination bool   `json:"DeleteOnTermination"`
		} `json:"Ebs"`
	} `json:"BlockDeviceMappings"`
}

type blockVolume struct {
	ID                  string
	DeleteOnTermination bool
}

type ec2Volume struct {
	VolumeID         string   `json:"VolumeId"`
	Size             int      `json:"Size"`
	VolumeType       string   `json:"VolumeType"`
	Encrypted        bool     `json:"Encrypted"`
	AvailabilityZone string   `json:"AvailabilityZone"`
	State            string   `json:"State"`
	Tags             []ec2Tag `json:"Tags"`
	Attachments      []struct {
		InstanceID          string `json:"InstanceId"`
		State               string `json:"State"`
		DeleteOnTermination bool   `json:"DeleteOnTermination"`
	} `json:"Attachments"`
}

// ReplaceDataVolume replaces the staging host data volume with a new empty
// volume, waits until bootstrap has applied migrations, and restores Vault.
// Preflight validates identity and does not mutate. There is no rollback.
func ReplaceDataVolume(ctx context.Context, opts ReplaceOptions) error {
	if opts.ConfiguredStage != volumeStage {
		return fmt.Errorf("data volume replace refused: configured stage is not exactly %q", volumeStage)
	}
	linked, err := loadLinkedVolume(opts)
	if err != nil {
		return err
	}
	op := newReplacer(opts)
	plan, err := op.authorize(ctx, linked)
	if err != nil {
		return err
	}
	if opts.Preflight {
		op.printf("data-volume preflight: host=%s volume=%s instance_type=%s size=%d az=%s\n",
			plan.InstanceID, plan.VolumeID, plan.InstanceType, plan.VolumeSize, plan.AvailabilityZone)
		return nil
	}
	if !opts.AssumeYes {
		if opts.Confirm == nil {
			return errors.New("data volume replace requires confirmation")
		}
		ok, err := opts.Confirm(replacementWarning(plan))
		if err != nil {
			return err
		}
		if !ok {
			return errors.New("aborted")
		}
	}
	again, err := op.authorize(ctx, linked)
	if err != nil {
		return err
	}
	if again != plan {
		return errors.New("data volume replace refused: staging identity changed before replacement")
	}
	return op.execute(ctx, plan)
}

func replacementWarning(plan volumePlan) string {
	return fmt.Sprintf(
		"This permanently deletes staging data volume %s on host %s (%s, %d GiB). PostgreSQL, migration history, DBOS state, Docker data, and Vault secrets on that volume are destroyed. Deployment failure can leave staging without a host or volume, and there is no rollback. Continue?",
		plan.VolumeID, plan.InstanceID, plan.InstanceType, plan.VolumeSize,
	)
}

func loadLinkedVolume(opts ReplaceOptions) (linkedVolume, error) {
	if opts.Resources == nil {
		return linkedVolume{}, errors.New("data volume replace refused: linked resources are unavailable")
	}
	if !regionPattern.MatchString(opts.Region) {
		return linkedVolume{}, errors.New("data volume replace refused: aws region is not valid")
	}
	if opts.AWSProfile != "" && !profilePattern.MatchString(opts.AWSProfile) {
		return linkedVolume{}, errors.New("data volume replace refused: aws profile is not valid")
	}
	if strings.TrimSpace(opts.Root) == "" {
		return linkedVolume{}, errors.New("data volume replace refused: repository root is empty")
	}
	linkedStage, err := opts.Resources.String("App", "stage")
	if err != nil || linkedStage != volumeStage {
		return linkedVolume{}, fmt.Errorf("data volume replace refused: linked App.stage is not exactly %q", volumeStage)
	}
	appName, err := opts.Resources.String("App", "name")
	if err != nil || !appNamePattern.MatchString(appName) {
		return linkedVolume{}, errors.New("data volume replace refused: linked App.name is not valid")
	}
	volumeID, err := opts.Resources.String("HostDataVolumeId", "id")
	if err != nil || !volumeIDPattern.MatchString(volumeID) {
		return linkedVolume{}, errors.New("data volume replace refused: linked HostDataVolumeId.id is unavailable; deploy the staging host volume identity first")
	}
	goAPI, err := opts.Resources.String("GoApi", "url")
	if err != nil {
		return linkedVolume{}, errors.New("data volume replace refused: linked GoApi.url is unavailable")
	}
	notifySecret, err := opts.Resources.String("NotifySecret", "value")
	if err != nil {
		return linkedVolume{}, errors.New("data volume replace refused: linked NotifySecret is unavailable")
	}
	if _, err := e2ereset.BuildVaultSecrets(goAPI, notifySecret); err != nil {
		return linkedVolume{}, err
	}
	return linkedVolume{AppName: appName, VolumeID: volumeID}, nil
}

type replacer struct {
	opts   ReplaceOptions
	runner process.Runner
	env    []string
	now    func() time.Time
	sleep  func(context.Context, time.Duration) error
}

func newReplacer(opts ReplaceOptions) *replacer {
	env := opts.Env
	if env == nil {
		env = os.Environ()
	}
	values := map[string]string{"AWS_REGION": opts.Region}
	if opts.AWSProfile != "" {
		values["AWS_PROFILE"] = opts.AWSProfile
	}
	env = overlayEnv(env, values)
	now := opts.Now
	if now == nil {
		now = time.Now
	}
	sleep := opts.Sleep
	if sleep == nil {
		sleep = sleepCtx
	}
	return &replacer{
		opts:   opts,
		runner: envRunner{base: opts.Runner, env: env},
		env:    env,
		now:    now,
		sleep:  sleep,
	}
}

func (op *replacer) executor() *e2ereset.HostExecutor {
	ex := e2ereset.NewHostExecutor(op.runner, op.opts.Region)
	if op.opts.ReadyTimeout > 0 || op.opts.ReadyInterval > 0 {
		ex.WithReadinessWindow(op.opts.ReadyTimeout, op.opts.ReadyInterval)
	}
	return ex
}

func (op *replacer) authorize(ctx context.Context, linked linkedVolume) (volumePlan, error) {
	discovered, err := (&e2ereset.HostDiscoverer{Runner: op.runner, Region: op.opts.Region}).ResolveStagingHost(ctx, linked.AppName)
	if err != nil {
		return volumePlan{}, err
	}
	if !instanceIDPattern.MatchString(discovered.InstanceID) {
		return volumePlan{}, errors.New("data volume replace refused: staging host id is not valid")
	}
	if discovered.NameTag != stagingHostName() || discovered.AppTag != linked.AppName || discovered.StageTag != volumeStage {
		return volumePlan{}, errors.New("data volume replace refused: staging host tags do not match")
	}
	inst, err := op.describeInstance(ctx, discovered.InstanceID)
	if errors.Is(err, errInstanceAbsent) {
		return volumePlan{}, errors.New("data volume replace refused: staging host was not found")
	}
	if err != nil {
		return volumePlan{}, err
	}
	if inst.InstanceID != discovered.InstanceID {
		return volumePlan{}, errors.New("data volume replace refused: described host is not the discovered host")
	}
	vol, err := op.describeVolume(ctx, linked.VolumeID)
	if errors.Is(err, errVolumeAbsent) {
		return volumePlan{}, errors.New("data volume replace refused: linked data volume was not found")
	}
	if err != nil {
		return volumePlan{}, err
	}
	plan, err := requireCurrent(linked, inst, vol)
	if err != nil {
		return volumePlan{}, err
	}
	identity, err := op.executor().ProbeIdentity(ctx, plan.InstanceID)
	if err != nil {
		return volumePlan{}, err
	}
	if identity.Stage != volumeStage || identity.AppName != linked.AppName {
		return volumePlan{}, errors.New("data volume replace refused: staging host identity disagrees with the linked app")
	}
	return plan, nil
}

func (op *replacer) execute(ctx context.Context, plan volumePlan) error {
	var completed []string
	op.printf("replacing data volume %s on %s\n", plan.VolumeID, plan.InstanceID)

	if _, err := op.ec2(ctx, "terminate-instances", "--instance-ids", plan.InstanceID); err != nil {
		return failed(completed, "host_terminate", err)
	}
	completed = append(completed, "host_terminated")
	if _, err := op.ec2(ctx, "wait", "instance-terminated", "--instance-ids", plan.InstanceID); err != nil {
		return failed(completed, "host_terminate_wait", err)
	}
	if _, err := op.ec2(ctx, "wait", "volume-available", "--volume-ids", plan.VolumeID); err != nil {
		return failed(completed, "volume_detach", err)
	}
	completed = append(completed, "volume_detached")
	if _, err := op.ec2(ctx, "delete-volume", "--volume-id", plan.VolumeID); err != nil {
		return failed(completed, "volume_delete", err)
	}
	completed = append(completed, "volume_deleted")
	if _, err := op.ec2(ctx, "wait", "volume-deleted", "--volume-ids", plan.VolumeID); err != nil {
		return failed(completed, "volume_delete_wait", err)
	}
	if err := op.sst(ctx, "refresh", nil); err != nil {
		return failed(completed, "sst_refresh", err)
	}
	completed = append(completed, "sst_refreshed")
	deployEnv := overlayEnv(op.env, map[string]string{
		"HOST_INSTANCE_TYPE": plan.InstanceType,
		"HOST_VOLUME_GB":     strconv.Itoa(plan.VolumeSize),
	})
	if err := op.sst(ctx, "deploy", deployEnv); err != nil {
		return failed(completed, "sst_deploy", err)
	}
	completed = append(completed, "sst_deployed")

	replacement, err := op.waitReplacement(ctx, plan)
	if err != nil {
		return failed(completed, "replacement_verify", err)
	}
	completed = append(completed, "replacement_verified")
	if err := op.executor().WaitReady(ctx, replacement.InstanceID); err != nil {
		return failed(completed, "host_ready", err)
	}
	completed = append(completed, "host_ready")
	op.printf("data-volume replaced: old_host=%s new_host=%s old_volume=%s new_volume=%s\n",
		plan.InstanceID, replacement.InstanceID, plan.VolumeID, replacement.VolumeID)

	if err := e2ereset.SyncVault(ctx, e2ereset.VaultOptions{
		ConfiguredStage: op.opts.ConfiguredStage,
		Region:          op.opts.Region,
		Resources:       op.opts.Resources,
		Runner:          op.runner,
		Stdout:          op.opts.Stdout,
	}); err != nil {
		return failed(completed, "vault_sync", err)
	}
	return nil
}

func (op *replacer) waitReplacement(ctx context.Context, old volumePlan) (volumePlan, error) {
	deadline := op.now().Add(replacementBudget)
	var pending error
	for {
		if err := ctx.Err(); err != nil {
			return volumePlan{}, err
		}
		plan, err := op.observeReplacement(ctx, old)
		if err == nil {
			return plan, nil
		}
		if !errors.Is(err, errReplacementPending) {
			return volumePlan{}, err
		}
		pending = err
		if !op.now().Before(deadline) {
			return volumePlan{}, fmt.Errorf("replacement did not become ready: %w", pending)
		}
		if err := op.sleep(ctx, replacementPoll); err != nil {
			return volumePlan{}, err
		}
	}
}

func (op *replacer) observeReplacement(ctx context.Context, old volumePlan) (volumePlan, error) {
	discovered, err := (&e2ereset.HostDiscoverer{Runner: op.runner, Region: op.opts.Region}).ResolveStagingHost(ctx, old.AppName)
	if err != nil {
		if strings.Contains(err.Error(), "no running staging host") {
			return volumePlan{}, errReplacementPending
		}
		return volumePlan{}, err
	}
	if !instanceIDPattern.MatchString(discovered.InstanceID) {
		return volumePlan{}, errors.New("data volume replace refused: replacement host id is not valid")
	}
	inst, err := op.describeInstance(ctx, discovered.InstanceID)
	if errors.Is(err, errInstanceAbsent) {
		return volumePlan{}, errReplacementPending
	}
	if err != nil {
		return volumePlan{}, err
	}
	volumes, err := dataVolumes(inst)
	if err != nil {
		return volumePlan{}, err
	}
	if len(volumes) == 0 {
		return volumePlan{}, errReplacementPending
	}
	if len(volumes) != 1 {
		return volumePlan{}, errors.New("data volume replace refused: replacement host does not have exactly one data volume")
	}
	vol, err := op.describeVolume(ctx, volumes[0].ID)
	if errors.Is(err, errVolumeAbsent) {
		return volumePlan{}, errReplacementPending
	}
	if err != nil {
		return volumePlan{}, err
	}
	return assessReplacement(old, inst, volumes[0], vol)
}

func (op *replacer) describeInstance(ctx context.Context, instanceID string) (ec2Instance, error) {
	if !instanceIDPattern.MatchString(instanceID) {
		return ec2Instance{}, errors.New("data volume replace refused: instance id is not valid")
	}
	body, err := op.ec2(ctx, "describe-instances", "--instance-ids", instanceID, "--output", "json")
	if err != nil {
		return ec2Instance{}, err
	}
	return parseInstance(body)
}

func (op *replacer) describeVolume(ctx context.Context, volumeID string) (ec2Volume, error) {
	if !volumeIDPattern.MatchString(volumeID) {
		return ec2Volume{}, errors.New("data volume replace refused: volume id is not valid")
	}
	body, err := op.ec2(ctx, "describe-volumes", "--volume-ids", volumeID, "--output", "json")
	if err != nil {
		return ec2Volume{}, err
	}
	return parseVolume(body)
}

func (op *replacer) ec2(ctx context.Context, args ...string) (string, error) {
	full := append([]string{"ec2"}, args...)
	full = append(full, "--region", op.opts.Region)
	return op.capture(ctx, "aws", full, "")
}

func (op *replacer) sst(ctx context.Context, command string, env []string) error {
	_, err := op.capture(ctx, "bunx", []string{"--no-install", "sst", command, "--stage", volumeStage}, op.opts.Root, env)
	return err
}

func (op *replacer) capture(ctx context.Context, program string, args []string, dir string, env ...[]string) (string, error) {
	var out bytes.Buffer
	req := process.RunRequest{Program: program, Args: args, Dir: dir, Stdout: &out}
	if len(env) > 0 {
		req.Env = env[0]
	}
	err := op.runner.Run(ctx, req)
	return out.String(), err
}

func (op *replacer) printf(format string, args ...any) {
	if op.opts.Stdout == nil {
		return
	}
	fmt.Fprintf(op.opts.Stdout, format, args...)
}

func requireCurrent(linked linkedVolume, inst ec2Instance, vol ec2Volume) (volumePlan, error) {
	if inst.InstanceID == "" || inst.State.Name != "running" {
		return volumePlan{}, errors.New("data volume replace refused: staging host is not running")
	}
	if tagValue(inst.Tags, "Name") != stagingHostName() || tagValue(inst.Tags, "Application") != linked.AppName || tagValue(inst.Tags, "Stage") != volumeStage {
		return volumePlan{}, errors.New("data volume replace refused: staging host tags do not match")
	}
	if !instanceTypePattern.MatchString(inst.InstanceType) {
		return volumePlan{}, errors.New("data volume replace refused: instance type is not valid")
	}
	if !azPattern.MatchString(inst.Placement.AvailabilityZone) {
		return volumePlan{}, errors.New("data volume replace refused: availability zone is not valid")
	}
	if inst.RootDeviceName == "" {
		return volumePlan{}, errors.New("data volume replace refused: staging host has no root device")
	}
	volumes, err := dataVolumes(inst)
	if err != nil {
		return volumePlan{}, err
	}
	if len(volumes) != 1 || volumes[0].ID != linked.VolumeID {
		return volumePlan{}, errors.New("data volume replace refused: staging host does not have the linked data volume as its only data volume")
	}
	if volumes[0].DeleteOnTermination {
		return volumePlan{}, errors.New("data volume replace refused: data volume deletes with the instance")
	}
	if vol.VolumeID != linked.VolumeID {
		return volumePlan{}, errors.New("data volume replace refused: described volume is not the linked data volume")
	}
	if err := volumeShape(linked.AppName, vol); err != nil {
		return volumePlan{}, err
	}
	if vol.State != "in-use" {
		return volumePlan{}, errors.New("data volume replace refused: data volume is not in use")
	}
	if vol.AvailabilityZone != inst.Placement.AvailabilityZone {
		return volumePlan{}, errors.New("data volume replace refused: data volume is in a different availability zone")
	}
	if err := requireAttachment(inst.InstanceID, vol); err != nil {
		if errors.Is(err, errReplacementPending) {
			return volumePlan{}, errors.New("data volume replace refused: data volume is not attached")
		}
		return volumePlan{}, err
	}
	return volumePlan{
		AppName:          linked.AppName,
		InstanceID:       inst.InstanceID,
		InstanceType:     inst.InstanceType,
		AvailabilityZone: inst.Placement.AvailabilityZone,
		VolumeID:         vol.VolumeID,
		VolumeSize:       vol.Size,
	}, nil
}

func assessReplacement(old volumePlan, inst ec2Instance, mapped blockVolume, vol ec2Volume) (volumePlan, error) {
	if inst.InstanceID == old.InstanceID {
		return volumePlan{}, errors.New("data volume replace refused: replacement host id did not change")
	}
	if vol.VolumeID == old.VolumeID || mapped.ID == old.VolumeID {
		return volumePlan{}, errors.New("data volume replace refused: replacement volume id did not change")
	}
	if mapped.ID != vol.VolumeID {
		return volumePlan{}, errors.New("data volume replace refused: replacement attachment does not match the described volume")
	}
	if mapped.DeleteOnTermination {
		return volumePlan{}, errors.New("data volume replace refused: replacement data volume deletes with the instance")
	}
	if tagValue(inst.Tags, "Name") != stagingHostName() || tagValue(inst.Tags, "Application") != old.AppName || tagValue(inst.Tags, "Stage") != volumeStage {
		return volumePlan{}, errors.New("data volume replace refused: replacement host tags do not match")
	}
	if inst.InstanceType != old.InstanceType {
		return volumePlan{}, errors.New("data volume replace refused: replacement instance type changed")
	}
	if vol.Size != old.VolumeSize {
		return volumePlan{}, errors.New("data volume replace refused: replacement volume size changed")
	}
	if err := volumeShape(old.AppName, vol); err != nil {
		return volumePlan{}, err
	}
	if vol.AvailabilityZone != old.AvailabilityZone || inst.Placement.AvailabilityZone != old.AvailabilityZone {
		return volumePlan{}, errors.New("data volume replace refused: replacement availability zone changed")
	}
	if inst.State.Name != "running" || vol.State != "in-use" {
		return volumePlan{}, errReplacementPending
	}
	if err := requireAttachment(inst.InstanceID, vol); err != nil {
		return volumePlan{}, err
	}
	return volumePlan{
		AppName:          old.AppName,
		InstanceID:       inst.InstanceID,
		InstanceType:     inst.InstanceType,
		AvailabilityZone: inst.Placement.AvailabilityZone,
		VolumeID:         vol.VolumeID,
		VolumeSize:       vol.Size,
	}, nil
}

func volumeShape(appName string, vol ec2Volume) error {
	if !volumeIDPattern.MatchString(vol.VolumeID) {
		return errors.New("data volume replace refused: volume id is not valid")
	}
	if !vol.Encrypted {
		return errors.New("data volume replace refused: data volume is not encrypted")
	}
	if vol.VolumeType != "gp3" {
		return errors.New("data volume replace refused: data volume is not gp3")
	}
	if vol.Size < minVolumeGiB || vol.Size > maxVolumeGiB {
		return errors.New("data volume replace refused: data volume size is outside the supported range")
	}
	if !azPattern.MatchString(vol.AvailabilityZone) {
		return errors.New("data volume replace refused: data volume availability zone is not valid")
	}
	if tagValue(vol.Tags, "Name") != volumeName(appName) ||
		tagValue(vol.Tags, "Application") != appName ||
		tagValue(vol.Tags, "Stage") != volumeStage ||
		tagValue(vol.Tags, "Purpose") != volumePurpose {
		return errors.New("data volume replace refused: data volume tags do not match")
	}
	return nil
}

func requireAttachment(instanceID string, vol ec2Volume) error {
	if len(vol.Attachments) == 0 {
		return errReplacementPending
	}
	if len(vol.Attachments) != 1 {
		return errors.New("data volume replace refused: data volume does not have exactly one attachment")
	}
	attachment := vol.Attachments[0]
	if attachment.InstanceID != instanceID {
		return errors.New("data volume replace refused: data volume is attached to a different instance")
	}
	if attachment.DeleteOnTermination {
		return errors.New("data volume replace refused: data volume deletes with the instance")
	}
	if attachment.State != "attached" {
		return errReplacementPending
	}
	return nil
}

func dataVolumes(inst ec2Instance) ([]blockVolume, error) {
	var volumes []blockVolume
	for _, mapping := range inst.BlockDeviceMappings {
		if mapping.Ebs == nil || mapping.DeviceName == inst.RootDeviceName {
			continue
		}
		if !volumeIDPattern.MatchString(mapping.Ebs.VolumeID) {
			return nil, errors.New("data volume replace refused: data volume id is not valid")
		}
		volumes = append(volumes, blockVolume{
			ID:                  mapping.Ebs.VolumeID,
			DeleteOnTermination: mapping.Ebs.DeleteOnTermination,
		})
	}
	return volumes, nil
}

func parseInstance(body string) (ec2Instance, error) {
	var parsed struct {
		Reservations []struct {
			Instances []ec2Instance `json:"Instances"`
		} `json:"Reservations"`
	}
	if err := json.Unmarshal([]byte(body), &parsed); err != nil {
		return ec2Instance{}, errors.New("could not parse describe-instances output")
	}
	var found []ec2Instance
	for _, reservation := range parsed.Reservations {
		found = append(found, reservation.Instances...)
	}
	if len(found) == 0 {
		return ec2Instance{}, errInstanceAbsent
	}
	if len(found) != 1 {
		return ec2Instance{}, errors.New("data volume replace refused: instance lookup was not unique")
	}
	return found[0], nil
}

func parseVolume(body string) (ec2Volume, error) {
	var parsed struct {
		Volumes []ec2Volume `json:"Volumes"`
	}
	if err := json.Unmarshal([]byte(body), &parsed); err != nil {
		return ec2Volume{}, errors.New("could not parse describe-volumes output")
	}
	if len(parsed.Volumes) == 0 {
		return ec2Volume{}, errVolumeAbsent
	}
	if len(parsed.Volumes) != 1 {
		return ec2Volume{}, errors.New("data volume replace refused: volume lookup was not unique")
	}
	return parsed.Volumes[0], nil
}

func tagValue(tags []ec2Tag, key string) string {
	for _, tag := range tags {
		if tag.Key == key {
			return tag.Value
		}
	}
	return ""
}

func stagingHostName() string { return "sqldev-" + volumeStage + "-supabase" }

func volumeName(appName string) string {
	return appName + "-" + volumeStage + "-supabase-data"
}

func failed(completed []string, phase string, err error) error {
	done := "none"
	if len(completed) > 0 {
		done = strings.Join(completed, ",")
	}
	return fmt.Errorf("data volume replace failed during %s; completed %s: %w", phase, done, err)
}

func overlayEnv(base []string, values map[string]string) []string {
	out := make([]string, 0, len(base)+len(values))
	for _, entry := range base {
		key, _, ok := strings.Cut(entry, "=")
		if !ok {
			continue
		}
		if _, replace := values[key]; replace {
			continue
		}
		out = append(out, entry)
	}
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		out = append(out, key+"="+values[key])
	}
	return out
}

type envRunner struct {
	base process.Runner
	env  []string
}

func (e envRunner) Run(ctx context.Context, req process.RunRequest) error {
	if req.Env == nil {
		req.Env = e.env
	}
	return e.base.Run(ctx, req)
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
