CREATE TABLE ig_post_attachment_info
(
    post_attachment_id UUID PRIMARY KEY                                       DEFAULT gen_random_uuid(),
    created_at         TIMESTAMPTZ NOT NULL                                   DEFAULT NOW(),
    post_id            UUID        NOT NULL REFERENCES ig_posts (post_id) ON DELETE CASCADE,
    object_id          UUID REFERENCES storage.objects (id) ON DELETE CASCADE
)