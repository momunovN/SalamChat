package calls

import (
	"context"
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

func (h *Handler) Mount(r chi.Router) {
	r.Get("/calls", h.list)
	r.Get("/calls/{id}", h.get)
	r.Post("/calls/{id}/answer", h.answer)
	r.Post("/calls/{id}/reject", h.reject)
	r.Post("/calls/{id}/hangup", h.hangup)
	r.Get("/calls/{id}/token", h.token)
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	items, err := h.svc.List(r.Context(), httpx.UserID(r.Context()))
	if err != nil {
		auth.WriteErr(w, err)
		return
	}
	if items == nil {
		items = []models.Call{}
	}
	httpx.JSON(w, 200, map[string]any{"items": items})
}

func (h *Handler) Start(w http.ResponseWriter, r *http.Request) {
	chatID, err := uuid.Parse(chi.URLParam(r, "chatID"))
	if err != nil {
		httpx.Error(w, 400, "bad_id", "invalid chat id")
		return
	}
	var in struct {
		Kind string `json:"kind"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Error(w, 400, "bad_json", "invalid json")
		return
	}
	c, err := h.svc.Start(r.Context(), httpx.UserID(r.Context()), chatID, in.Kind)
	if err != nil {
		auth.WriteErr(w, err)
		return
	}
	httpx.JSON(w, 201, c)
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, 400, "bad_id", "invalid id")
		return
	}
	c, err := h.svc.Get(r.Context(), httpx.UserID(r.Context()), id)
	if err != nil {
		auth.WriteErr(w, err)
		return
	}
	httpx.JSON(w, 200, c)
}

func (h *Handler) answer(w http.ResponseWriter, r *http.Request) { h.mutate(w, r, h.svc.Answer) }
func (h *Handler) reject(w http.ResponseWriter, r *http.Request) { h.mutate(w, r, h.svc.Reject) }
func (h *Handler) hangup(w http.ResponseWriter, r *http.Request) { h.mutate(w, r, h.svc.Hangup) }

func (h *Handler) mutate(w http.ResponseWriter, r *http.Request, fn func(ctx context.Context, user, id uuid.UUID) (*models.Call, error)) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, 400, "bad_id", "invalid id")
		return
	}
	c, err := fn(r.Context(), httpx.UserID(r.Context()), id)
	if err != nil {
		auth.WriteErr(w, err)
		return
	}
	httpx.JSON(w, 200, c)
}

func (h *Handler) token(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, 400, "bad_id", "invalid id")
		return
	}
	tok, err := h.svc.Token(r.Context(), httpx.UserID(r.Context()), id)
	if err != nil {
		auth.WriteErr(w, err)
		return
	}
	httpx.JSON(w, 200, tok)
}
