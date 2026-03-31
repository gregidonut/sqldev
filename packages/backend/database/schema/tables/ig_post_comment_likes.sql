DROP TABLE IF EXISTS ig_post_comment_likes;
CREATE TABLE ig_post_comment_likes
(
    post_comment_like_id UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id              UUID        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    post_comment_id      UUID        NOT NULL REFERENCES ig_post_comments (post_comment_id) ON DELETE CASCADE,

    UNIQUE (user_id, post_comment_id)
)