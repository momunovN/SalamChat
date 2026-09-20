package sms

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"

	"samal.dev/server/internal/config"
)

// Sender delivers OTP SMS.
type Sender interface {
	SendOTP(ctx context.Context, phone, code string) error
}

func New(cfg config.Config, log *slog.Logger) Sender {
	if log == nil {
		log = slog.Default()
	}
	provider := strings.ToLower(cfg.SMSProvider)
	if cfg.SMSAPIKey != "" && (provider == "" || provider == "stub") {
		if cfg.SMSLogin != "" {
			provider = "smsc"
		} else {
			provider = "smsru"
		}
	}
	switch provider {
	case "smsru":
		return HTTPGateway{
			Name:   "sms.ru",
			Logger: log,
			Build: func(phone, code string) string {
				q := url.Values{
					"api_id": {cfg.SMSAPIKey},
					"to":     {digits(phone)},
					"msg":    {"SAMAL: " + code},
					"json":   {"1"},
				}
				if cfg.SMSSender != "" {
					q.Set("from", cfg.SMSSender)
				}
				return "https://sms.ru/sms/send?" + q.Encode()
			},
			OK: func(body []byte) error {
				var r struct {
					Status     string `json:"status"`
					StatusText string `json:"status_text"`
				}
				_ = json.Unmarshal(body, &r)
				if r.Status != "OK" {
					return fmt.Errorf("sms.ru: %s", r.StatusText)
				}
				return nil
			},
		}
	case "smsc":
		return HTTPGateway{
			Name:   "smsc.ru",
			Logger: log,
			Build: func(phone, code string) string {
				q := url.Values{
					"login":  {cfg.SMSLogin},
					"psw":    {cfg.SMSAPIKey},
					"phones": {digits(phone)},
					"mes":    {"SAMAL: " + code},
					"fmt":    {"3"},
				}
				if cfg.SMSSender != "" {
					q.Set("sender", cfg.SMSSender)
				}
				return "https://smsc.ru/sys/send.php?" + q.Encode()
			},
			OK: func(body []byte) error {
				var r struct {
					Error string `json:"error"`
					ID    int    `json:"id"`
				}
				_ = json.Unmarshal(body, &r)
				if r.Error != "" && r.ID == 0 {
					return fmt.Errorf("smsc.ru: %s", r.Error)
				}
				return nil
			},
		}
	default:
		return Stub{Logger: log}
	}
}

type Stub struct {
	Logger *slog.Logger
}

func (s Stub) SendOTP(_ context.Context, phone, code string) error {
	log := s.Logger
	if log == nil {
		log = slog.Default()
	}
	log.Info("sms stub: otp", "phone", phone, "code", code)
	return nil
}

type HTTPGateway struct {
	Name   string
	Logger *slog.Logger
	Build  func(phone, code string) string
	OK     func(body []byte) error
}

func (g HTTPGateway) SendOTP(ctx context.Context, phone, code string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, g.Build(phone, code), nil)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 15 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<16))
	if g.OK != nil {
		if err := g.OK(body); err != nil {
			g.Logger.Error("sms send failed", "provider", g.Name, "err", err)
			return err
		}
	}
	g.Logger.Info("sms sent", "provider", g.Name, "phone", phone)
	return nil
}

func digits(phone string) string {
	var b strings.Builder
	for _, r := range phone {
		if unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}
