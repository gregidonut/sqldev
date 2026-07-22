CREATE OR REPLACE FUNCTION create_tds_todo_space(
    p_name TEXT,
    p_public BOOLEAN DEFAULT FALSE
)
    RETURNS TABLE
            (
                TODO_SPACE_ID UUID
            )
    LANGUAGE plpgsql
    SET search_path = ''
AS
$$
DECLARE
    v_user_id       UUID := public.set_owner();
    v_todo_space_id UUID;
BEGIN
    INSERT INTO public.tds_todo_spaces
        DEFAULT
    VALUES
    RETURNING tds_todo_spaces.todo_space_id INTO v_todo_space_id;

    INSERT INTO public.tds_todo_spaces_roles (todo_space_id, user_id, role)
    VALUES (v_todo_space_id, v_user_id, 'owner');

    INSERT INTO public.tds_todo_space_data (todo_space_id, name)
    VALUES (v_todo_space_id, p_name);

    INSERT INTO public.tds_todo_space_config(todo_space_id)
    VALUES (v_todo_space_id);

    RETURN QUERY
        SELECT v_todo_space_id AS todo_space_id;

END;
$$;