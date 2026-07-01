CREATE TABLE tds_todo_spaces
(
    todo_space_id UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted    BOOLEAN     NOT NULL DEFAULT FALSE,
    deleted_at    TIMESTAMPTZ          DEFAULT NULL,

    CHECK ((is_deleted = FALSE) OR (deleted_at IS NOT NULL))
)
