DROP TABLE ig_post_text_content;
CREATE TABLE ig_post_text_content
(
    post_content_id UUID PRIMARY KEY                            DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ                        NOT NULL DEFAULT NOW(),
    post_id         UUID REFERENCES ig_posts (post_id) NOT NULL,
    text_content    TEXT
)