package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"samal.dev/server/internal/models"
)

type Conn struct {
	UserID   uuid.UUID
	DeviceID uuid.UUID
	send     chan []byte
	ws       *websocket.Conn
}

type Hub struct {
	log  *slog.Logger
	mu   sync.RWMutex
	subs map[uuid.UUID]map[*Conn]struct{}
}

func NewHub(log *slog.Logger) *Hub {
	if log == nil {
		log = slog.Default()
	}
	return &Hub{
		log:  log,
		subs: map[uuid.UUID]map[*Conn]struct{}{},
	}
}

func (h *Hub) Add(c *Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.subs[c.UserID] == nil {
		h.subs[c.UserID] = map[*Conn]struct{}{}
	}
	h.subs[c.UserID][c] = struct{}{}
}

func (h *Hub) Remove(c *Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if m := h.subs[c.UserID]; m != nil {
		delete(m, c)
		if len(m) == 0 {
			delete(h.subs, c.UserID)
		}
	}
	close(c.send)
}

func (h *Hub) LocalOnline(userID uuid.UUID) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.subs[userID]) > 0
}

func (h *Hub) Publish(_ context.Context, userID uuid.UUID, env models.Envelope) error {
	if env.TS.IsZero() {
		env.TS = time.Now().UTC()
	}
	b, err := json.Marshal(env)
	if err != nil {
		return err
	}
	h.deliver(userID, b)
	return nil
}

func (h *Hub) PublishMany(ctx context.Context, userIDs []uuid.UUID, env models.Envelope) {
	seen := map[uuid.UUID]struct{}{}
	for _, id := range userIDs {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		_ = h.Publish(ctx, id, env)
	}
}

func (h *Hub) deliver(userID uuid.UUID, b []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.subs[userID] {
		select {
		case c.send <- b:
		default:
			h.log.Warn("ws slow consumer drop", "user", userID)
		}
	}
}

func Envelope(typ string, body any) models.Envelope {
	raw, _ := json.Marshal(body)
	return models.Envelope{Type: typ, TS: time.Now().UTC(), Body: raw}
}
