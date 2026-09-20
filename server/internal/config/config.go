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
		HTTPAddr: envFirst(":8080", "TOOAPP_HTTP_ADDR", "SAMAL_HTTP_ADDR"),
		// Neon: paste the DIRECT connection string (host without "-pooler").
		DatabaseURL: envFirst(
			"postgres://tooapp:tooapp@localhost:5432/tooapp?sslmode=disable",
			"TOOAPP_DATABASE_URL",
			"SAMAL_DATABASE_URL",
			"DATABASE_URL",
		),
		JWTSecret: []byte(envFirst("dev-change-me-32-bytes-minimum-secret", "TOOAPP_JWT_SECRET", "SAMAL_JWT_SECRET")),
		OTPDev:        envBoolFirst(true, "TOOAPP_OTP_DEV", "SAMAL_OTP_DEV"),
		AccessTTL:     30 * time.Minute,
		RefreshTTL:    60 * 24 * time.Hour,
		S3Endpoint:    envFirst("localhost:9000", "TOOAPP_S3_ENDPOINT", "SAMAL_S3_ENDPOINT"),
		S3AccessKey:   envFirst("tooapp", "TOOAPP_S3_ACCESS_KEY", "SAMAL_S3_ACCESS_KEY"),
		S3SecretKey:   envFirst("tooappsecret", "TOOAPP_S3_SECRET_KEY", "SAMAL_S3_SECRET_KEY"),
		S3Bucket:      envFirst("tooapp", "TOOAPP_S3_BUCKET", "SAMAL_S3_BUCKET"),
		S3UseSSL:      envBoolFirst(false, "TOOAPP_S3_USE_SSL", "SAMAL_S3_USE_SSL"),
		S3PublicURL:   strings.TrimRight(envFirst("http://localhost:9000/tooapp", "TOOAPP_S3_PUBLIC_URL", "SAMAL_S3_PUBLIC_URL"), "/"),
		LiveKitURL:    env("LIVEKIT_URL", ""),
		LiveKitKey:    env("LIVEKIT_API_KEY", ""),
		LiveKitSecret: env("LIVEKIT_API_SECRET", ""),
		SMSProvider:   env("SMS_PROVIDER", "stub"),
		SMSAPIKey:     env("SMS_API_KEY", ""),
		SMSSender:     env("SMS_SENDER", "TooApp"),
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
	return envBoolFirst(fallback, key)
}

func envBoolFirst(fallback bool, keys ...string) bool {
	for _, key := range keys {
		v := os.Getenv(key)
		if v == "" {
			continue
		}
		b, err := strconv.ParseBool(v)
		if err != nil {
			return fallback
		}
		return b
	}
	return fallback
}
