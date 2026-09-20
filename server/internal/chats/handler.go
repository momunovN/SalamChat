package chats

import (
	"net/http"

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

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Post("/direct", h.Direct)
	r.Post("/groups", h.Group)
	r.Get("/{chatID}", h.Get)
	r.Post("/{chatID}/read", h.Read)
	return r
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	kind := r.URL.Query().Get("type") // direct|group|""
	q := r.URL.Query().Get("q")
	items, err := h.svc.List(r.Context(), httpx.UserID(r.Context()), q, kind)
	if err != nil {
		auth.WriteErr(w, err)
		return
	}
	if items == nil {
		items = []models.Chat{}
	}
	httpx.JSON(w, 200, map[string]any{"items": items})
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "chatID"))
	if err != nil {
		httpx.Error(w, 400, "bad_id", "invalid chat id")
		return
	}
	c, err := h.svc.Get(r.Context(), httpx.UserID(r.Context()), id)
	if err != nil {
		auth.WriteErr(w, err)
		return
	}
	httpx.JSON(w, 200, c)
}

func (h *Handler) Direct(w http.ResponseWriter, r *http.Request) {
	var in struct {
		UserID uuid.UUID `json:"user_id"`
	}
	if err := httpx.Decode(r, &in); err != nil || in.UserID == uuid.Nil {
		httpx.Error(w, 400, "bad_json", "user_id required")
		return
	}
	c, err := h.svc.Direct(r.Context(), httpx.UserID(r.Context()), in.UserID)
	if err != nil {
		auth.WriteErr(w, err)
		return
	}
	httpx.JSON(w, 200, c)
}

func (h *Handler) Group(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Title   string      `json:"title"`
		Members []uuid.UUID `json:"member_ids"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Error(w, 400, "bad_json", "invalid json")
		return
	}
	c, err := h.svc.CreateGroup(r.Context(), httpx.UserID(r.Context()), in.Title, in.Members)
	if err != nil {
		auth.WriteErr(w, err)
		return
	}
	httpx.JSON(w, 201, c)
}

func (h *Handler) Read(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "chatID"))
	if err != nil {
		httpx.Error(w, 400, "bad_id", "invalid chat id")
		return
	}
	var in struct {
		MessageID uuid.UUID `json:"message_id"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Error(w, 400, "bad_json", "invalid json")
		return
	}
	if err := h.svc.MarkRead(r.Context(), id, httpx.UserID(r.Context()), in.MessageID); err != nil {
		auth.WriteErr(w, err)
		return
	}
	httpx.JSON(w, 200, map[string]any{"ok": true})
}
