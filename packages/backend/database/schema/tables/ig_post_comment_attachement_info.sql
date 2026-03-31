DROP TABLE IF EXISTS ig_post_comment_attachment_info;
CREATE TABLE ig_post_comment_attachment_info
(
    comment_attachment_id UUID PRIMARY KEY                                       DEFAULT gen_random_uuid(),
    created_at            TIMESTAMPTZ NOT NULL                                   DEFAULT NOW(),
    post_comment_id       UUID        NOT NULL REFERENCES ig_post_comments (post_comment_id) ON DELETE CASCADE,
    bucket_id             TEXT REFERENCES storage.buckets (id) ON DELETE CASCADE DEFAULT 'ig_post_comment_attachments',
    object_id             UUID REFERENCES storage.objects (id) ON DELETE CASCADE
)