DROP TABLE IF EXISTS user_status;
CREATE TABLE user_status
(
    user_status_id UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id        UUID        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    status         STATUS      NOT NULL
);