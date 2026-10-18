// Package host ports the deployed-host operations: an SSM Postgres tunnel, a
// host replacement that preserves the data volume, and an exact-staging
// replacement that deletes that volume. The tunnel and preserving replacement
// refuse a missing stage or the exact "dev" stage, which has no host.
package host

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/gregidonut/sqldev/packages/cli/internal/process"
)

// AssertDeployedStage mirrors the hostdb/replacehost guard: it refuses a
// missing stage and the exact "dev" stage.
func AssertDeployedStage(stage string) error {
	if stage == "" || stage == "dev" {
		return errors.New("this host command needs a deployed stage; dev has no host")
	}
	return nil
}

// HostName returns the EC2 Name tag for a stage's Supabase host.
func HostName(stage string) string {
	return "sqldev-" + stage + "-supabase"
}

// Instance is the subset of EC2 instance data the host commands need.
type Instance struct {
	InstanceID     string
	RootDeviceName string
	DataVolumeIDs  []string
}

// Tunnel starts an SSM port-forwarding session from a local port to the host's
// loopback Postgres. It inherits the terminal and returns the child exit code.
func Tunnel(ctx context.Context, runner process.Runner, stage string, localPort int) error {
	if err := AssertDeployedStage(stage); err != nil {
		return err
	}
	name := HostName(stage)
	instanceID, err := runningInstanceID(ctx, runner, name)
	if err != nil {
		return err
	}

	params, err := json.Marshal(map[string][]string{
		"portNumber":      {"5432"},
		"localPortNumber": {fmt.Sprintf("%d", localPort)},
	})
	if err != nil {
		return err
	}

	fmt.Printf("%s (%s) postgres -> 127.0.0.1:%d\n", name, instanceID, localPort)
	return runner.Run(ctx, process.RunRequest{
		Program: "aws",
		Args: []string{
			"ssm", "start-session",
			"--target", instanceID,
			"--document-name", "AWS-StartPortForwardingSession",
			"--parameters", string(params),
		},
	})
}

// Replace terminates the current host, redeploys through SST, and verifies the
// original data volume reattaches. It is destructive; the caller gates it on
// confirmation.
func Replace(ctx context.Context, runner process.Runner, stage, root string) error {
	if err := AssertDeployedStage(stage); err != nil {
		return err
	}
	name := HostName(stage)

	previous, err := describeRunningInstance(ctx, runner, name)
	if err != nil {
		return err
	}

	var dataVolumeID string
	if previous != nil {
		dataVolumeID, err = soleDataVolume(*previous)
		if err != nil {
			return err
		}
		fmt.Printf("replacing %s (%s), keeping %s\n", name, previous.InstanceID, dataVolumeID)
		if err := awsRun(ctx, runner, "ec2", "terminate-instances", "--instance-ids", previous.InstanceID); err != nil {
			return err
		}
		if err := awsRun(ctx, runner, "ec2", "wait", "instance-terminated", "--instance-ids", previous.InstanceID); err != nil {
			return err
		}
	} else {
		fmt.Printf("no running %s; deploying a replacement\n", name)
	}

	if err := sstRun(ctx, runner, root, "refresh", stage); err != nil {
		return err
	}
	if err := sstRun(ctx, runner, root, "deploy", stage); err != nil {
		return err
	}

	next, err := describeRunningInstance(ctx, runner, name)
	if err != nil {
		return err
	}
	if next == nil {
		return fmt.Errorf("deploy finished without a running %s", name)
	}
	attached, err := soleDataVolume(*next)
	if err != nil {
		return err
	}
	if dataVolumeID != "" && attached != dataVolumeID {
		return fmt.Errorf("%s is not attached to %s", next.InstanceID, dataVolumeID)
	}
	prevID := "none"
	if previous != nil {
		prevID = previous.InstanceID
	}
	fmt.Printf("replaced %s with %s; %s is attached\n", prevID, next.InstanceID, attached)
	return nil
}

func runningInstanceID(ctx context.Context, runner process.Runner, name string) (string, error) {
	var out bytes.Buffer
	err := runner.Run(ctx, process.RunRequest{
		Program: "aws",
		Args: []string{
			"ec2", "describe-instances",
			"--filters", "Name=tag:Name,Values=" + name,
			"Name=instance-state-name,Values=running",
			"--query", "Reservations[0].Instances[0].InstanceId",
			"--output", "text",
		},
		Stdout: &out,
	})
	if err != nil {
		return "", err
	}
	id := strings.TrimSpace(out.String())
	if !strings.HasPrefix(id, "i-") {
		return "", fmt.Errorf("no running instance named %s", name)
	}
	return id, nil
}

// awsDescribeInstances is the shape of `aws ec2 describe-instances --output json`
// limited to the fields the replace flow reads.
type awsDescribeInstances struct {
	Reservations []struct {
		Instances []struct {
			InstanceID          string `json:"InstanceId"`
			RootDeviceName      string `json:"RootDeviceName"`
			BlockDeviceMappings []struct {
				DeviceName string `json:"DeviceName"`
				Ebs        *struct {
					VolumeID string `json:"VolumeId"`
				} `json:"Ebs"`
			} `json:"BlockDeviceMappings"`
		} `json:"Instances"`
	} `json:"Reservations"`
}

func describeRunningInstance(ctx context.Context, runner process.Runner, name string) (*Instance, error) {
	var out bytes.Buffer
	err := runner.Run(ctx, process.RunRequest{
		Program: "aws",
		Args: []string{
			"ec2", "describe-instances",
			"--filters", "Name=tag:Name,Values=" + name,
			"Name=instance-state-name,Values=running",
			"--output", "json",
		},
		Stdout: &out,
	})
	if err != nil {
		return nil, err
	}
	var described awsDescribeInstances
	if err := json.Unmarshal(out.Bytes(), &described); err != nil {
		return nil, fmt.Errorf("parse describe-instances: %w", err)
	}
	if len(described.Reservations) == 0 || len(described.Reservations[0].Instances) == 0 {
		return nil, nil
	}
	raw := described.Reservations[0].Instances[0]
	if !strings.HasPrefix(raw.InstanceID, "i-") {
		return nil, nil
	}
	inst := &Instance{InstanceID: raw.InstanceID, RootDeviceName: raw.RootDeviceName}
	for _, mapping := range raw.BlockDeviceMappings {
		if mapping.DeviceName == raw.RootDeviceName {
			continue
		}
		if mapping.Ebs != nil && strings.HasPrefix(mapping.Ebs.VolumeID, "vol-") {
			inst.DataVolumeIDs = append(inst.DataVolumeIDs, mapping.Ebs.VolumeID)
		}
	}
	return inst, nil
}

func soleDataVolume(inst Instance) (string, error) {
	if len(inst.DataVolumeIDs) != 1 {
		return "", fmt.Errorf("%s has %d data volumes; expected 1", inst.InstanceID, len(inst.DataVolumeIDs))
	}
	return inst.DataVolumeIDs[0], nil
}

func awsRun(ctx context.Context, runner process.Runner, args ...string) error {
	return runner.Run(ctx, process.RunRequest{Program: "aws", Args: args})
}

func sstRun(ctx context.Context, runner process.Runner, root, command, stage string) error {
	return runner.Run(ctx, process.RunRequest{
		Program: "bunx",
		Args:    []string{"--no-install", "sst", command, "--stage", stage},
		Dir:     root,
	})
}
