ALTER TABLE users ADD COLUMN IF NOT EXISTS contacts_sync BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS contacts (
    owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    phone      TEXT NOT NULL,
    book_name  TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, phone)
);
CREATE INDEX IF NOT EXISTS contacts_phone_idx ON contacts (phone);
CREATE INDEX IF NOT EXISTS contacts_owner_idx ON contacts (owner_id);
