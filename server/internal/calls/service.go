package calls

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"samal.dev/server/internal/chats"
	"samal.dev/server/internal/config"
	"samal.dev/server/internal/httpx"
	"samal.dev/server/internal/models"
	"samal.dev/server/internal/realtime"
)

type Service struct {
	pool  *pgxpool.Pool
	chats *chats.Service
	hub   *realtime.Hub
	cfg   config.Config
}

func New(pool *pgxpool.Pool, chats *chats.Service, hub *realtime.Hub, cfg config.Config) *Service {
	return &Service{pool: pool, chats: chats, hub: hub, cfg: cfg}
}

func (s *Service) Start(ctx context.Context, userID, chatID uuid.UUID, kind string) (*models.Call, error) {
	if kind != "audio" && kind != "video" {
		return nil, fmt.Errorf("%w: kind", httpx.ErrBadRequest)
	}
	if err := s.chats.MustMember(ctx, chatID, userID); err != nil {
		return nil, err
	}
	id := uuid.New()
	room := "samal-" + id.String()
	_, err := s.pool.Exec(ctx, `
		INSERT INTO calls (id, chat_id, initiator_id, kind, status, sfu_room)
		VALUES ($1,$2,$3,$4,'ringing',$5)`, id, chatID, userID, kind, room)
	if err != nil {
		return nil, err
	}
	_, _ = s.pool.Exec(ctx, `INSERT INTO call_events (call_id, user_id, event) VALUES ($1,$2,'invite')`, id, userID)
	call, err := s.Get(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	members, _ := s.chats.MemberIDs(ctx, chatID)
	s.hub.PublishMany(ctx, members, realtime.Envelope("call.updated", call))
	return call, nil
}

func (s *Service) Get(ctx context.Context, userID, id uuid.UUID) (*models.Call, error) {
	var c models.Call
	err := s.pool.QueryRow(ctx, `
		SELECT id, chat_id, initiator_id, kind, status, sfu_room, started_at, answered_at, ended_at
		FROM calls WHERE id=$1`, id).
		Scan(&c.ID, &c.ChatID, &c.InitiatorID, &c.Kind, &c.Status, &c.SFURoom, &c.StartedAt, &c.AnsweredAt, &c.EndedAt)
	if err == pgx.ErrNoRows {
		return nil, httpx.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if err := s.chats.MustMember(ctx, c.ChatID, userID); err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *Service) Answer(ctx context.Context, userID, id uuid.UUID) (*models.Call, error) {
	return s.transit(ctx, userID, id, "join", "active", "answered_at")
}

func (s *Service) Reject(ctx context.Context, userID, id uuid.UUID) (*models.Call, error) {
	return s.transit(ctx, userID, id, "reject", "declined", "ended_at")
}

func (s *Service) Hangup(ctx context.Context, userID, id uuid.UUID) (*models.Call, error) {
	call, err := s.Get(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	status := "ended"
	if call.Status == "ringing" {
		status = "missed"
	}
	_, err = s.pool.Exec(ctx, `UPDATE calls SET status=$2, ended_at=now() WHERE id=$1`, id, status)
	if err != nil {
		return nil, err
	}
	_, _ = s.pool.Exec(ctx, `INSERT INTO call_events (call_id, user_id, event) VALUES ($1,$2,'end')`, id, userID)
	call, err = s.Get(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	members, _ := s.chats.MemberIDs(ctx, call.ChatID)
	s.hub.PublishMany(ctx, members, realtime.Envelope("call.updated", call))
	return call, nil
}

func (s *Service) transit(ctx context.Context, userID, id uuid.UUID, event, status, tsCol string) (*models.Call, error) {
	call, err := s.Get(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	q := fmt.Sprintf(`UPDATE calls SET status=$2, %s=now() WHERE id=$1`, tsCol)
	if _, err := s.pool.Exec(ctx, q, id, status); err != nil {
		return nil, err
	}
	_, _ = s.pool.Exec(ctx, `INSERT INTO call_events (call_id, user_id, event) VALUES ($1,$2,$3)`, id, userID, event)
	call, err = s.Get(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	members, _ := s.chats.MemberIDs(ctx, call.ChatID)
	s.hub.PublishMany(ctx, members, realtime.Envelope("call.updated", call))
	return call, nil
}

type JoinToken struct {
	URL        string   `json:"url"`
	Token      string   `json:"token"`
	Room       string   `json:"room"`
	ICEServers []string `json:"ice_servers"`
}

func (s *Service) Token(ctx context.Context, userID, id uuid.UUID) (*JoinToken, error) {
	call, err := s.Get(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	room := ""
	if call.SFURoom != nil {
		room = *call.SFURoom
	}
	out := &JoinToken{
		URL:        s.cfg.LiveKitURL,
		Room:       room,
		ICEServers: []string{"stun:stun.l.google.com:19302"},
	}
	if s.cfg.LiveKitURL != "" && s.cfg.LiveKitKey != "" {
		out.Token = livekitJWT(s.cfg.LiveKitKey, s.cfg.LiveKitSecret, userID.String(), room)
	} else {
		out.Token = "stub-" + userID.String()
	}
	return out, nil
}

func (s *Service) List(ctx context.Context, userID uuid.UUID) ([]models.Call, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT c.id, c.chat_id, c.initiator_id, c.kind, c.status, c.sfu_room, c.started_at, c.answered_at, c.ended_at
		FROM calls c
		JOIN chat_members m ON m.chat_id = c.chat_id
		WHERE m.user_id=$1
		ORDER BY c.started_at DESC
		LIMIT 50`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Call
	for rows.Next() {
		var c models.Call
		if err := rows.Scan(&c.ID, &c.ChatID, &c.InitiatorID, &c.Kind, &c.Status, &c.SFURoom, &c.StartedAt, &c.AnsweredAt, &c.EndedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func livekitJWT(apiKey, apiSecret, identity, room string) string {
	now := time.Now()
	claims := map[string]any{
		"iss": apiKey,
		"sub": identity,
		"nbf": now.Unix(),
		"exp": now.Add(2 * time.Hour).Unix(),
		"video": map[string]any{
			"roomJoin":     true,
			"room":         room,
			"canPublish":   true,
			"canSubscribe": true,
		},
	}
	header := map[string]any{"alg": "HS256", "typ": "JWT"}
	h, _ := json.Marshal(header)
	c, _ := json.Marshal(claims)
	unsigned := b64(h) + "." + b64(c)
	mac := hmac.New(sha256.New, []byte(apiSecret))
	mac.Write([]byte(unsigned))
	return unsigned + "." + b64(mac.Sum(nil))
}

func b64(b []byte) string {
	return base64.RawURLEncoding.EncodeToString(b)
}
