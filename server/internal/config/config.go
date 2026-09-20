package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	HTTPAddr    string
	DatabaseURL string
	JWTSecret   []byte
	OTPDev      bool
	AccessTTL   time.Duration
	RefreshTTL  time.Duration

	S3Endpoint  string
	S3AccessKey string
	S3SecretKey string
	S3Bucket    string
	S3UseSSL    bool
	S3PublicURL string

	LiveKitURL    string
	LiveKitKey    string
	LiveKitSecret string

	SMSProvider string
	SMSAPIKey   string
	SMSSender   string
	SMSLogin    string
}

func Load() Config {
	loadDotEnv()
	return Config{
		HTTPAddr: env("SAMAL_HTTP_ADDR", ":8080"),
		// Neon: paste the DIRECT connection string (host without "-pooler").
		// Dashboard copies it as DATABASE_URL; both names work.
		DatabaseURL: envFirst(
			"postgres://samal:samal@localhost:5432/samal?sslmode=disable",
			"SAMAL_DATABASE_URL",
			"DATABASE_URL",
		),
		JWTSecret: []byte(env("SAMAL_JWT_SECRET", "dev-change-me-32-bytes-minimum-secret")),
		OTPDev:        envBool("SAMAL_OTP_DEV", true),
		AccessTTL:     30 * time.Minute,
		RefreshTTL:    60 * 24 * time.Hour,
		S3Endpoint:    env("SAMAL_S3_ENDPOINT", "localhost:9000"),
		S3AccessKey:   env("SAMAL_S3_ACCESS_KEY", "samal"),
		S3SecretKey:   env("SAMAL_S3_SECRET_KEY", "samalsecret"),
		S3Bucket:      env("SAMAL_S3_BUCKET", "samal"),
		S3UseSSL:      envBool("SAMAL_S3_USE_SSL", false),
		S3PublicURL:   strings.TrimRight(env("SAMAL_S3_PUBLIC_URL", "http://localhost:9000/samal"), "/"),
		LiveKitURL:    env("LIVEKIT_URL", ""),
		LiveKitKey:    env("LIVEKIT_API_KEY", ""),
		LiveKitSecret: env("LIVEKIT_API_SECRET", ""),
		SMSProvider:   env("SMS_PROVIDER", "stub"),
		SMSAPIKey:     env("SMS_API_KEY", ""),
		SMSSender:     env("SMS_SENDER", "SAMAL"),
		SMSLogin:      env("SMS_LOGIN", ""),
	}
}

func loadDotEnv() {
	dir, err := os.Getwd()
	if err != nil {
		return
	}
	for i := 0; i < 6; i++ {
		p := filepath.Join(dir, ".env")
		if _, err := os.Stat(p); err == nil {
			_ = godotenv.Load(p)
			return
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return
		}
		dir = parent
	}
}

func env(key, fallback string) string {
	return envFirst(fallback, key)
}

func envFirst(fallback string, keys ...string) string {
	for _, key := range keys {
		if v := os.Getenv(key); v != "" {
			return v
		}
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return b
}
