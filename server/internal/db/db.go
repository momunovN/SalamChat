package db

import (
	"context"
	"fmt"
	"io/fs"
	"net"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"samal.dev/server/migrations"
)

func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse db url: %w", err)
	}
	// Neon: keep the pool small; idle compute drops extra sockets.
	cfg.MaxConns = 8
	cfg.MinConns = 0
	cfg.MaxConnLifetime = time.Minute
	cfg.MaxConnIdleTime = 10 * time.Second
	cfg.HealthCheckPeriod = 15 * time.Second
	cfg.ConnConfig.ConnectTimeout = 30 * time.Second
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	dialer := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 5 * time.Second}
	cfg.ConnConfig.DialFunc = func(ctx context.Context, network, addr string) (net.Conn, error) {
		return dialer.DialContext(ctx, network, addr)
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect db: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return pool, nil
}

func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`); err != nil {
		return err
	}

	entries, err := fs.ReadDir(migrations.FS, ".")
	if err != nil {
		return err
	}
	var files []string
	for _, e := range entries {
		name := e.Name()
		if strings.HasSuffix(name, ".up.sql") {
			files = append(files, name)
		}
	}
	sort.Strings(files)

	for _, name := range files {
		var exists bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)`, name).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		body, err := fs.ReadFile(migrations.FS, name)
		if err != nil {
			return err
		}
		// Neon drops idle sockets; do not wrap the whole file in one transaction.
		for i, stmt := range splitSQL(string(body)) {
			if err := execRetry(ctx, pool, stmt, 4); err != nil {
				return fmt.Errorf("migration %s stmt %d: %w", name, i+1, err)
			}
		}
		if err := execRetry(ctx, pool, fmt.Sprintf(`INSERT INTO schema_migrations(version) VALUES ('%s')`, name), 4); err != nil {
			return err
		}
	}
	return nil
}

func execRetry(ctx context.Context, pool *pgxpool.Pool, stmt string, attempts int) error {
	var err error
	for i := 0; i < attempts; i++ {
		stmtCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		_, err = pool.Exec(stmtCtx, stmt)
		cancel()
		if err == nil {
			return nil
		}
		time.Sleep(time.Duration(i+1) * time.Second)
	}
	return err
}

// splitSQL cuts a migration on ';' but keeps $$ ... $$ bodies intact.
func splitSQL(sql string) []string {
	var out []string
	var b strings.Builder
	inDollar := false
	for i := 0; i < len(sql); i++ {
		if i+1 < len(sql) && sql[i] == '$' && sql[i+1] == '$' {
			inDollar = !inDollar
			b.WriteString("$$")
			i++
			continue
		}
		if !inDollar && sql[i] == ';' {
			stmt := strings.TrimSpace(b.String())
			if stmt != "" {
				out = append(out, stmt)
			}
			b.Reset()
			continue
		}
		b.WriteByte(sql[i])
	}
	if stmt := strings.TrimSpace(b.String()); stmt != "" {
		out = append(out, stmt)
	}
	return out
}
