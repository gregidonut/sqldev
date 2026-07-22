ALTER TABLE tds_todo_space_data
    ENABLE ROW LEVEL SECURITY;

CREATE
    POLICY tds_todo_space_data_select_policy
    ON tds_todo_space_data
    FOR
    SELECT
    TO authenticated
    USING (
    public.authorize_tds_todo_space(
            (SELECT user_id
             FROM public.get_owner())
        , 'tds_todo_spaces.read'
        , tds_todo_space_data.todo_space_id)
    );

CREATE
    POLICY tds_todo_space_data_insert_policy
    ON tds_todo_space_data
    AS PERMISSIVE
    FOR INSERT
    TO authenticated
    WITH CHECK (
    public.authorize_tds_todo_space(
            (SELECT user_id
             FROM public.get_owner())
        , 'tds_todo_spaces.write'
        , tds_todo_space_data.todo_space_id)
    );
