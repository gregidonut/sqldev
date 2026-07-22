CREATE OR REPLACE FUNCTION update_tds_todo_space(
    p_todo_space_id UUID,
    p_name TEXT
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
    v_todo_space_id UUID;
BEGIN
    INSERT INTO public.tds_todo_space_data (todo_space_id, name)
    VALUES (p_todo_space_id, p_name)
    RETURNING public.tds_todo_space_data.todo_space_id INTO v_todo_space_id;

    RETURN QUERY
        SELECT v_todo_space_id AS todo_space_id;

END;
$$;
