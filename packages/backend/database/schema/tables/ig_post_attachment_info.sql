DROP TABLE IF EXISTS ig_post_attachment_info;
CREATE TABLE ig_post_attachment_info
(
    post_attachment_id UUID PRIMARY KEY                                       DEFAULT gen_random_uuid(),
    created_at         TIMESTAMPTZ NOT NULL                                   DEFAULT NOW(),
    post_id            UUID        NOT NULL REFERENCES ig_posts (post_id) ON DELETE CASCADE,
    bucket_id          TEXT REFERENCES storage.buckets (id) ON DELETE CASCADE DEFAULT 'ig_post_attachments',
    object_id          UUID REFERENCES storage.objects (id) ON DELETE CASCADE
)