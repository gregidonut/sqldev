CREATE TABLE tds_todo_space_data
(
    todo_space_data_id UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    todo_space_id      UUID        NOT NULL,
    name               TEXT        NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()

)