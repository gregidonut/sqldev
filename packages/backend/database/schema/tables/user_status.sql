CREATE TABLE user_status
(
    user_status_id UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id        UUID        NOT NULL REFERENCES users (user_id),
    status         STATUS      NOT NULL
);