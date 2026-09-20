package realtime

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"samal.dev/server/internal/chats"
	"samal.dev/server/internal/httpx"
	"samal.dev/server/internal/presence"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

type WSHandler struct {
	Hub   *Hub
	Pres  *presence.Store
	Chats *chats.Service
}

func (h *WSHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	c := &Conn{
		UserID:   httpx.UserID(r.Context()),
		DeviceID: httpx.DeviceID(r.Context()),
		send:     make(chan []byte, 64),
		ws:       ws,
	}
	h.Hub.Add(c)
	_ = h.Pres.Heartbeat(r.Context(), c.UserID)

	go h.writeLoop(c)
	h.readLoop(c)
}

func (h *WSHandler) writeLoop(c *Conn) {
	tick := time.NewTicker(25 * time.Second)
	defer func() {
		tick.Stop()
		c.ws.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			_ = c.ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.ws.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.ws.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-tick.C:
			_ = c.ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
			_ = h.Pres.Heartbeat(context.Background(), c.UserID)
		}
	}
}

func (h *WSHandler) readLoop(c *Conn) {
	defer func() {
		h.Hub.Remove(c)
		c.ws.Close()
	}()
	c.ws.SetReadLimit(32 << 10)
	_ = c.ws.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.ws.SetPongHandler(func(string) error {
		_ = c.ws.SetReadDeadline(time.Now().Add(60 * time.Second))
		_ = h.Pres.Heartbeat(context.Background(), c.UserID)
		return nil
	})
	for {
		_, data, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		_ = c.ws.SetReadDeadline(time.Now().Add(60 * time.Second))
		_ = h.Pres.Heartbeat(context.Background(), c.UserID)

		var in struct {
			Type   string    `json:"type"`
			ChatID uuid.UUID `json:"chat_id"`
		}
		if err := json.Unmarshal(data, &in); err != nil {
			continue
		}
		switch in.Type {
		case "ping":
			pong, _ := json.Marshal(Envelope("pong", map[string]any{}))
			select {
			case c.send <- pong:
			default:
			}
		case "typing":
			if in.ChatID == uuid.Nil {
				continue
			}
			ctx := context.Background()
			if err := h.Chats.MustMember(ctx, in.ChatID, c.UserID); err != nil {
				continue
			}
			_ = h.Pres.SetTyping(ctx, in.ChatID, c.UserID)
			members, _ := h.Chats.MemberIDs(ctx, in.ChatID)
			env := Envelope("typing", map[string]any{
				"chat_id": in.ChatID,
				"user_id": c.UserID,
			})
			for _, m := range members {
				if m == c.UserID {
					continue
				}
				_ = h.Hub.Publish(ctx, m, env)
			}
		}
	}
}
