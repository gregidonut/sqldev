package e2ereset

import (
	"errors"
	"fmt"

	"github.com/gregidonut/sqldev/packages/cli/internal/e2econfig"
)

// stagingStage is the only stage this destructive reset will ever run against.
const stagingStage = "staging"

// ResourceReader is the subset of linked resources the reset reads.
type ResourceReader interface {
	String(name, property string) (string, error)
}

// HostIdentity names the single staging host the reset will command.
type HostIdentity struct {
	InstanceID string
	NameTag    string
	AppTag     string
	StageTag   string
}

// BucketIdentity names a resolved S3 bucket.
type BucketIdentity struct {
	Name   string
	Region string
}

// ResetPlan is produced only after every non-mutating identity check passes. It
// contains no database URL, password, Clerk value, test-user identifier, or
// free-form SQL.
type ResetPlan struct {
	Stage          string
	AppName        string
	ExpectedOrigin string
	Host           HostIdentity
	Application    BucketIdentity
	JobResult      BucketIdentity
	SQLDigest      [32]byte
}

// StaticInputs are the linked values and resolved identities required to build
// a plan. AWS-side resolution (EC2, S3 head) is performed by the caller and
// passed in so plan construction stays pure and testable.
type StaticInputs struct {
	ConfiguredStage string
	LinkedAppStage  string
	AppName         string
	FrontendURL     string
	AstroAppDomain  string
	Host            HostIdentity
	Application     BucketIdentity
	JobResult       BucketIdentity
	Region          string
}

// BuildResetPlan validates every fail-closed condition and returns a plan only
// when all pass. It accepts no caller-selected target: all values come from
// linked resources and AWS-resolved identities. Errors are category-only.
func BuildResetPlan(in StaticInputs) (ResetPlan, error) {
	if in.ConfiguredStage != stagingStage {
		return ResetPlan{}, fmt.Errorf("reset refused: configured stage is not exactly %q", stagingStage)
	}
	if in.LinkedAppStage != stagingStage {
		return ResetPlan{}, fmt.Errorf("reset refused: linked App.stage is not exactly %q", stagingStage)
	}
	if in.AppName == "" {
		return ResetPlan{}, errors.New("reset refused: linked App.name is empty")
	}

	frontendOrigin, err := e2econfig.NormalizeOrigin(in.FrontendURL, false)
	if err != nil {
		return ResetPlan{}, errors.New("reset refused: Frontend.url is not a valid origin")
	}
	domainOrigin, err := e2econfig.NormalizeOrigin(in.AstroAppDomain, true)
	if err != nil {
		return ResetPlan{}, errors.New("reset refused: AstroAppDomain is not a valid origin")
	}
	if frontendOrigin != domainOrigin {
		return ResetPlan{}, errors.New("reset refused: Frontend.url and AstroAppDomain disagree")
	}

	if err := validateHost(in); err != nil {
		return ResetPlan{}, err
	}
	if err := validateBuckets(in); err != nil {
		return ResetPlan{}, err
	}

	return ResetPlan{
		Stage:          stagingStage,
		AppName:        in.AppName,
		ExpectedOrigin: frontendOrigin,
		Host:           in.Host,
		Application:    in.Application,
		JobResult:      in.JobResult,
		SQLDigest:      CanonicalSQLDigest(),
	}, nil
}

func validateHost(in StaticInputs) error {
	expectedName := "sqldev-" + stagingStage + "-supabase"
	h := in.Host
	if h.InstanceID == "" {
		return errors.New("reset refused: no running staging host resolved")
	}
	if h.NameTag != expectedName {
		return errors.New("reset refused: staging host Name tag mismatch")
	}
	if h.AppTag != in.AppName {
		return errors.New("reset refused: staging host Application tag mismatch")
	}
	if h.StageTag != stagingStage {
		return errors.New("reset refused: staging host Stage tag mismatch")
	}
	return nil
}

func validateBuckets(in StaticInputs) error {
	if in.Application.Name == "" {
		return errors.New("reset refused: application bucket is unresolved")
	}
	if in.JobResult.Name == "" {
		return errors.New("reset refused: job-result bucket is unresolved")
	}
	if in.Application.Name == in.JobResult.Name {
		return errors.New("reset refused: application and job-result buckets are identical")
	}
	return nil
}

// StaticInputsFromResources reads the linked values a plan needs. AWS-resolved
// host and bucket identities are injected by the caller after their own probes.
func StaticInputsFromResources(configuredStage string, res ResourceReader) (StaticInputs, error) {
	appStage, err := res.String("App", "stage")
	if err != nil {
		return StaticInputs{}, errors.New("linked App.stage is unavailable")
	}
	appName, err := res.String("App", "name")
	if err != nil {
		return StaticInputs{}, errors.New("linked App.name is unavailable")
	}
	frontendURL, err := res.String("Frontend", "url")
	if err != nil {
		return StaticInputs{}, errors.New("linked Frontend.url is unavailable")
	}
	appDomain, err := res.String("AstroAppDomain", "value")
	if err != nil {
		return StaticInputs{}, errors.New("linked AstroAppDomain is unavailable")
	}
	appBucket, err := res.String("SQLDevBucket", "name")
	if err != nil {
		return StaticInputs{}, errors.New("linked SQLDevBucket.name is unavailable")
	}
	jobBucket, err := res.String("JobResultBucketName", "name")
	if err != nil {
		return StaticInputs{}, errors.New("linked JobResultBucketName.name is unavailable")
	}
	return StaticInputs{
		ConfiguredStage: configuredStage,
		LinkedAppStage:  appStage,
		AppName:         appName,
		FrontendURL:     frontendURL,
		AstroAppDomain:  appDomain,
		Application:     BucketIdentity{Name: appBucket},
		JobResult:       BucketIdentity{Name: jobBucket},
	}, nil
}
