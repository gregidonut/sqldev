CREATE TABLE ig_post_likes
(
    post_like_id UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id      UUID        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    post_id      UUID        NOT NULL REFERENCES ig_posts (post_id) ON DELETE CASCADE,

    UNIQUE (user_id, post_id)
)