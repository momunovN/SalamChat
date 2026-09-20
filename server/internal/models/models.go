package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type User struct {
	ID          uuid.UUID  `json:"id" db:"id"`
	Phone       string     `json:"phone" db:"phone"`
	DisplayName string     `json:"display_name" db:"display_name"`
	Username    *string    `json:"username,omitempty" db:"username"`
	AvatarURL   *string    `json:"avatar_url,omitempty" db:"avatar_url"`
	Bio         string     `json:"bio" db:"bio"`
	CreatedAt   time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at" db:"updated_at"`
	LastSeenAt  *time.Time `json:"last_seen_at,omitempty" db:"last_seen_at"`
	Online      bool       `json:"online,omitempty" db:"-"`
}

type Session struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
	User         User      `json:"user"`
	DeviceID     uuid.UUID `json:"device_id"`
}

type Chat struct {
	ID          uuid.UUID  `json:"id"`
	Type        string     `json:"type"`
	Title       string     `json:"title"`
	AvatarURL   *string    `json:"avatar_url,omitempty"`
	Peer        *User      `json:"peer,omitempty"`
	LastMessage *Message   `json:"last_message,omitempty"`
	UnreadCount int        `json:"unread_count"`
	MutedUntil  *time.Time `json:"muted_until,omitempty"`
	MemberCount int        `json:"member_count"`
	UpdatedAt   time.Time  `json:"updated_at"`
	CreatedAt   time.Time  `json:"created_at"`
}

type Message struct {
	ID          uuid.UUID       `json:"id"`
	ChatID      uuid.UUID       `json:"chat_id"`
	AuthorID    *uuid.UUID      `json:"author_id,omitempty"`
	Type        string          `json:"type"`
	Payload     json.RawMessage `json:"payload"`
	ClientID    string          `json:"client_id"`
	ReplyToID   *uuid.UUID      `json:"reply_to_id,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`
	EditedAt    *time.Time      `json:"edited_at,omitempty"`
	DeletedAt   *time.Time      `json:"deleted_at,omitempty"`
	Attachments []Attachment    `json:"attachments,omitempty"`
	Status      string          `json:"status,omitempty"` // sending|sent|delivered|read — computed for author
}

type Attachment struct {
	ID         uuid.UUID       `json:"id"`
	Kind       string          `json:"kind"`
	URL        string          `json:"url"`
	ObjectKey  string          `json:"object_key"`
	Mime       string          `json:"mime"`
	SizeBytes  int64           `json:"size_bytes"`
	Width      *int            `json:"width,omitempty"`
	Height     *int            `json:"height,omitempty"`
	DurationMS *int            `json:"duration_ms,omitempty"`
	Waveform   json.RawMessage `json:"waveform,omitempty"`
	Filename   *string         `json:"filename,omitempty"`
}

type Call struct {
	ID          uuid.UUID  `json:"id"`
	ChatID      uuid.UUID  `json:"chat_id"`
	InitiatorID uuid.UUID  `json:"initiator_id"`
	Kind        string     `json:"kind"`
	Status      string     `json:"status"`
	SFURoom     *string    `json:"sfu_room,omitempty"`
	StartedAt   time.Time  `json:"started_at"`
	AnsweredAt  *time.Time `json:"answered_at,omitempty"`
	EndedAt     *time.Time `json:"ended_at,omitempty"`
}

type Envelope struct {
	Type string          `json:"type"`
	TS   time.Time       `json:"ts"`
	Body json.RawMessage `json:"body"`
}

type Page[T any] struct {
	Items  []T     `json:"items"`
	Cursor *string `json:"cursor,omitempty"`
}
