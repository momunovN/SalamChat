package app

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"samal.dev/server/internal/auth"
	"samal.dev/server/internal/calls"
	"samal.dev/server/internal/chats"
	"samal.dev/server/internal/config"
	"samal.dev/server/internal/db"
	"samal.dev/server/internal/httpx"
	"samal.dev/server/internal/messages"
	"samal.dev/server/internal/presence"
	"samal.dev/server/internal/realtime"
	"samal.dev/server/internal/sms"
	"samal.dev/server/internal/upload"
	"samal.dev/server/internal/users"
)

func New(ctx context.Context, cfg config.Config, log *slog.Logger) (http.Handler, func(), error) {
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, nil, err
	}
	if err := db.Migrate(ctx, pool); err != nil {
		pool.Close()
		return nil, nil, err
	}

	store, err := upload.New(ctx, pool, cfg)
	if err != nil {
		log.Warn("s3 init failed, uploads will error until minio is up", "err", err)
	}

	hub := realtime.NewHub(log)
	pres := presence.New()
	smsSender := sms.New(cfg, log)

	authSvc := auth.New(pool, cfg, smsSender)
	authH := auth.NewHandler(authSvc)
	chatsSvc := chats.New(pool, pres)
	chatsH := chats.NewHandler(chatsSvc)
	msgSvc := messages.New(pool, chatsSvc, hub, cfg.S3PublicURL)
	msgH := messages.NewHandler(msgSvc)
	callsSvc := calls.New(pool, chatsSvc, hub, cfg)
	callsH := calls.NewHandler(callsSvc)
	usersH := users.NewHandler(pool, pres)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		httpx.JSON(w, 200, map[string]any{"ok": true, "name": "tooapp"})
	})

	r.Route("/v1", func(r chi.Router) {
		r.Mount("/auth", authH.Routes())

		r.Group(func(r chi.Router) {
			r.Use(authH.Middleware)
			r.Get("/me", authH.Me())
			r.Patch("/me", authH.PatchMe())
			r.Post("/auth/logout", authH.Logout())
			r.Route("/chats", func(r chi.Router) {
				r.Get("/", chatsH.List)
				r.Post("/direct", chatsH.Direct)
				r.Post("/groups", chatsH.Group)
				r.Get("/{chatID}", chatsH.Get)
				r.Post("/{chatID}/read", chatsH.Read)
				r.Get("/{chatID}/messages", msgH.List)
				r.Post("/{chatID}/messages", msgH.Send)
				r.Post("/{chatID}/calls", callsH.Start)
			})
			r.Post("/receipts", msgH.Receipts)
			callsH.Mount(r)
			if store != nil {
				r.Mount("/uploads", upload.NewHandler(store).Routes())
			}
			r.Get("/contacts", usersH.ListContacts)
			r.Post("/contacts/sync", usersH.SyncContacts)
			r.Mount("/users", usersH.Routes())
			r.Handle("/ws", &realtime.WSHandler{Hub: hub, Pres: pres, Chats: chatsSvc})
		})
	})

	cleanup := func() {
		pool.Close()
	}
	return r, cleanup, nil
}

func Run() error {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	cfg := config.Load()
	ctx := context.Background()

	h, cleanup, err := New(ctx, cfg, log)
	if err != nil {
		return err
	}
	defer cleanup()

	log.Info("tooapp api listening", "addr", cfg.HTTPAddr)
	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
	}
	return srv.ListenAndServe()
}
