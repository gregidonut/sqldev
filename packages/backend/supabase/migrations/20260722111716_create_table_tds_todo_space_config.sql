CREATE TABLE tds_todo_space_config
(
    todo_space_config_id UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    todo_space_id        UUID        NOT NULL REFERENCES public.tds_todo_spaces (todo_space_id),
    public               BOOLEAN     NOT NULL DEFAULT FALSE
)
