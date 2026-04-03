CREATE TABLE ig_followers
(
    hashtag_id UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id    UUID        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    leader_id  UUID        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    UNIQUE (user_id, leader_id),
    CHECK (leader_id != user_id)
)