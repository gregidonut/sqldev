CREATE OR REPLACE FUNCTION move_tds_todo_items(
    p_todo_item_ids UUID[],
    p_new_parent_id UUID
)
    RETURNS TABLE
            (
                TODO_ITEM_ID UUID
            )
    LANGUAGE plpgsql
    SET search_path = ''
AS
$$
DECLARE
    v_valid_item_count INT;
    v_input_count      INT;
BEGIN
    v_input_count := CARDINALITY(p_todo_item_ids);

    IF v_input_count = 0 THEN
        RAISE EXCEPTION 'p_todo_item_ids must contain at least one item';
    END IF;

    SELECT COUNT(DISTINCT ttv.todo_item_id)
    INTO v_valid_item_count
    FROM public.tds_todos_view AS ttv
    WHERE ttv.todo_item_id = ANY (p_todo_item_ids);

    IF v_valid_item_count != v_input_count THEN
        RAISE EXCEPTION 'One or more todo_item_ids in p_todo_item_ids are invalid';
    END IF;

    IF p_new_parent_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1
                       FROM public.tds_todos_view AS ttv
                       WHERE ttv.todo_item_id = p_new_parent_id) THEN
            RAISE EXCEPTION 'p_new_parent_id is not a valid todo_item_id';
        END IF;

        IF EXISTS (SELECT 1
                   FROM UNNEST(p_todo_item_ids) AS ids(id)
                   WHERE ids.id = p_new_parent_id) THEN
            RAISE EXCEPTION 'p_new_parent_id cannot be one of the items being moved';
        END IF;
    END IF;

    RETURN QUERY
        INSERT INTO public.tds_todo_item_data (todo_item_id, todo_item_parent_id, title, description)
            SELECT ttv.todo_item_id
                 , p_new_parent_id
                 , ttv.title
                 , ttv.description
            FROM public.tds_todos_view AS ttv
            WHERE ttv.todo_item_id = ANY (p_todo_item_ids)
            RETURNING public.tds_todo_item_data.todo_item_id;
END;
$$;