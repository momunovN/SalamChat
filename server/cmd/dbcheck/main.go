package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"samal.dev/server/internal/config"
	"samal.dev/server/internal/db"
)

func timeout() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 30*time.Second)
}

func main() {
	cfg := config.Load()
	ctx, cancel := timeout()
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	cancel()
	if err != nil {
		fmt.Fprintf(os.Stderr, "connect: %v\n", err)
		os.Exit(1)
	}
	defer pool.Close()

	ctx, cancel = timeout()
	var dbname, user, ver string
	err = pool.QueryRow(ctx, `select current_database(), current_user, version()`).Scan(&dbname, &user, &ver)
	cancel()
	if err != nil {
		fmt.Fprintf(os.Stderr, "select: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("ok db=%s user=%s\n%s\n", dbname, user, ver)

	ctx, cancel = timeout()
	rows, err := pool.Query(ctx, `select extname from pg_extension order by 1`)
	if err != nil {
		cancel()
		fmt.Fprintf(os.Stderr, "ext: %v\n", err)
		os.Exit(1)
	}
	fmt.Print("extensions:")
	for rows.Next() {
		var n string
		_ = rows.Scan(&n)
		fmt.Printf(" %s", n)
	}
	rows.Close()
	cancel()
	fmt.Println()

	ctx, cancel = timeout()
	var hasUsers bool
	err = pool.QueryRow(ctx, `select exists(select 1 from pg_tables where schemaname='public' and tablename='users')`).Scan(&hasUsers)
	cancel()
	if err != nil {
		fmt.Fprintf(os.Stderr, "has users: %v\n", err)
	} else {
		fmt.Printf("users table exists=%v\n", hasUsers)
	}

	ctx, cancel = timeout()
	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS users (
		    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		    phone           TEXT NOT NULL UNIQUE,
		    display_name    TEXT NOT NULL DEFAULT '',
		    username        TEXT UNIQUE,
		    avatar_url      TEXT,
		    bio             TEXT NOT NULL DEFAULT '',
		    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
		    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
		    last_seen_at    TIMESTAMPTZ
		)`)
	cancel()
	if err != nil {
		fmt.Fprintf(os.Stderr, "create users: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("create users ok")
}
