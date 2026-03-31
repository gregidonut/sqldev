DROP TABLE IF EXISTS ig_user_post_hashtag;
CREATE TABLE ig_user_post_hashtag
(
    user_hashtag_id UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    hashtag_id      UUID        NOT NULL REFERENCES ig_hashtags (hashtag_id) ON DELETE CASCADE,
    post_id         UUID        NOT NULL REFERENCES ig_posts (post_id) ON DELETE CASCADE,
    post_comment_id UUID REFERENCES ig_post_comments (post_comment_id) ON DELETE CASCADE,

    UNIQUE (hashtag_id, post_id, post_comment_id)
)