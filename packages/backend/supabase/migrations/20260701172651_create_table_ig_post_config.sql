CREATE TABLE ig_post_config
(
    post_config_id UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    post_id        UUID        NOT NULL REFERENCES public.ig_posts (post_id),
    public         BOOLEAN     NOT NULL DEFAULT TRUE
)
