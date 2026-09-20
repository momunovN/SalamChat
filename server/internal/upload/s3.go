package upload

import (
	"context"
	"fmt"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"samal.dev/server/internal/config"
	"samal.dev/server/internal/httpx"
)

type Store struct {
	pool   *pgxpool.Pool
	client *minio.Client
	bucket string
	pub    string
}

func New(ctx context.Context, pool *pgxpool.Pool, cfg config.Config) (*Store, error) {
	c, err := minio.New(cfg.S3Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.S3AccessKey, cfg.S3SecretKey, ""),
		Secure: cfg.S3UseSSL,
	})
	if err != nil {
		return nil, err
	}
	exists, err := c.BucketExists(ctx, cfg.S3Bucket)
	if err == nil && !exists {
		_ = c.MakeBucket(ctx, cfg.S3Bucket, minio.MakeBucketOptions{})
	}
	return &Store{pool: pool, client: c, bucket: cfg.S3Bucket, pub: cfg.S3PublicURL}, nil
}

type Intent struct {
	ID        uuid.UUID         `json:"id"`
	PutURL    string            `json:"put_url"`
	ObjectKey string            `json:"object_key"`
	Headers   map[string]string `json:"headers"`
}

func (s *Store) Intent(ctx context.Context, userID uuid.UUID, mime, kind string, size int64) (*Intent, error) {
	switch kind {
	case "photo", "video", "file", "voice":
	default:
		return nil, fmt.Errorf("%w: bad kind", httpx.ErrBadRequest)
	}
	if size <= 0 || size > 100<<20 {
		return nil, fmt.Errorf("%w: size", httpx.ErrBadRequest)
	}
	if mime == "" {
		mime = "application/octet-stream"
	}
	id := uuid.New()
	ext := extFromMime(mime)
	now := time.Now().UTC()
	key := fmt.Sprintf("u/%s/%04d/%02d/%s%s", userID.String(), now.Year(), int(now.Month()), id.String(), ext)
	_, err := s.pool.Exec(ctx, `
		INSERT INTO uploads (id, user_id, object_key, mime, size_bytes, kind)
		VALUES ($1,$2,$3,$4,$5,$6)`, id, userID, key, mime, size, kind)
	if err != nil {
		return nil, err
	}
	u, err := s.client.PresignedPutObject(ctx, s.bucket, key, 15*time.Minute)
	if err != nil {
		return nil, err
	}
	return &Intent{
		ID:        id,
		PutURL:    u.String(),
		ObjectKey: key,
		Headers:   map[string]string{"Content-Type": mime},
	}, nil
}

func (s *Store) Complete(ctx context.Context, userID, uploadID uuid.UUID) (string, error) {
	var key, status string
	err := s.pool.QueryRow(ctx, `SELECT object_key, status FROM uploads WHERE id=$1 AND user_id=$2`, uploadID, userID).Scan(&key, &status)
	if err != nil {
		return "", httpx.ErrNotFound
	}
	_, err = s.client.StatObject(ctx, s.bucket, key, minio.StatObjectOptions{})
	if err != nil {
		_, _ = s.pool.Exec(ctx, `UPDATE uploads SET status='failed' WHERE id=$1`, uploadID)
		return "", fmt.Errorf("%w: object missing", httpx.ErrBadRequest)
	}
	_, err = s.pool.Exec(ctx, `UPDATE uploads SET status='ready', completed_at=now() WHERE id=$1`, uploadID)
	if err != nil {
		return "", err
	}
	return strings.TrimRight(s.pub, "/") + "/" + key, nil
}

func (s *Store) PublicURL(key string) string {
	return strings.TrimRight(s.pub, "/") + "/" + key
}

func extFromMime(mime string) string {
	switch mime {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/heic":
		return ".heic"
	case "audio/m4a", "audio/mp4", "audio/aac":
		return ".m4a"
	case "audio/ogg":
		return ".ogg"
	case "video/mp4":
		return ".mp4"
	default:
		u := mime
		if i := strings.LastIndex(u, "/"); i >= 0 {
			return "." + path.Ext("x." + u[i+1:])[1:]
		}
		if _, err := url.Parse(mime); err != nil {
			return ""
		}
		return ""
	}
}
