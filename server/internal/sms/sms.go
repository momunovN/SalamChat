package sms

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
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
	provider := strings.ToLower(strings.TrimSpace(cfg.SMSProvider))
	// Earlier cabinets were sms.ru / smsc.ru. Those names now send through P1SMS.
	if provider == "smsru" || provider == "smsc" {
		provider = "p1sms"
	}
	if cfg.SMSAPIKey != "" && (provider == "" || provider == "stub") {
		provider = "p1sms"
	}
	if provider == "p1sms" {
		return P1{Key: cfg.SMSAPIKey, Sender: cfg.SMSSender, Logger: log}
	}
	return Stub{Logger: log}
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

// P1 posts one OTP to https://admin.p1sms.ru/apiSms/create.
// The digit channel is promo and stays in moderation. OTP uses char and VIRTA,
// the shared sender on a new P1SMS account, unless SMS_SENDER names another one.
type P1 struct {
	Key    string
	Sender string
	Logger *slog.Logger
}

func (p P1) SendOTP(ctx context.Context, phone, code string) error {
	if strings.TrimSpace(p.Key) == "" {
		return fmt.Errorf("p1sms: SMS_API_KEY required")
	}
	sender := strings.TrimSpace(p.Sender)
	if sender == "" || strings.EqualFold(sender, "TooApp") || strings.EqualFold(sender, "Salam") || strings.EqualFold(sender, "SAMAL") {
		sender = "VIRTA"
	}
	item := map[string]string{
		"channel": "char",
		"sender":  sender,
		"phone":   digits(phone),
		"text":    "Salam: " + code,
	}
	raw, err := json.Marshal(map[string]any{
		"apiKey": p.Key,
		"sms":    []map[string]string{item},
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://admin.p1sms.ru/apiSms/create", bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	client := &http.Client{Timeout: 15 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<16))
	if err := p1OK(res.StatusCode, body); err != nil {
		p.Logger.Error("sms send failed", "provider", "p1sms", "err", err)
		return err
	}
	p.Logger.Info("sms sent", "provider", "p1sms", "phone", phone)
	return nil
}

func p1OK(status int, body []byte) error {
	var r struct {
		Status  string          `json:"status"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return fmt.Errorf("p1sms %d: %s", status, truncate(body))
	}
	if status >= 300 || r.Status != "success" {
		if msg := p1DataMessage(r.Data); msg != "" {
			return fmt.Errorf("p1sms: %s", msg)
		}
		if r.Message != "" {
			return fmt.Errorf("p1sms: %s", r.Message)
		}
		if r.Status != "" {
			return fmt.Errorf("p1sms: %s", r.Status)
		}
		return fmt.Errorf("p1sms %d", status)
	}
	var items []struct {
		Status           string `json:"status"`
		ErrorDescription string `json:"errorDescription"`
		Message          string `json:"message"`
	}
	if json.Unmarshal(r.Data, &items) == nil && len(items) > 0 {
		switch strings.ToLower(items[0].Status) {
		case "error", "rejected", "low_balance", "low_partner_balance":
			msg := items[0].ErrorDescription
			if msg == "" {
				msg = items[0].Message
			}
			if msg == "" {
				msg = items[0].Status
			}
			return fmt.Errorf("p1sms: %s", msg)
		}
	}
	return nil
}

func p1DataMessage(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var obj struct {
		Message string `json:"message"`
		Error   string `json:"error"`
	}
	if json.Unmarshal(raw, &obj) == nil {
		if obj.Message != "" {
			return obj.Message
		}
		return obj.Error
	}
	return ""
}

func truncate(b []byte) string {
	s := strings.TrimSpace(string(b))
	if len(s) > 180 {
		return s[:180]
	}
	return s
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
