package chats

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"samal.dev/server/internal/httpx"
	"samal.dev/server/internal/models"
	"samal.dev/server/internal/presence"
)

type Service struct {
	pool *pgxpool.Pool
	pres *presence.Store
}

func New(pool *pgxpool.Pool, pres *presence.Store) *Service {
	return &Service{pool: pool, pres: pres}
}

func (s *Service) List(ctx context.Context, userID uuid.UUID, q, kind string) ([]models.Chat, error) {
	q = strings.TrimSpace(q)
	rows, err := s.pool.Query(ctx, `
		SELECT
			c.id, c.type, COALESCE(c.title, ''), c.avatar_url, c.created_at, c.updated_at,
			cm.muted_until,
			(SELECT count(*) FROM chat_members x WHERE x.chat_id=c.id) AS member_count,
			COALESCE((
				SELECT count(*) FROM messages msg
				WHERE msg.chat_id=c.id AND msg.deleted_at IS NULL
				  AND msg.author_id IS DISTINCT FROM $1
				  AND (cm.last_read_at IS NULL OR msg.created_at > cm.last_read_at)
			),0) AS unread,
			peer.id, peer.phone, peer.display_name, peer.username, peer.avatar_url, peer.bio,
			peer.created_at, peer.updated_at, peer.last_seen_at,
			lm.id, lm.chat_id, lm.author_id, lm.type, lm.payload, lm.client_id, lm.reply_to_id,
			lm.created_at, lm.edited_at, lm.deleted_at
		FROM chat_members cm
		JOIN chats c ON c.id = cm.chat_id
		LEFT JOIN LATERAL (
			SELECT u.* FROM chat_members cm2
			JOIN users u ON u.id = cm2.user_id
			WHERE cm2.chat_id = c.id AND cm2.user_id <> $1
			LIMIT 1
		) peer ON c.type = 'direct'
		LEFT JOIN messages lm ON lm.id = c.last_message_id
		WHERE cm.user_id = $1
		  AND ($2 = '' OR c.type = $2)
		  AND (
		    $3 = '' OR
		    c.title ILIKE '%'||$3||'%' OR
		    peer.display_name ILIKE '%'||$3||'%' OR
		    peer.username ILIKE '%'||$3||'%'
		  )
		ORDER BY c.updated_at DESC
		LIMIT 100
	`, userID, kind, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Chat
	for rows.Next() {
		var c models.Chat
		var title string
		var muted *time.Time
		var peerID *uuid.UUID
		var peerPhone, peerName, peerBio *string
		var peerUser, peerAvatar *string
		var peerCreated, peerUpdated *time.Time
		var peerSeen *time.Time
		var mid *uuid.UUID
		var mChat *uuid.UUID
		var mAuthor *uuid.UUID
		var mType *string
		var mPayload []byte
		var mClient *string
		var mReply *uuid.UUID
		var mCreated *time.Time
		var mEdited, mDeleted *time.Time

		if err := rows.Scan(
			&c.ID, &c.Type, &title, &c.AvatarURL, &c.CreatedAt, &c.UpdatedAt,
			&muted, &c.MemberCount, &c.UnreadCount,
			&peerID, &peerPhone, &peerName, &peerUser, &peerAvatar, &peerBio,
			&peerCreated, &peerUpdated, &peerSeen,
			&mid, &mChat, &mAuthor, &mType, &mPayload, &mClient, &mReply,
			&mCreated, &mEdited, &mDeleted,
		); err != nil {
			return nil, err
		}
		c.Title = title
		c.MutedUntil = muted
		if peerID != nil {
			u := models.User{
				ID: *peerID, Phone: deref(peerPhone), DisplayName: deref(peerName),
				Username: peerUser, AvatarURL: peerAvatar, Bio: deref(peerBio),
				LastSeenAt: peerSeen,
			}
			if peerCreated != nil {
				u.CreatedAt = *peerCreated
			}
			if peerUpdated != nil {
				u.UpdatedAt = *peerUpdated
			}
			u.Online = s.pres.Online(ctx, u.ID)
			c.Peer = &u
			if c.Title == "" {
				c.Title = u.DisplayName
			}
			if c.AvatarURL == nil {
				c.AvatarURL = u.AvatarURL
			}
		}
		if mid != nil {
			c.LastMessage = &models.Message{
				ID: *mid, ChatID: *mChat, AuthorID: mAuthor, Type: deref(mType),
				Payload: json.RawMessage(mPayload), ClientID: deref(mClient),
				ReplyToID: mReply, CreatedAt: *mCreated, EditedAt: mEdited, DeletedAt: mDeleted,
			}
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Service) Get(ctx context.Context, userID, chatID uuid.UUID) (*models.Chat, error) {
	if err := s.MustMember(ctx, chatID, userID); err != nil {
		return nil, err
	}
	list, err := s.List(ctx, userID, "", "")
	if err != nil {
		return nil, err
	}
	for i := range list {
		if list[i].ID == chatID {
			return &list[i], nil
		}
	}
	return nil, httpx.ErrNotFound
}

func (s *Service) Direct(ctx context.Context, me, peer uuid.UUID) (*models.Chat, error) {
	if me == peer {
		return nil, fmt.Errorf("%w: cannot chat with self", httpx.ErrBadRequest)
	}
	a, b := me, peer
	if a.String() > b.String() {
		a, b = b, a
	}
	key := a.String() + ":" + b.String()

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var chatID uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id FROM chats WHERE peer_key=$1`, key).Scan(&chatID)
	if err == pgx.ErrNoRows {
		chatID = uuid.New()
		_, err = tx.Exec(ctx, `INSERT INTO chats (id, type, created_by, peer_key) VALUES ($1,'direct',$2,$3)`, chatID, me, key)
		if err != nil {
			return nil, err
		}
		_, err = tx.Exec(ctx, `INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1,$2,'member'),($1,$3,'member')`, chatID, me, peer)
		if err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.Get(ctx, me, chatID)
}

func (s *Service) CreateGroup(ctx context.Context, me uuid.UUID, title string, memberIDs []uuid.UUID) (*models.Chat, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return nil, fmt.Errorf("%w: title required", httpx.ErrBadRequest)
	}
	seen := map[uuid.UUID]struct{}{me: {}}
	members := []uuid.UUID{me}
	for _, id := range memberIDs {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		members = append(members, id)
	}
	if len(members) > 256 {
		return nil, fmt.Errorf("%w: too many members", httpx.ErrBadRequest)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	chatID := uuid.New()
	_, err = tx.Exec(ctx, `INSERT INTO chats (id, type, title, created_by) VALUES ($1,'group',$2,$3)`, chatID, title, me)
	if err != nil {
		return nil, err
	}
	for _, id := range members {
		role := "member"
		if id == me {
			role = "owner"
		}
		if _, err := tx.Exec(ctx, `INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1,$2,$3)`, chatID, id, role); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.Get(ctx, me, chatID)
}

func (s *Service) MustMember(ctx context.Context, chatID, userID uuid.UUID) error {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2`, chatID, userID).Scan(&n)
	if err == pgx.ErrNoRows {
		return httpx.ErrForbidden
	}
	return err
}

func (s *Service) MemberIDs(ctx context.Context, chatID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `SELECT user_id FROM chat_members WHERE chat_id=$1`, chatID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s *Service) MarkRead(ctx context.Context, chatID, userID, messageID uuid.UUID) error {
	if err := s.MustMember(ctx, chatID, userID); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE chat_members SET last_read_at=now(), last_read_message_id=$3
		WHERE chat_id=$1 AND user_id=$2`, chatID, userID, messageID)
	return err
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
