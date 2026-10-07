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
	conn, err := pgx.Connect(ctx, adminURL)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	if err := applyFile(ctx, conn, envOr("ROLES_FILE", "/roles.sql")); err != nil {
		return err
	}
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
	for _, name := range names {
		if err := applyFile(ctx, conn, filepath.Join(envOr("MIGRATIONS_DIR", "/migrations"), name)); err != nil {
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
