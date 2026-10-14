package e2ereset

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/gregidonut/sqldev/packages/cli/internal/process"
)

// HostDiscoverer resolves the single running staging host and its identity
// tags over the AWS CLI. It requires exactly one match.
type HostDiscoverer struct {
	Runner process.Runner
	Region string
}

type ec2DescribeOutput struct {
	Reservations []struct {
		Instances []struct {
			InstanceID string `json:"InstanceId"`
			Tags       []struct {
				Key   string `json:"Key"`
				Value string `json:"Value"`
			} `json:"Tags"`
		} `json:"Instances"`
	} `json:"Reservations"`
}

// ResolveStagingHost finds the unique running EC2 instance tagged for the
// staging SQLDev Supabase host and returns its identity. appName and the host
// Name tag must match; exactly one instance is required.
func (d *HostDiscoverer) ResolveStagingHost(ctx context.Context, appName string) (HostIdentity, error) {
	nameTag := "sqldev-staging-supabase"
	var out bytes.Buffer
	err := d.Runner.Run(ctx, process.RunRequest{
		Program: "aws",
		Args: []string{
			"ec2", "describe-instances",
			"--region", d.Region,
			"--filters",
			"Name=tag:Name,Values=" + nameTag,
			"Name=tag:Application,Values=" + appName,
			"Name=tag:Stage,Values=staging",
			"Name=instance-state-name,Values=running",
			"--output", "json",
		},
		Stdout: &out,
	})
	if err != nil {
		return HostIdentity{}, err
	}
	var parsed ec2DescribeOutput
	if err := json.Unmarshal(out.Bytes(), &parsed); err != nil {
		return HostIdentity{}, errors.New("could not parse describe-instances output")
	}

	var hosts []HostIdentity
	for _, r := range parsed.Reservations {
		for _, inst := range r.Instances {
			if !strings.HasPrefix(inst.InstanceID, "i-") {
				continue
			}
			id := HostIdentity{InstanceID: inst.InstanceID}
			for _, tag := range inst.Tags {
				switch tag.Key {
				case "Name":
					id.NameTag = tag.Value
				case "Application":
					id.AppTag = tag.Value
				case "Stage":
					id.StageTag = tag.Value
				}
			}
			hosts = append(hosts, id)
		}
	}

	if len(hosts) == 0 {
		return HostIdentity{}, errors.New("no running staging host matched the expected tags")
	}
	if len(hosts) > 1 {
		return HostIdentity{}, errors.New("more than one running staging host matched; refusing to choose")
	}
	return hosts[0], nil
}
