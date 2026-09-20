package messages

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"samal.dev/server/internal/auth"
	"samal.dev/server/internal/httpx"
	"samal.dev/server/internal/models"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Mount(r chi.Router) {
	r.Get("/chats/{chatID}/messages", h.List)
	r.Post("/chats/{chatID}/messages", h.Send)
	r.Post("/receipts", h.Receipts)
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	chatID, err := uuid.Parse(chi.URLParam(r, "chatID"))
	if err != nil {
		httpx.Error(w, 400, "bad_id", "invalid chat id")
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, cursor, err := h.svc.List(r.Context(), httpx.UserID(r.Context()), chatID, r.URL.Query().Get("q"), r.URL.Query().Get("cursor"), limit)
	if err != nil {
		auth.WriteErr(w, err)
		return
	}
	if items == nil {
		items = []models.Message{}
	}
	httpx.JSON(w, 200, map[string]any{"items": items, "cursor": cursor})
}

func (h *Handler) Send(w http.ResponseWriter, r *http.Request) {
	chatID, err := uuid.Parse(chi.URLParam(r, "chatID"))
	if err != nil {
		httpx.Error(w, 400, "bad_id", "invalid chat id")
		return
	}
	var in SendIn
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Error(w, 400, "bad_json", "invalid json")
		return
	}
	msg, err := h.svc.Send(r.Context(), httpx.UserID(r.Context()), chatID, in)
	if err != nil {
		auth.WriteErr(w, err)
		return
	}
	httpx.JSON(w, 201, msg)
}

func (h *Handler) Receipts(w http.ResponseWriter, r *http.Request) {
	var in struct {
		MessageIDs []uuid.UUID `json:"message_ids"`
		Status     string      `json:"status"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Error(w, 400, "bad_json", "invalid json")
		return
	}
	if err := h.svc.Receipts(r.Context(), httpx.UserID(r.Context()), in.MessageIDs, in.Status); err != nil {
		auth.WriteErr(w, err)
		return
	}
	httpx.JSON(w, 200, map[string]any{"ok": true})
}
