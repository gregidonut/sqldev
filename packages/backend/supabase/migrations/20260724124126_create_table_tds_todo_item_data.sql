CREATE TABLE tds_todo_item_data
(
    todo_item_content_id UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    todo_item_id         UUID        NOT NULL REFERENCES tds_todo_items (todo_item_id) ON DELETE CASCADE,
    todo_item_parent_id  UUID REFERENCES tds_todo_items (todo_item_id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    title                TEXT        NOT NULL,
    description          TEXT
        CHECK (todo_item_parent_id != todo_item_id)
);

ALTER TABLE tds_todo_item_data
    ENABLE ROW LEVEL SECURITY;

CREATE POLICY tds_todo_item_data_select_policy
    ON tds_todo_item_data
    FOR SELECT
    TO authenticated
    USING (
    public.authorize_tds_todo_space(
            (SELECT user_id
             FROM public.get_owner())
        , 'tds_todo_spaces.read'
        , (SELECT ts.todo_space_id
           FROM public.tds_todo_spaces AS ts
                    INNER JOIN public.tds_todo_items AS ti
                               ON ts.todo_space_id = ti.todo_space_id
           WHERE ti.todo_item_id = tds_todo_item_data.todo_item_id
           LIMIT 1))
    );

CREATE POLICY tds_todo_item_data_insert_policy
    ON tds_todo_item_data
    AS PERMISSIVE
    FOR INSERT
    TO authenticated
    WITH CHECK (
    public.authorize_tds_todo_space(
            (SELECT user_id
             FROM public.get_owner())
        , 'tds_todo_spaces.write'
        , (SELECT ts.todo_space_id
           FROM public.tds_todo_spaces AS ts
                    INNER JOIN public.tds_todo_items AS ti
                               ON ts.todo_space_id = ti.todo_space_id
           WHERE ti.todo_item_id = tds_todo_item_data.todo_item_id
           LIMIT 1))
    );
