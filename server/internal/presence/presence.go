package presence

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
)

const ttl = 45 * time.Second

type Store struct {
	mu   sync.Mutex
	keys map[string]time.Time
}

func New() *Store {
	s := &Store{keys: map[string]time.Time{}}
	go s.gc()
	return s
}

func key(id uuid.UUID) string { return "presence:" + id.String() }
func typingKey(chat, user uuid.UUID) string {
	return "typing:" + chat.String() + ":" + user.String()
}

func (s *Store) Heartbeat(_ context.Context, userID uuid.UUID) error {
	s.set(key(userID), ttl)
	return nil
}

func (s *Store) Online(_ context.Context, userID uuid.UUID) bool {
	return s.has(key(userID))
}

func (s *Store) SetTyping(_ context.Context, chatID, userID uuid.UUID) error {
	s.set(typingKey(chatID, userID), 3*time.Second)
	return nil
}

func (s *Store) TypingUsers(_ context.Context, chatID uuid.UUID, members []uuid.UUID) []uuid.UUID {
	var out []uuid.UUID
	for _, m := range members {
		if s.has(typingKey(chatID, m)) {
			out = append(out, m)
		}
	}
	return out
}

func (s *Store) set(k string, d time.Duration) {
	s.mu.Lock()
	s.keys[k] = time.Now().Add(d)
	s.mu.Unlock()
}

func (s *Store) has(k string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	exp, ok := s.keys[k]
	if !ok {
		return false
	}
	if time.Now().After(exp) {
		delete(s.keys, k)
		return false
	}
	return true
}

func (s *Store) gc() {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for range t.C {
		now := time.Now()
		s.mu.Lock()
		for k, exp := range s.keys {
			if now.After(exp) {
				delete(s.keys, k)
			}
		}
		s.mu.Unlock()
	}
}
