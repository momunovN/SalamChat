package messages

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"samal.dev/server/internal/chats"
	"samal.dev/server/internal/httpx"
	"samal.dev/server/internal/models"
	"samal.dev/server/internal/realtime"
)

type Service struct {
	pool      *pgxpool.Pool
	chats     *chats.Service
	hub       *realtime.Hub
	publicURL string
}

func New(pool *pgxpool.Pool, chats *chats.Service, hub *realtime.Hub, publicURL string) *Service {
	return &Service{pool: pool, chats: chats, hub: hub, publicURL: strings.TrimRight(publicURL, "/")}
}

type SendIn struct {
	ClientID  string          `json:"client_id"`
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
	ReplyToID *uuid.UUID      `json:"reply_to_id"`
	UploadIDs []uuid.UUID     `json:"upload_ids"`
}

func (s *Service) Send(ctx context.Context, userID, chatID uuid.UUID, in SendIn) (*models.Message, error) {
	if err := s.chats.MustMember(ctx, chatID, userID); err != nil {
		return nil, err
	}
	if in.ClientID == "" {
		return nil, fmt.Errorf("%w: client_id required", httpx.ErrBadRequest)
	}
	switch in.Type {
	case "text", "photo", "file", "voice", "location", "system":
	default:
		return nil, fmt.Errorf("%w: bad type", httpx.ErrBadRequest)
	}
	if in.Type == "system" {
		return nil, fmt.Errorf("%w: system messages are server-only", httpx.ErrForbidden)
	}
	if in.Payload == nil {
		in.Payload = json.RawMessage(`{}`)
	}
	if in.Type == "text" {
		var p struct {
			Text string `json:"text"`
		}
		_ = json.Unmarshal(in.Payload, &p)
		p.Text = strings.TrimSpace(p.Text)
		if p.Text == "" || utf8.RuneCountInString(p.Text) > 4096 {
			return nil, fmt.Errorf("%w: text length", httpx.ErrBadRequest)
		}
	}

	var existing models.Message
	err := s.scanOne(ctx, s.pool.QueryRow(ctx, `
		SELECT id, chat_id, author_id, type, payload, client_id, reply_to_id, created_at, edited_at, deleted_at
		FROM messages WHERE client_id=$1`, in.ClientID), &existing)
	if err == nil {
		existing.Attachments, _ = s.attachments(ctx, existing.ID)
		existing.Status = s.statusFor(ctx, existing.ID, userID)
		return &existing, nil
	}
	if err != nil && err != pgx.ErrNoRows {
		return nil, err
	}

	id := uuid.New()
	author := userID
	_, err = s.pool.Exec(ctx, `
		INSERT INTO messages (id, chat_id, author_id, type, payload, client_id, reply_to_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		id, chatID, author, in.Type, []byte(in.Payload), in.ClientID, in.ReplyToID)
	if err != nil {
		if isUnique(err) {
			return s.Send(ctx, userID, chatID, in)
		}
		return nil, err
	}

	if len(in.UploadIDs) > 0 {
		if err := s.attachUploads(ctx, userID, id, in.Type, in.UploadIDs); err != nil {
			return nil, err
		}
	}

	msg, err := s.Get(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	msg.Status = "sent"

	members, _ := s.chats.MemberIDs(ctx, chatID)
	env := realtime.Envelope("message.created", msg)
	s.hub.PublishMany(ctx, members, env)
	return msg, nil
}

func (s *Service) List(ctx context.Context, userID, chatID uuid.UUID, q, cursor string, limit int) ([]models.Message, *string, error) {
	if err := s.chats.MustMember(ctx, chatID, userID); err != nil {
		return nil, nil, err
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	q = strings.TrimSpace(q)
	var before time.Time
	if cursor != "" {
		t, err := time.Parse(time.RFC3339Nano, cursor)
		if err != nil {
			return nil, nil, fmt.Errorf("%w: bad cursor", httpx.ErrBadRequest)
		}
		before = t
	} else {
		before = time.Now().Add(time.Hour)
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id, chat_id, author_id, type, payload, client_id, reply_to_id, created_at, edited_at, deleted_at
		FROM messages
		WHERE chat_id=$1 AND created_at < $2 AND deleted_at IS NULL
		  AND ($3 = '' OR (payload->>'text') ILIKE '%'||$3||'%')
		ORDER BY created_at DESC
		LIMIT $4`, chatID, before, q, limit+1)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var items []models.Message
	for rows.Next() {
		var m models.Message
		if err := scanMsg(rows, &m); err != nil {
			return nil, nil, err
		}
		items = append(items, m)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	var next *string
	if len(items) > limit {
		c := items[limit-1].CreatedAt.UTC().Format(time.RFC3339Nano)
		next = &c
		items = items[:limit]
	}
	ids := make([]uuid.UUID, len(items))
	for i := range items {
		ids[i] = items[i].ID
	}
	atts, err := s.attachmentsFor(ctx, ids)
	if err != nil {
		return nil, nil, err
	}
	for i := range items {
		items[i].Attachments = atts[items[i].ID]
		if items[i].AuthorID != nil && *items[i].AuthorID == userID {
			items[i].Status = s.statusFor(ctx, items[i].ID, userID)
		}
	}
	return items, next, nil
}

func (s *Service) Get(ctx context.Context, userID, id uuid.UUID) (*models.Message, error) {
	var m models.Message
	err := s.scanOne(ctx, s.pool.QueryRow(ctx, `
		SELECT id, chat_id, author_id, type, payload, client_id, reply_to_id, created_at, edited_at, deleted_at
		FROM messages WHERE id=$1`, id), &m)
	if err == pgx.ErrNoRows {
		return nil, httpx.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if err := s.chats.MustMember(ctx, m.ChatID, userID); err != nil {
		return nil, err
	}
	m.Attachments, _ = s.attachments(ctx, m.ID)
	return &m, nil
}

func (s *Service) Receipts(ctx context.Context, userID uuid.UUID, messageIDs []uuid.UUID, status string) error {
	if status != "delivered" && status != "read" {
		return fmt.Errorf("%w: bad status", httpx.ErrBadRequest)
	}
	if len(messageIDs) == 0 {
		return nil
	}
	for _, id := range messageIDs {
		var chatID uuid.UUID
		var author *uuid.UUID
		err := s.pool.QueryRow(ctx, `SELECT chat_id, author_id FROM messages WHERE id=$1`, id).Scan(&chatID, &author)
		if err != nil {
			continue
		}
		if err := s.chats.MustMember(ctx, chatID, userID); err != nil {
			continue
		}
		if author != nil && *author == userID {
			continue
		}
		_, err = s.pool.Exec(ctx, `
			INSERT INTO receipts (message_id, user_id, status, at)
			VALUES ($1,$2,$3,now())
			ON CONFLICT (message_id, user_id) DO UPDATE
			  SET status = CASE
			    WHEN receipts.status = 'read' THEN 'read'
			    ELSE EXCLUDED.status
			  END,
			  at = now()`, id, userID, status)
		if err != nil {
			return err
		}
		if status == "read" {
			_, _ = s.pool.Exec(ctx, `
				UPDATE chat_members SET last_read_at=now(), last_read_message_id=$3
				WHERE chat_id=$1 AND user_id=$2`, chatID, userID, id)
		}
		if author != nil {
			env := realtime.Envelope("receipt.upserted", map[string]any{
				"message_id": id,
				"user_id":    userID,
				"status":     status,
				"chat_id":    chatID,
			})
			_ = s.hub.Publish(ctx, *author, env)
		}
	}
	return nil
}

func (s *Service) attachUploads(ctx context.Context, userID, messageID uuid.UUID, msgType string, uploadIDs []uuid.UUID) error {
	kind := msgType
	if msgType == "photo" {
		kind = "photo"
	}
	for _, uid := range uploadIDs {
		var objectKey, mime, status, ukind string
		var size int64
		err := s.pool.QueryRow(ctx, `
			SELECT object_key, mime, size_bytes, kind, status FROM uploads WHERE id=$1 AND user_id=$2`,
			uid, userID).Scan(&objectKey, &mime, &size, &ukind, &status)
		if err != nil {
			return fmt.Errorf("%w: upload not found", httpx.ErrBadRequest)
		}
		if status != "ready" {
			return fmt.Errorf("%w: upload not ready", httpx.ErrBadRequest)
		}
		if kind == "photo" && ukind != "photo" && ukind != "video" {
			kind = ukind
		} else if ukind != "" {
			kind = ukind
		}
		_, err = s.pool.Exec(ctx, `
			INSERT INTO attachments (message_id, kind, object_key, mime, size_bytes)
			VALUES ($1,$2,$3,$4,$5)`, messageID, kind, objectKey, mime, size)
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) attachments(ctx context.Context, messageID uuid.UUID) ([]models.Attachment, error) {
	m, err := s.attachmentsFor(ctx, []uuid.UUID{messageID})
	if err != nil {
		return nil, err
	}
	return m[messageID], nil
}

func (s *Service) attachmentsFor(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID][]models.Attachment, error) {
	out := map[uuid.UUID][]models.Attachment{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, message_id, kind, object_key, mime, size_bytes, width, height, duration_ms, waveform, filename
		FROM attachments WHERE message_id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var a models.Attachment
		var messageID uuid.UUID
		var objectKey string
		var wave []byte
		if err := rows.Scan(&a.ID, &messageID, &a.Kind, &objectKey, &a.Mime, &a.SizeBytes, &a.Width, &a.Height, &a.DurationMS, &wave, &a.Filename); err != nil {
			return nil, err
		}
		a.ObjectKey = objectKey
		a.URL = s.publicURL + "/" + objectKey
		if len(wave) > 0 {
			a.Waveform = json.RawMessage(wave)
		}
		out[messageID] = append(out[messageID], a)
	}
	return out, rows.Err()
}

func (s *Service) statusFor(ctx context.Context, messageID, author uuid.UUID) string {
	var delivered, read int
	_ = s.pool.QueryRow(ctx, `
		SELECT
		  COALESCE(sum(CASE WHEN status IN ('delivered','read') THEN 1 ELSE 0 END),0),
		  COALESCE(sum(CASE WHEN status = 'read' THEN 1 ELSE 0 END),0)
		FROM receipts WHERE message_id=$1`, messageID).Scan(&delivered, &read)
	if read > 0 {
		return "read"
	}
	if delivered > 0 {
		return "delivered"
	}
	return "sent"
}

type scanner interface {
	Scan(dest ...any) error
}

func (s *Service) scanOne(ctx context.Context, row scanner, m *models.Message) error {
	return scanMsg(row, m)
}

func scanMsg(row scanner, m *models.Message) error {
	var payload []byte
	err := row.Scan(&m.ID, &m.ChatID, &m.AuthorID, &m.Type, &payload, &m.ClientID, &m.ReplyToID, &m.CreatedAt, &m.EditedAt, &m.DeletedAt)
	if err != nil {
		return err
	}
	m.Payload = json.RawMessage(payload)
	return nil
}

func isUnique(err error) bool {
	return strings.Contains(err.Error(), "messages_client_id_uidx") || strings.Contains(err.Error(), "duplicate key")
}
