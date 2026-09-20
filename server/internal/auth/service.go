package auth

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"samal.dev/server/internal/config"
	"samal.dev/server/internal/httpx"
	"samal.dev/server/internal/models"
	"samal.dev/server/internal/sms"
)

type Service struct {
	pool *pgxpool.Pool
	cfg  config.Config
	sms  sms.Sender
}

func New(pool *pgxpool.Pool, cfg config.Config, sender sms.Sender) *Service {
	return &Service{pool: pool, cfg: cfg, sms: sender}
}

func (s *Service) RequestOTP(ctx context.Context, phone string) (devCode string, err error) {
	phone, ok := NormalizePhone(phone)
	if !ok {
		return "", fmt.Errorf("%w: invalid phone", httpx.ErrBadRequest)
	}
	var recent int
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM otp_challenges
		WHERE phone=$1 AND created_at > now() - interval '1 minute'`, phone).Scan(&recent); err != nil {
		return "", err
	}
	if recent > 0 {
		return "", fmt.Errorf("%w: too many otp requests", httpx.ErrBadRequest)
	}
	code, err := sixDigits()
	if err != nil {
		return "", err
	}
	hash := hmacCode(s.cfg.JWTSecret, phone, code)
	_, err = s.pool.Exec(ctx, `
		INSERT INTO otp_challenges (phone, code_hash, expires_at)
		VALUES ($1, $2, now() + interval '5 minutes')`, phone, hash)
	if err != nil {
		return "", err
	}
	if err := s.sms.SendOTP(ctx, phone, code); err != nil {
		return "", err
	}
	if s.cfg.OTPDev {
		return code, nil
	}
	return "", nil
}

type DeviceIn struct {
	Platform   string `json:"platform"`
	DeviceName string `json:"device_name"`
	PushToken  string `json:"push_token"`
}

func (s *Service) VerifyOTP(ctx context.Context, phone, code string, dev DeviceIn) (*models.Session, error) {
	phone, ok := NormalizePhone(phone)
	if !ok {
		return nil, fmt.Errorf("%w: invalid phone", httpx.ErrBadRequest)
	}
	if len(code) != 6 {
		return nil, fmt.Errorf("%w: invalid code", httpx.ErrBadRequest)
	}
	if dev.Platform == "" {
		dev.Platform = "ios"
	}

	var chID uuid.UUID
	var hash string
	var attempts int
	var expires time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT id, code_hash, attempts, expires_at
		FROM otp_challenges
		WHERE phone=$1 AND consumed_at IS NULL
		ORDER BY created_at DESC LIMIT 1`, phone).Scan(&chID, &hash, &attempts, &expires)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("%w: no otp", httpx.ErrBadRequest)
	}
	if err != nil {
		return nil, err
	}
	if time.Now().After(expires) {
		return nil, fmt.Errorf("%w: otp expired", httpx.ErrBadRequest)
	}
	if attempts >= 5 {
		return nil, fmt.Errorf("%w: too many attempts", httpx.ErrBadRequest)
	}
	if hmacCode(s.cfg.JWTSecret, phone, code) != hash {
		_, _ = s.pool.Exec(ctx, `UPDATE otp_challenges SET attempts=attempts+1 WHERE id=$1`, chID)
		return nil, fmt.Errorf("%w: wrong code", httpx.ErrBadRequest)
	}

	var user models.User
	err = s.pool.QueryRow(ctx, `SELECT id, phone, display_name, username, avatar_url, bio, created_at, updated_at, last_seen_at FROM users WHERE phone=$1`, phone).
		Scan(&user.ID, &user.Phone, &user.DisplayName, &user.Username, &user.AvatarURL, &user.Bio, &user.CreatedAt, &user.UpdatedAt, &user.LastSeenAt)
	if err == pgx.ErrNoRows {
		user.ID = uuid.New()
		user.Phone = phone
		user.DisplayName = DefaultDisplayName(phone)
		user.Bio = ""
		err = s.pool.QueryRow(ctx, `
			INSERT INTO users (id, phone, display_name) VALUES ($1,$2,$3)
			ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
			RETURNING id, phone, display_name, username, avatar_url, bio, created_at, updated_at, last_seen_at`,
			user.ID, phone, user.DisplayName).
			Scan(&user.ID, &user.Phone, &user.DisplayName, &user.Username, &user.AvatarURL, &user.Bio, &user.CreatedAt, &user.UpdatedAt, &user.LastSeenAt)
	}
	if err != nil {
		return nil, err
	}

	refresh, refreshHash, err := randomToken()
	if err != nil {
		return nil, err
	}
	deviceID := uuid.New()
	_, err = s.pool.Exec(ctx, `
		INSERT INTO devices (id, user_id, platform, device_name, push_token, refresh_token_hash)
		VALUES ($1,$2,$3,$4,NULLIF($5,''),$6)`,
		deviceID, user.ID, dev.Platform, dev.DeviceName, dev.PushToken, refreshHash)
	if err != nil {
		return nil, err
	}
	_, err = s.pool.Exec(ctx, `UPDATE otp_challenges SET consumed_at=now() WHERE id=$1`, chID)
	if err != nil {
		return nil, err
	}

	access, exp, err := signAccess(s.cfg.JWTSecret, user.ID, deviceID, s.cfg.AccessTTL)
	if err != nil {
		return nil, err
	}
	return &models.Session{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresAt:    exp,
		User:         user,
		DeviceID:     deviceID,
	}, nil
}

