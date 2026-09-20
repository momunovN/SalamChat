package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type Claims struct {
	DeviceID string `json:"did"`
	jwt.RegisteredClaims
}

func signAccess(secret []byte, userID, deviceID uuid.UUID, ttl time.Duration) (string, time.Time, error) {
	exp := time.Now().Add(ttl)
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, Claims{
		DeviceID: deviceID.String(),
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID.String(),
			ExpiresAt: jwt.NewNumericDate(exp),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "tooapp",
		},
	})
	s, err := t.SignedString(secret)
	return s, exp, err
}

func parseAccess(secret []byte, token string) (uuid.UUID, uuid.UUID, error) {
	parsed, err := jwt.ParseWithClaims(token, &Claims{}, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("alg")
		}
		return secret, nil
	})
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	claims, ok := parsed.Claims.(*Claims)
	if !ok || !parsed.Valid {
		return uuid.Nil, uuid.Nil, fmt.Errorf("claims")
	}
	uid, err := uuid.Parse(claims.Subject)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	did, err := uuid.Parse(claims.DeviceID)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	return uid, did, nil
}

func randomToken() (raw string, hash string, err error) {
	buf := make([]byte, 32)
	if _, err = rand.Read(buf); err != nil {
		return "", "", err
	}
	raw = hex.EncodeToString(buf)
	sum := sha256.Sum256([]byte(raw))
	return raw, hex.EncodeToString(sum[:]), nil
}

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func hmacCode(secret []byte, phone, code string) string {
	sum := sha256.Sum256(append(append(secret, []byte(phone)...), []byte(code)...))
	return hex.EncodeToString(sum[:])
}
