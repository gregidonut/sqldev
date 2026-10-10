// Package sst loads SST linked resources from the environment and re-executes
// the CLI through `sst shell` when resources are not yet present. It mirrors
// the SST v4 Node loader's three input formats and their merge order.
package sst

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
)

// Resources provides typed access to linked resource properties.
type Resources interface {
	// Has reports whether a resource with the given name is loaded.
	Has(name string) bool
	// String returns a string property of a resource, e.g. ("GoApi", "url").
	String(name, property string) (string, error)
}

// resourceSet is the concrete loaded resource map.
type resourceSet struct {
	raw map[string]map[string]any
}

// ErrNotLinked indicates no resources were found in the environment at all,
// which means the process was not started through `sst shell`.
var ErrNotLinked = errors.New("sst links are not active")

// Load reads resources from the given environment variables (typically
// os.Environ-derived). The merge order matches SST's Node loader: individual
// SST_RESOURCE_* values first, then SST_RESOURCES_JSON, then the decrypted
// SST_KEY_FILE object. Later sources overlay earlier ones.
func Load(env Env) (Resources, error) {
	raw := map[string]map[string]any{}

	for key, value := range env.pairs {
		name, ok := strings.CutPrefix(key, "SST_RESOURCE_")
		if !ok || value == "" {
			continue
		}
		obj, err := decodeObject(value)
		if err != nil {
			return nil, fmt.Errorf("SST_RESOURCE_%s: %w", name, err)
		}
		raw[name] = obj
	}

	if bundle := env.pairs["SST_RESOURCES_JSON"]; bundle != "" {
		if err := overlayBundle(raw, bundle); err != nil {
			return nil, fmt.Errorf("SST_RESOURCES_JSON: %w", err)
		}
	}

	keyFile := env.pairs["SST_KEY_FILE"]
	key := env.pairs["SST_KEY"]
	if keyFile != "" && key != "" {
		if err := overlayEncrypted(raw, key, keyFile); err != nil {
			return nil, err
		}
	}

	return &resourceSet{raw: raw}, nil
}

func (r *resourceSet) Has(name string) bool {
	_, ok := r.raw[name]
	return ok
}

func (r *resourceSet) String(name, property string) (string, error) {
	resource, ok := r.raw[name]
	if !ok {
		return "", fmt.Errorf("%q is not linked; start through `sst shell` or `sqldev` auto-bootstrap", name)
	}
	value, ok := resource[property]
	if !ok {
		return "", fmt.Errorf("%q has no property %q", name, property)
	}
	text, ok := value.(string)
	if !ok || strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("%q.%q is empty", name, property)
	}
	return text, nil
}

func decodeObject(value string) (map[string]any, error) {
	var obj map[string]any
	if err := json.Unmarshal([]byte(value), &obj); err != nil {
		return nil, fmt.Errorf("invalid resource JSON: %w", err)
	}
	return obj, nil
}

func overlayBundle(raw map[string]map[string]any, bundle string) error {
	var parsed map[string]map[string]any
	if err := json.Unmarshal([]byte(bundle), &parsed); err != nil {
		return fmt.Errorf("invalid JSON bundle: %w", err)
	}
	for name, obj := range parsed {
		raw[name] = obj
	}
	return nil
}

// overlayEncrypted decrypts SST_KEY_FILE with SST_KEY using AES-256-GCM and a
// twelve-byte zero nonce, matching the SST loader. Decrypted content is never
// included in returned errors.
func overlayEncrypted(raw map[string]map[string]any, keyB64, keyFile string) error {
	key, err := base64.StdEncoding.DecodeString(keyB64)
	if err != nil {
		return errors.New("SST_KEY: invalid base64")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return errors.New("SST_KEY: invalid AES key")
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return errors.New("SST_KEY: cannot create GCM cipher")
	}
	data, err := os.ReadFile(keyFile)
	if err != nil {
		return fmt.Errorf("SST_KEY_FILE: %w", err)
	}
	if len(data) < gcm.Overhead() {
		return errors.New("SST_KEY_FILE: ciphertext too short")
	}
	nonce := make([]byte, gcm.NonceSize())
	plaintext, err := gcm.Open(nil, nonce, data, nil)
	if err != nil {
		return errors.New("SST_KEY_FILE: decryption failed")
	}
	var parsed map[string]map[string]any
	if err := json.Unmarshal(plaintext, &parsed); err != nil {
		return errors.New("SST_KEY_FILE: decrypted payload is not valid JSON")
	}
	for name, obj := range parsed {
		raw[name] = obj
	}
	return nil
}

// Env is an immutable snapshot of environment variables used by Load, so tests
// can supply a synthetic environment without touching the process environment.
type Env struct {
	pairs map[string]string
}

// EnvFromOS snapshots the current process environment.
func EnvFromOS() Env {
	return EnvFromSlice(os.Environ())
}

// EnvFromSlice builds an Env from "KEY=VALUE" strings.
func EnvFromSlice(entries []string) Env {
	pairs := make(map[string]string, len(entries))
	for _, entry := range entries {
		key, value, found := strings.Cut(entry, "=")
		if !found {
			continue
		}
		pairs[key] = value
	}
	return Env{pairs: pairs}
}

// Linked reports whether the environment looks like it was started through
// `sst shell`: the App resource is always present when links are active.
func (e Env) Linked() bool {
	if _, ok := e.pairs["SST_RESOURCE_App"]; ok {
		return true
	}
	if _, ok := e.pairs["SST_RESOURCES_JSON"]; ok {
		return true
	}
	_, hasKey := e.pairs["SST_KEY"]
	_, hasFile := e.pairs["SST_KEY_FILE"]
	return hasKey && hasFile
}

// OSEnviron returns the environment as a fresh "KEY=VALUE" slice suitable for
// exec. It reflects the snapshot this Env was built from.
func (e Env) OSEnviron() []string {
	out := make([]string, 0, len(e.pairs))
	for key, value := range e.pairs {
		out = append(out, key+"="+value)
	}
	return out
}
