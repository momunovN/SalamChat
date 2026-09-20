package upload

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"samal.dev/server/internal/auth"
	"samal.dev/server/internal/httpx"
)

type Handler struct {
	store *Store
}

func NewHandler(store *Store) *Handler { return &Handler{store: store} }

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/intent", h.intent)
	r.Post("/{id}/complete", h.complete)
	return r
}

func (h *Handler) intent(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Mime string `json:"mime"`
		Kind string `json:"kind"`
		Size int64  `json:"size_bytes"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Error(w, 400, "bad_json", "invalid json")
		return
	}
	out, err := h.store.Intent(r.Context(), httpx.UserID(r.Context()), in.Mime, in.Kind, in.Size)
	if err != nil {
		auth.WriteErr(w, err)
		return
	}
	httpx.JSON(w, 200, out)
}

func (h *Handler) complete(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, 400, "bad_id", "invalid id")
		return
	}
	url, err := h.store.Complete(r.Context(), httpx.UserID(r.Context()), id)
	if err != nil {
		auth.WriteErr(w, err)
		return
	}
	httpx.JSON(w, 200, map[string]any{"url": url, "id": id})
}