func (s *Service) Refresh(ctx context.Context, refresh string) (*models.Session, error) {
	if refresh == "" {
		return nil, httpx.ErrUnauthorized
	}
	h := hashToken(refresh)
	var deviceID, userID uuid.UUID
	err := s.pool.QueryRow(ctx, `SELECT id, user_id FROM devices WHERE refresh_token_hash=$1`, h).Scan(&deviceID, &userID)
	if err == pgx.ErrNoRows {
		return nil, httpx.ErrUnauthorized
	}
	if err != nil {
		return nil, err
	}
	raw, newHash, err := randomToken()
	if err != nil {
		return nil, err
	}
	_, err = s.pool.Exec(ctx, `UPDATE devices SET refresh_token_hash=$1, last_seen_at=now() WHERE id=$2`, newHash, deviceID)
	if err != nil {
		return nil, err
	}
	user, err := s.GetUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	access, exp, err := signAccess(s.cfg.JWTSecret, userID, deviceID, s.cfg.AccessTTL)
	if err != nil {
		return nil, err
	}
	return &models.Session{
		AccessToken:  access,
		RefreshToken: raw,
		ExpiresAt:    exp,
		User:         *user,
		DeviceID:     deviceID,
	}, nil
}

func (s *Service) Logout(ctx context.Context, deviceID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `UPDATE devices SET refresh_token_hash='revoked:'||id::text WHERE id=$1`, deviceID)
	return err
}

func (s *Service) Parse(token string) (uuid.UUID, uuid.UUID, error) {
	return parseAccess(s.cfg.JWTSecret, token)
}

func (s *Service) GetUser(ctx context.Context, id uuid.UUID) (*models.User, error) {
	var u models.User
	err := s.pool.QueryRow(ctx, `
		SELECT id, phone, display_name, username, avatar_url, bio, created_at, updated_at, last_seen_at
		FROM users WHERE id=$1`, id).
		Scan(&u.ID, &u.Phone, &u.DisplayName, &u.Username, &u.AvatarURL, &u.Bio, &u.CreatedAt, &u.UpdatedAt, &u.LastSeenAt)
	if err == pgx.ErrNoRows {
		return nil, httpx.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *Service) UpdateMe(ctx context.Context, id uuid.UUID, name *string, username *string, bio *string, avatar *string) (*models.User, error) {
	_, err := s.pool.Exec(ctx, `
		UPDATE users SET
			display_name = COALESCE($2, display_name),
			username = COALESCE($3, username),
			bio = COALESCE($4, bio),
			avatar_url = COALESCE($5, avatar_url),
			updated_at = now()
		WHERE id=$1`, id, name, username, bio, avatar)
	if err != nil {
		return nil, err
	}
	return s.GetUser(ctx, id)
}

func sixDigits() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}
