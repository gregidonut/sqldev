CREATE TABLE ig_post_comments
(
    post_comment_id UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    post_id         UUID        REFERENCES ig_posts (post_id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id         UUID        NOT NULL REFERENCES users (user_id),
    is_deleted      BOOLEAN     NOT NULL DEFAULT FALSE,
    deleted_at      TIMESTAMPTZ          DEFAULT NULL
        CHECK ((is_deleted = FALSE) OR (deleted_at IS NOT NULL))
);