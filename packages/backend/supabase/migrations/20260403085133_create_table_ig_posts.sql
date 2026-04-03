CREATE TABLE ig_posts
(
    post_id    UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id    UUID        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    is_deleted BOOLEAN     NOT NULL DEFAULT FALSE,
    deleted_at TIMESTAMPTZ          DEFAULT NULL

        CHECK ((is_deleted = FALSE) OR (deleted_at IS NOT NULL))
);