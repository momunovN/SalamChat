CREATE TABLE IF NOT EXISTS upload_chunks (
    upload_id UUID NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    idx       INT NOT NULL,
    body      BYTEA NOT NULL,
    PRIMARY KEY (upload_id, idx)
);
