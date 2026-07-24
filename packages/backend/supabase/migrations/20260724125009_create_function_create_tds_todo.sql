CREATE OR REPLACE FUNCTION create_tds_todo(
    p_todo_space_id UUID,
    p_title TEXT,
    p_description TEXT
)
    RETURNS TABLE
            (
                TODO_ID UUID
            )
    LANGUAGE plpgsql
    SET search_path = ''
AS
$$
DECLARE
    v_todo_id UUID;
BEGIN
    INSERT INTO public.tds_todo_items (todo_space_id)
    VALUES (p_todo_space_id)
    RETURNING tds_todo_items.todo_item_id INTO v_todo_id;


    INSERT INTO public.tds_todo_item_data( todo_item_id
                                         , title
                                         , description)
    VALUES ( v_todo_id
           , p_title
           , p_description);

    RETURN QUERY
        SELECT v_todo_id AS todo_id;
END;
$$;
