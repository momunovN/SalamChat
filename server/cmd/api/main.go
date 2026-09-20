package main

import (
	"context"
	"flag"
	"log/slog"
	"os"

	"samal.dev/server/internal/app"
	"samal.dev/server/internal/config"
	"samal.dev/server/internal/db"
)

func main() {
	migrateOnly := flag.Bool("migrate-only", false, "run migrations and exit")
	flag.Parse()

	if *migrateOnly {
		cfg := config.Load()
		ctx := context.Background()
		pool, err := db.Connect(ctx, cfg.DatabaseURL)
		if err != nil {
			slog.Error("db", "err", err)
			os.Exit(1)
		}
		defer pool.Close()
		if err := db.Migrate(ctx, pool); err != nil {
			slog.Error("migrate", "err", err)
			os.Exit(1)
		}
		slog.Info("migrations ok")
		return
	}

	if err := app.Run(); err != nil {
		slog.Error("api", "err", err)
		os.Exit(1)
	}
}
