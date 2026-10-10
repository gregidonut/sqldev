// Package config resolves non-secret operational configuration from flags,
// SQLDEV_* environment variables, compatible legacy variables, an optional
// config file, and defaults, in that precedence order. Secrets and linked
// resource values are never read here; they come from the SST environment.
package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"github.com/spf13/viper"
)

// Config is the resolved, absolute operational configuration.
type Config struct {
	Root       string
	Stage      string
	AWSProfile string
	AWSRegion  string
	Output     string // "human" or "json"

	SupabaseDir  string
	E2EDir       string
	FunctionsDir string

	HostLocalPort int
}

// Flags carries the raw persistent flag values from Cobra. Empty strings mean
// the flag was not set; a value participates in precedence only when non-empty.
type Flags struct {
	ConfigFile string
	Root       string
	Stage      string
	AWSProfile string
	AWSRegion  string
	Output     string
}

const (
	defaultStage        = "dev"
	defaultAWSRegion    = "ap-east-1"
	defaultOutput       = "human"
	defaultSupabasePath = "packages/backend/supabase"
	defaultE2EPath      = "packages/e2et"
	defaultFunctionPath = "packages/functions"
	defaultHostPort     = 15432
)

// Load resolves configuration. root is the already-discovered repository root;
// all relative paths are made absolute against it.
func Load(root string, flags Flags) (*Config, error) {
	v := viper.New()
	v.SetConfigType("yaml")

	v.SetDefault("stage", defaultStage)
	v.SetDefault("aws.profile", "")
	v.SetDefault("aws.region", defaultAWSRegion)
	v.SetDefault("output", defaultOutput)
	v.SetDefault("paths.supabase", defaultSupabasePath)
	v.SetDefault("paths.e2e", defaultE2EPath)
	v.SetDefault("paths.functions", defaultFunctionPath)
	v.SetDefault("host.localPort", defaultHostPort)

	if err := loadConfigFile(v, root, flags.ConfigFile); err != nil {
		return nil, err
	}

	// Precedence from lowest to highest is applied by resolving defaults and
	// file via Viper, then overlaying legacy env, SQLDEV_* env, and finally the
	// flag. Each helper only overrides when its source is set.
	stage := resolve(flags.Stage, []string{"SQLDEV_STAGE", "STAGE", "SST_STAGE"}, v.GetString("stage"))
	awsProfile := resolve(flags.AWSProfile, []string{"SQLDEV_AWS_PROFILE", "AWS_PROFILE"}, v.GetString("aws.profile"))
	awsRegion := resolve(flags.AWSRegion, []string{"SQLDEV_AWS_REGION", "AWS_REGION"}, v.GetString("aws.region"))
	output := resolve(flags.Output, []string{"SQLDEV_OUTPUT"}, v.GetString("output"))

	if output != "human" && output != "json" {
		return nil, fmt.Errorf("invalid --output %q: expected human or json", output)
	}

	hostPort, err := resolveInt([]string{"SQLDEV_HOST_LOCAL_PORT", "LOCAL_PORT"}, v.GetInt("host.localPort"))
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		Root:          root,
		Stage:         stage,
		AWSProfile:    awsProfile,
		AWSRegion:     awsRegion,
		Output:        output,
		SupabaseDir:   abs(root, v.GetString("paths.supabase")),
		E2EDir:        abs(root, v.GetString("paths.e2e")),
		FunctionsDir:  abs(root, v.GetString("paths.functions")),
		HostLocalPort: hostPort,
	}
	return cfg, nil
}

func loadConfigFile(v *viper.Viper, root, explicit string) error {
	if explicit != "" {
		if _, err := os.Stat(explicit); err != nil {
			return fmt.Errorf("config file %s: %w", explicit, err)
		}
		v.SetConfigFile(explicit)
		return v.ReadInConfig()
	}
	for _, candidate := range configCandidates(root) {
		if candidate == "" {
			continue
		}
		if _, err := os.Stat(candidate); err == nil {
			v.SetConfigFile(candidate)
			return v.ReadInConfig()
		}
	}
	return nil
}

func configCandidates(root string) []string {
	candidates := []string{filepath.Join(root, ".sqldev.yaml")}
	if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
		candidates = append(candidates, filepath.Join(xdg, "sqldev", "config.yaml"))
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		candidates = append(candidates, filepath.Join(home, ".config", "sqldev", "config.yaml"))
	}
	return candidates
}

// resolve returns the first set source in precedence order: flag, then the
// listed environment variables, then the fallback (file or default).
func resolve(flag string, envKeys []string, fallback string) string {
	if flag != "" {
		return flag
	}
	for _, key := range envKeys {
		if value, ok := os.LookupEnv(key); ok && value != "" {
			return value
		}
	}
	return fallback
}

func resolveInt(envKeys []string, fallback int) (int, error) {
	for _, key := range envKeys {
		value, ok := os.LookupEnv(key)
		if !ok || value == "" {
			continue
		}
		n, err := strconv.Atoi(value)
		if err != nil {
			return 0, fmt.Errorf("%s must be an integer, got %q", key, value)
		}
		return n, nil
	}
	return fallback, nil
}

func abs(root, path string) string {
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(root, path)
}
