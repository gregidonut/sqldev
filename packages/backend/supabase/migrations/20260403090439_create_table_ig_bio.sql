CREATE TABLE ig_bio
(
    bio_id     UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id    UUID        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    content    TEXT
);