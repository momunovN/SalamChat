ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS email TEXT;
CREATE INDEX IF NOT EXISTS otp_email_created_idx ON otp_challenges (lower(email), created_at DESC);
