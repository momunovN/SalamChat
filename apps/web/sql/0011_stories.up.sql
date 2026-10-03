-- Statuses: a photo, video or text card that lives for 24 hours, seen by people one has a direct chat with.
CREATE TABLE IF NOT EXISTS stories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('text', 'photo', 'video')),
    text        TEXT NOT NULL DEFAULT '',
    bg          TEXT NOT NULL DEFAULT '',
    upload_id   UUID REFERENCES uploads(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX IF NOT EXISTS stories_user_created_idx ON stories (user_id, created_at);
CREATE INDEX IF NOT EXISTS stories_expires_idx ON stories (expires_at);
CREATE INDEX IF NOT EXISTS stories_upload_idx ON stories (upload_id);

CREATE TABLE IF NOT EXISTS story_views (
    story_id   UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    viewer_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (story_id, viewer_id)
);
