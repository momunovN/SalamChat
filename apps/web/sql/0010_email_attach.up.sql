-- Login codes and "attach this email to my account" codes share one table.
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'login';
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS user_id UUID;
CREATE INDEX IF NOT EXISTS otp_attach_user_idx ON otp_challenges (user_id, created_at DESC) WHERE purpose = 'attach';
