CREATE TABLE ig_hashtags
(
    hashtag_id   UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    hashtag_name VARCHAR(24) NOT NULL UNIQUE,
    created_by   UUID        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,

    UNIQUE (hashtag_name, created_by)
)