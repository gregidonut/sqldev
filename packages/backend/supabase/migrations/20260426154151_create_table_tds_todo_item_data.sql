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
    (auth.jwt() ->> 'role'::TEXT = 'authenticated')
    );

CREATE POLICY tds_todo_item_data_insert_policy
    ON tds_todo_item_data
    AS PERMISSIVE
    FOR INSERT
    TO authenticated
    WITH CHECK (
--     (auth.jwt() ->> 'role'::TEXT = 'authenticated')
    auth.jwt() -> 'user_metadata' ->> 'role'::TEXT = 'admin'
    );
