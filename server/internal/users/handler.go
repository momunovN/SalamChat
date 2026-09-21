package users

import (
	"context"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"samal.dev/server/internal/auth"
	"samal.dev/server/internal/httpx"
	"samal.dev/server/internal/models"
	"samal.dev/server/internal/presence"
)

type Handler struct {
	pool *pgxpool.Pool
	pres *presence.Store
}

func NewHandler(pool *pgxpool.Pool, pres *presence.Store) *Handler {
	return &Handler{pool: pool, pres: pres}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.search)
	r.Post("/lookup", h.lookup)
	r.Get("/{id}", h.get)
	return r
}

func (h *Handler) search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	q = strings.TrimPrefix(q, "@")
	if q == "" {
		httpx.JSON(w, 200, map[string]any{"items": []models.User{}})
		return
	}
	exact, _ := authNormalize(q)
	like := escapeLike(q)
	digits := digitsOnly(q)
	if len(digits) < 3 {
		digits = ""
	}
	rows, err := h.pool.Query(r.Context(), `
		SELECT id, phone, display_name, username, avatar_url, bio, created_at, updated_at, last_seen_at
		FROM users
		WHERE ($1 <> '' AND (display_name ILIKE '%'||$1||'%' OR username ILIKE '%'||$1||'%'))
		   OR ($2 <> '' AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE '%'||$2||'%')
		ORDER BY
		  CASE
		    WHEN $3 <> '' AND phone = $3 THEN 0
		    WHEN $2 <> '' AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE $2||'%' THEN 1
		    WHEN $2 <> '' AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE '%'||$2 THEN 2
		    ELSE 3
		  END,
		  display_name
		LIMIT 30`, like, digits, exact)
	if err != nil {
		auth.WriteErr(w, err)
		return
	}
	defer rows.Close()
	items := scanUsers(r.Context(), rows, h.pres)
	httpx.JSON(w, 200, map[string]any{"items": items})
}

func (h *Handler) lookup(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Phones []string `json:"phones"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Error(w, 400, "bad_json", "invalid json")
		return
	}
	norm := make([]string, 0, len(in.Phones))
	for _, p := range in.Phones {
		if n, ok := authNormalize(p); ok {
			norm = append(norm, n)
		}
	}
	if len(norm) == 0 {
		httpx.JSON(w, 200, map[string]any{"items": []models.User{}})
		return
	}
	rows, err := h.pool.Query(r.Context(), `
		SELECT id, phone, display_name, username, avatar_url, bio, created_at, updated_at, last_seen_at
		FROM users WHERE phone = ANY($1)`, norm)
	if err != nil {
		auth.WriteErr(w, err)
		return
	}
	defer rows.Close()
	items := scanUsers(r.Context(), rows, h.pres)
	httpx.JSON(w, 200, map[string]any{"items": items})
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, 400, "bad_id", "invalid id")
		return
	}
	var u models.User
	err = h.pool.QueryRow(r.Context(), `
		SELECT id, phone, display_name, username, avatar_url, bio, created_at, updated_at, last_seen_at
		FROM users WHERE id=$1`, id).
		Scan(&u.ID, &u.Phone, &u.DisplayName, &u.Username, &u.AvatarURL, &u.Bio, &u.CreatedAt, &u.UpdatedAt, &u.LastSeenAt)
	if err != nil {
		httpx.Error(w, 404, "not_found", "user not found")
		return
	}
	u.Online = h.pres.Online(r.Context(), u.ID)
	httpx.JSON(w, 200, u)
}

type rowIter interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}

func scanUsers(ctx context.Context, rows rowIter, pres *presence.Store) []models.User {
	var items []models.User
	for rows.Next() {
		var u models.User
		if err := rows.Scan(&u.ID, &u.Phone, &u.DisplayName, &u.Username, &u.AvatarURL, &u.Bio, &u.CreatedAt, &u.UpdatedAt, &u.LastSeenAt); err != nil {
			continue
		}
		u.Online = pres.Online(ctx, u.ID)
		items = append(items, u)
	}
	if items == nil {
		items = []models.User{}
	}
	return items
}

func authNormalize(raw string) (string, bool) {
	return normalizePhone(raw)
}

func digitsOnly(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, " ")
	s = strings.ReplaceAll(s, `%`, " ")
	s = strings.ReplaceAll(s, `_`, " ")
	return strings.Join(strings.Fields(s), " ")
}
