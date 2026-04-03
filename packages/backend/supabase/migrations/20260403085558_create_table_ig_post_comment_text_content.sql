CREATE TABLE ig_post_comment_text_content
(
    post_comment_text_content_id UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    post_comment_id              UUID        NOT NULL REFERENCES ig_post_comments (post_comment_id) ON DELETE CASCADE,
    text_content                 TEXT
)
