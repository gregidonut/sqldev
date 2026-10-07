package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/dbos-inc/dbos-transact-golang/dbos"
	"github.com/jackc/pgx/v5"
)

func migrate(ctx context.Context) error {
	adminURL := os.Getenv("ADMIN_DATABASE_URL")
	if err := applyRoles(ctx, envOr("ROLES_DATABASE_URL", adminURL)); err != nil {
		return fmt.Errorf("roles: %w", err)
	}
	conn, err := pgx.Connect(ctx, adminURL)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	entries, err := os.ReadDir(envOr("MIGRATIONS_DIR", "/migrations"))
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	if _, err := conn.Exec(ctx, `
		CREATE SCHEMA IF NOT EXISTS supabase_migrations;
		CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
			version TEXT PRIMARY KEY,
			name    TEXT
		);
	`); err != nil {
		return err
	}
	for _, name := range names {
		if err := applyMigration(ctx, conn, filepath.Join(envOr("MIGRATIONS_DIR", "/migrations"), name)); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
	}
	if err := ensureWorkerRole(ctx, conn, os.Getenv("WORKER_PASSWORD")); err != nil {
		return err
	}
	dbosCtx, err := dbos.NewContext(ctx, dbos.Config{
		AppName:        "sqldev",
		DatabaseURL:    adminURL,
		DatabaseSchema: "dbos",
	})
	if err != nil {
		return err
	}
	defer dbos.Shutdown(dbosCtx, 0)
	_, err = conn.Exec(ctx, `
		GRANT USAGE ON SCHEMA dbos TO dbos_worker;
		GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA dbos TO dbos_worker;
		GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA dbos TO dbos_worker;
		GRANT authenticated TO dbos_worker;
		GRANT USAGE ON SCHEMA public TO dbos_worker;
		GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO dbos_worker;
		GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO dbos_worker;
		GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO dbos_worker;
	`)
	return err
}

// applyRoles runs the roles file as the image superuser, because the
// application migrations run as postgres, which cannot create objects in auth.
func applyRoles(ctx context.Context, url string) error {
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	return applyFile(ctx, conn, envOr("ROLES_FILE", "/roles.sql"))
}

// applyMigration runs one migration file and records its version in the same
// transaction, so a rerun skips applied files and a failure leaves no partial file.
func applyMigration(ctx context.Context, conn *pgx.Conn, path string) error {
	base := filepath.Base(path)
	version, name, _ := strings.Cut(strings.TrimSuffix(base, ".sql"), "_")
	body, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`, version, name)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return nil
	}
	if _, err := tx.Exec(ctx, string(body)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func applyFile(ctx context.Context, conn *pgx.Conn, path string) error {
	body, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	_, err = conn.Exec(ctx, string(body))
	return err
}

func ensureWorkerRole(ctx context.Context, conn *pgx.Conn, password string) error {
	var exists bool
	if err := conn.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dbos_worker')`).Scan(&exists); err != nil {
		return err
	}
	var statement string
	if exists {
		if err := conn.QueryRow(ctx, `SELECT format('ALTER ROLE dbos_worker PASSWORD %L', $1::text)`, password).Scan(&statement); err != nil {
			return err
		}
	} else {
		if err := conn.QueryRow(ctx, `SELECT format('CREATE ROLE dbos_worker LOGIN PASSWORD %L', $1::text)`, password).Scan(&statement); err != nil {
			return err
		}
	}
	_, err := conn.Exec(ctx, statement)
	return err
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
