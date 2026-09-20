package presence

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestOnlineTTL(t *testing.T) {
	s := &Store{keys: map[string]time.Time{}}
	id := uuid.New()
	ctx := context.Background()
	if s.Online(ctx, id) {
		t.Fatal("expected offline")
	}
	s.set(key(id), 40*time.Millisecond)
	if !s.Online(ctx, id) {
		t.Fatal("expected online")
	}
	time.Sleep(50 * time.Millisecond)
	if s.Online(ctx, id) {
		t.Fatal("expected expired")
	}
}
