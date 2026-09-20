CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone           TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL DEFAULT '',
    username        TEXT UNIQUE,
    avatar_url      TEXT,
    bio             TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS devices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform            TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
    device_name         TEXT NOT NULL DEFAULT '',
    push_token          TEXT,
    refresh_token_hash  TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS devices_user_id_idx ON devices (user_id);

CREATE TABLE IF NOT EXISTS otp_challenges (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone        TEXT NOT NULL,
    code_hash    TEXT NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    attempts     INT NOT NULL DEFAULT 0,
    consumed_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_phone_created_idx ON otp_challenges (phone, created_at DESC);

CREATE TABLE IF NOT EXISTS chats (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type         TEXT NOT NULL CHECK (type IN ('direct', 'group')),
    title        TEXT,
    avatar_url   TEXT,
    created_by   UUID REFERENCES users(id),
    peer_key     TEXT UNIQUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_message_id UUID
);
CREATE INDEX IF NOT EXISTS chats_updated_at_idx ON chats (updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_members (
    chat_id               UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role                  TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    joined_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    muted_until           TIMESTAMPTZ,
    last_read_at          TIMESTAMPTZ,
    last_read_message_id  UUID,
    PRIMARY KEY (chat_id, user_id)
);
CREATE INDEX IF NOT EXISTS chat_members_user_id_idx ON chat_members (user_id);

CREATE TABLE IF NOT EXISTS messages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id      UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    author_id    UUID REFERENCES users(id),
    type         TEXT NOT NULL CHECK (type IN ('text', 'photo', 'file', 'voice', 'system', 'location')),
    payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
    client_id    TEXT NOT NULL,
    reply_to_id  UUID REFERENCES messages(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at    TIMESTAMPTZ,
    deleted_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_client_id_uidx ON messages (client_id);
CREATE INDEX IF NOT EXISTS messages_chat_created_idx ON messages (chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_text_trgm_idx ON messages USING gin ((payload->>'text') gin_trgm_ops);

CREATE TABLE IF NOT EXISTS attachments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id   UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('photo', 'video', 'file', 'voice', 'location')),
    object_key   TEXT NOT NULL,
    mime         TEXT NOT NULL DEFAULT '',
    size_bytes   BIGINT NOT NULL DEFAULT 0,
    width        INT,
    height       INT,
    duration_ms  INT,
    waveform     JSONB,
    filename     TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attachments_message_id_idx ON attachments (message_id);

CREATE TABLE IF NOT EXISTS receipts (
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      TEXT NOT NULL CHECK (status IN ('delivered', 'read')),
    at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS receipts_user_status_idx ON receipts (user_id, status);

CREATE TABLE IF NOT EXISTS uploads (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    object_key    TEXT NOT NULL UNIQUE,
    mime          TEXT NOT NULL,
    size_bytes    BIGINT NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('photo', 'video', 'file', 'voice')),
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS uploads_user_id_idx ON uploads (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS calls (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id       UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    initiator_id  UUID NOT NULL REFERENCES users(id),
    kind          TEXT NOT NULL CHECK (kind IN ('audio', 'video')),
    status        TEXT NOT NULL CHECK (status IN ('ringing', 'active', 'ended', 'missed', 'declined')),
    sfu_room      TEXT,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    answered_at   TIMESTAMPTZ,
    ended_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS calls_chat_started_idx ON calls (chat_id, started_at DESC);
CREATE INDEX IF NOT EXISTS calls_status_idx ON calls (status) WHERE status IN ('ringing', 'active');

CREATE TABLE IF NOT EXISTS call_events (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id   UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    user_id   UUID REFERENCES users(id),
    event     TEXT NOT NULL CHECK (event IN ('invite', 'join', 'leave', 'reject', 'end', 'offer', 'answer')),
    payload   JSONB NOT NULL DEFAULT '{}'::jsonb,
    at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS call_events_call_id_idx ON call_events (call_id, at);

DO $$
BEGIN
    ALTER TABLE chats
        ADD CONSTRAINT chats_last_message_fk
        FOREIGN KEY (last_message_id) REFERENCES messages(id) ON DELETE SET NULL;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

CREATE OR REPLACE FUNCTION touch_chat_updated_at() RETURNS trigger AS $$
BEGIN
    UPDATE chats SET updated_at = NEW.created_at, last_message_id = NEW.id WHERE id = NEW.chat_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS messages_touch_chat ON messages;
CREATE TRIGGER messages_touch_chat
    AFTER INSERT ON messages
    FOR EACH ROW EXECUTE FUNCTION touch_chat_updated_at();
