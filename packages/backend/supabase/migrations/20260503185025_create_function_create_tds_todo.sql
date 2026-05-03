CREATE OR REPLACE FUNCTION create_tds_todo(
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
    v_user_id UUID := (SELECT user_id AS v_user_id
                       FROM public.get_owner());
    v_todo_id UUID;
BEGIN
    INSERT INTO public.tds_todo_items (user_id)
    VALUES (v_user_id)
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
