package users

import (
	"net/http"

	"github.com/google/uuid"

	"samal.dev/server/internal/auth"
	"samal.dev/server/internal/httpx"
	"samal.dev/server/internal/models"
)

type contactIn struct {
	Phone string `json:"phone"`
	Name  string `json:"name"`
}

func (h *Handler) SyncContacts(w http.ResponseWriter, r *http.Request) {
	uid := httpx.UserID(r.Context())
	if uid == uuid.Nil {
		httpx.Error(w, 401, "unauthorized", "unauthorized")
		return
	}
	var in struct {
		Enabled *bool       `json:"enabled"`
		Items   []contactIn `json:"items"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Error(w, 400, "bad_json", "invalid json")
		return
	}
	enabled := in.Enabled == nil || *in.Enabled
	if !enabled {
		_, _ = h.pool.Exec(r.Context(), `DELETE FROM contacts WHERE owner_id=$1`, uid)
		_, _ = h.pool.Exec(r.Context(), `UPDATE users SET contacts_sync=false, updated_at=now() WHERE id=$1`, uid)
		httpx.JSON(w, 200, map[string]any{"ok": true, "enabled": false, "count": 0})
		return
	}
	seen := map[string]struct{}{}
	type row struct{ phone, name string }
	var rows []row
	for _, it := range in.Items {
		phone, ok := authNormalize(it.Phone)
		if !ok {
			continue
		}
		if _, dup := seen[phone]; dup {
			continue
		}
		seen[phone] = struct{}{}
		name := it.Name
		if len(name) > 80 {
			name = name[:80]
		}
		rows = append(rows, row{phone, name})
		if len(rows) >= 2000 {
			break
		}
	}
	_, _ = h.pool.Exec(r.Context(), `DELETE FROM contacts WHERE owner_id=$1`, uid)
	for _, row := range rows {
		_, _ = h.pool.Exec(r.Context(), `
			INSERT INTO contacts (owner_id, phone, book_name) VALUES ($1,$2,$3)
			ON CONFLICT (owner_id, phone) DO UPDATE SET book_name = EXCLUDED.book_name`, uid, row.phone, row.name)
	}
	_, _ = h.pool.Exec(r.Context(), `UPDATE users SET contacts_sync=true, updated_at=now() WHERE id=$1`, uid)
	httpx.JSON(w, 200, map[string]any{"ok": true, "enabled": true, "count": len(rows)})
}

func (h *Handler) ListContacts(w http.ResponseWriter, r *http.Request) {
	uid := httpx.UserID(r.Context())
	if uid == uuid.Nil {
		httpx.Error(w, 401, "unauthorized", "unauthorized")
		return
	}
	var synced bool
	_ = h.pool.QueryRow(r.Context(), `SELECT contacts_sync FROM users WHERE id=$1`, uid).Scan(&synced)
	q, err := h.pool.Query(r.Context(), `
		SELECT u.id, u.phone, u.display_name, u.username, u.avatar_url, u.bio, u.created_at, u.updated_at, u.last_seen_at, c.book_name
		FROM contacts c
		JOIN users u ON u.phone = c.phone
		WHERE c.owner_id=$1 AND u.id <> $1
		ORDER BY COALESCE(NULLIF(c.book_name, ''), u.display_name)
		LIMIT 500`, uid)
	if err != nil {
		auth.WriteErr(w, err)
		return
	}
	defer q.Close()
	items := []map[string]any{}
	for q.Next() {
		var u models.User
		var book string
		if err := q.Scan(&u.ID, &u.Phone, &u.DisplayName, &u.Username, &u.AvatarURL, &u.Bio, &u.CreatedAt, &u.UpdatedAt, &u.LastSeenAt, &book); err != nil {
			continue
		}
		u.Online = h.pres.Online(r.Context(), u.ID)
		m := map[string]any{
			"id": u.ID, "phone": u.Phone, "display_name": u.DisplayName,
			"username": u.Username, "avatar_url": u.AvatarURL, "bio": u.Bio,
			"created_at": u.CreatedAt, "updated_at": u.UpdatedAt, "last_seen_at": u.LastSeenAt,
			"online": u.Online,
		}
		if book != "" {
			m["book_name"] = book
		}
		items = append(items, m)
	}
	httpx.JSON(w, 200, map[string]any{"items": items, "synced": synced})
}
