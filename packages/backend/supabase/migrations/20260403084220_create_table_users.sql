CREATE TABLE users
(
    user_id       UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    clerk_user_id TEXT        NOT NULL DEFAULT auth.jwt() ->> 'sub'
);