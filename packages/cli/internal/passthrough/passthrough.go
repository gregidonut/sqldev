// Package passthrough builds the transparent Supabase and Cypress wrappers.
// They forward every argument to the vendor CLI unchanged, run from the right
// package directory, and inject the linked-resource environment the previous
// envBuilder provided.
package passthrough

import (
	"context"

	"github.com/gregidonut/sqldev/packages/cli/internal/app"
	"github.com/gregidonut/sqldev/packages/cli/internal/process"
	"github.com/gregidonut/sqldev/packages/cli/internal/sst"
)

// supabaseEnv returns the extra environment variables runSupabase injected.
func supabaseEnv(res sst.Resources) ([]string, error) {
	clerkFeDomain, err := res.String("ClerkFeDomain", "value")
	if err != nil {
		return nil, err
	}
	notifySecret, err := res.String("NotifySecret", "value")
	if err != nil {
		return nil, err
	}
	goAPI, err := res.String("GoApi", "url")
	if err != nil {
		return nil, err
	}
	return []string{
		"CLERK_FE_DOMAIN=" + clerkFeDomain,
		"NOTIFY_IG_POSTS_VIEW_URL=" + goAPI + "notify",
		"RENDER_MD_URL=" + goAPI + "renderMd",
		"NOTIFY_SECRET=" + notifySecret,
	}, nil
}

// cypressEnv returns the extra environment variables runCypress injected, plus
// SQLDEV_BIN and SQLDEV_ROOT so Cypress tasks can call back into this CLI.
func cypressEnv(a *app.App, res sst.Resources) ([]string, error) {
	clerkPublishable, err := res.String("ClerkPublicKey", "value")
	if err != nil {
		return nil, err
	}
	clerkSecret, err := res.String("ClerkSecretKey", "value")
	if err != nil {
		return nil, err
	}
	supabaseURL, err := res.String("SupabaseUrl", "value")
	if err != nil {
		return nil, err
	}
	supabaseKey, err := res.String("SupabaseKey", "value")
	if err != nil {
		return nil, err
	}
	clerkFeDomain, err := res.String("ClerkFeDomain", "value")
	if err != nil {
		return nil, err
	}
	notifySecret, err := res.String("NotifySecret", "value")
	if err != nil {
		return nil, err
	}
	goAPI, err := res.String("GoApi", "url")
	if err != nil {
		return nil, err
	}
	return []string{
		"STAGE=" + a.Cfg.Stage,
		"SST_STAGE=" + a.Cfg.Stage,
		"CLERK_PUBLISHABLE_KEY=" + clerkPublishable,
		"CLERK_SECRET_KEY=" + clerkSecret,
		"SUPABASE_URL=" + supabaseURL,
		"SUPABASE_KEY=" + supabaseKey,
		"CLERK_FE_DOMAIN=" + clerkFeDomain,
		"NOTIFY_IG_POSTS_VIEW_URL=" + goAPI + "notify",
		"RENDER_MD_URL=" + goAPI + "renderMd",
		"NOTIFY_SECRET=" + notifySecret,
		"SQLDEV_BIN=" + a.Executable,
		"SQLDEV_ROOT=" + a.Cfg.Root,
	}, nil
}

// RunSupabase forwards args to `bunx --no-install supabase <args>` from the
// Supabase package directory with the injected environment.
func RunSupabase(ctx context.Context, a *app.App, args []string) error {
	res, err := a.Resources()
	if err != nil {
		return err
	}
	extra, err := supabaseEnv(res)
	if err != nil {
		return err
	}
	return a.Runner.Run(ctx, process.RunRequest{
		Program: "bunx",
		Args:    append([]string{"--no-install", "supabase"}, args...),
		Dir:     a.Cfg.SupabaseDir,
		Env:     mergeEnv(baseEnv(a), extra),
	})
}

// RunCypress forwards args to `bunx --no-install cypress <args>` from the e2e
// package directory with the injected environment.
func RunCypress(ctx context.Context, a *app.App, args []string) error {
	res, err := a.Resources()
	if err != nil {
		return err
	}
	extra, err := cypressEnv(a, res)
	if err != nil {
		return err
	}
	return a.Runner.Run(ctx, process.RunRequest{
		Program: "bunx",
		Args:    append([]string{"--no-install", "cypress"}, args...),
		Dir:     a.Cfg.E2EDir,
		Env:     mergeEnv(baseEnv(a), extra),
	})
}

func baseEnv(a *app.App) []string {
	return a.Env.OSEnviron()
}

// mergeEnv overlays extra "KEY=VALUE" entries onto base, replacing any existing
// key so injected values win.
func mergeEnv(base, extra []string) []string {
	index := map[string]int{}
	out := make([]string, 0, len(base)+len(extra))
	for _, entry := range base {
		key := envKey(entry)
		index[key] = len(out)
		out = append(out, entry)
	}
	for _, entry := range extra {
		key := envKey(entry)
		if pos, ok := index[key]; ok {
			out[pos] = entry
			continue
		}
		index[key] = len(out)
		out = append(out, entry)
	}
	return out
}

func envKey(entry string) string {
	for i := 0; i < len(entry); i++ {
		if entry[i] == '=' {
			return entry[:i]
		}
	}
	return entry
}
