package auth

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"samal.dev/server/internal/httpx"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/otp/request", h.requestOTP)
	r.Post("/otp/verify", h.verifyOTP)
	r.Post("/refresh", h.refresh)
	return r
}

func (h *Handler) requestOTP(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Phone string `json:"phone"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Error(w, 400, "bad_json", "invalid json")
		return
	}
	code, err := h.svc.RequestOTP(r.Context(), in.Phone)
	if err != nil {
		WriteErr(w, err)
		return
	}
	out := map[string]any{"ok": true, "retry_after_sec": 60}
	if code != "" {
		out["dev_code"] = code
	}
	httpx.JSON(w, 200, out)
}

func (h *Handler) verifyOTP(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Phone  string   `json:"phone"`
		Code   string   `json:"code"`
		Device DeviceIn `json:"device"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Error(w, 400, "bad_json", "invalid json")
		return
	}
	sess, err := h.svc.VerifyOTP(r.Context(), in.Phone, in.Code, in.Device)
	if err != nil {
		WriteErr(w, err)
		return
	}
	httpx.JSON(w, 200, sess)
}

func (h *Handler) refresh(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Error(w, 400, "bad_json", "invalid json")
		return
	}
	sess, err := h.svc.Refresh(r.Context(), in.RefreshToken)
	if err != nil {
		WriteErr(w, err)
		return
	}
	httpx.JSON(w, 200, sess)
}

func (h *Handler) Logout() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := h.svc.Logout(r.Context(), httpx.DeviceID(r.Context())); err != nil {
			WriteErr(w, err)
			return
		}
		httpx.JSON(w, 200, map[string]any{"ok": true})
	}
}

func (h *Handler) Me() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, err := h.svc.GetUser(r.Context(), httpx.UserID(r.Context()))
		if err != nil {
			WriteErr(w, err)
			return
		}
		httpx.JSON(w, 200, u)
	}
}

func (h *Handler) PatchMe() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			DisplayName *string `json:"display_name"`
			Username    *string `json:"username"`
			Bio         *string `json:"bio"`
			AvatarURL   *string `json:"avatar_url"`
		}
		if err := httpx.Decode(r, &in); err != nil {
			httpx.Error(w, 400, "bad_json", "invalid json")
			return
		}
		u, err := h.svc.UpdateMe(r.Context(), httpx.UserID(r.Context()), in.DisplayName, in.Username, in.Bio, in.AvatarURL)
		if err != nil {
			WriteErr(w, err)
			return
		}
		httpx.JSON(w, 200, u)
	}
}

func (h *Handler) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := r.Header.Get("Authorization")
		if raw == "" {
			raw = r.URL.Query().Get("token")
		}
		raw = strings.TrimPrefix(raw, "Bearer ")
		if raw == "" {
			httpx.Error(w, 401, "unauthorized", "missing token")
			return
		}
		uid, did, err := h.svc.Parse(raw)
		if err != nil {
			httpx.Error(w, 401, "unauthorized", "invalid token")
			return
		}
		next.ServeHTTP(w, r.WithContext(httpx.WithUser(r.Context(), uid, did)))
	})
}

func WriteErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, httpx.ErrUnauthorized):
		httpx.Error(w, 401, "unauthorized", err.Error())
	case errors.Is(err, httpx.ErrForbidden):
		httpx.Error(w, 403, "forbidden", err.Error())
	case errors.Is(err, httpx.ErrNotFound):
		httpx.Error(w, 404, "not_found", err.Error())
	case errors.Is(err, httpx.ErrConflict):
		httpx.Error(w, 409, "conflict", err.Error())
	case errors.Is(err, httpx.ErrBadRequest):
		httpx.Error(w, 400, "bad_request", err.Error())
	default:
		httpx.Error(w, 500, "internal", "internal error")
	}
}
