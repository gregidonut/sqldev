CREATE OR REPLACE FUNCTION get_todo_node(p_todo_item_id UUID)
    RETURNS JSONB
    LANGUAGE plpgsql
    SET search_path = ''
AS
$$
DECLARE
    v_node     JSONB;
    v_children JSONB;
    v_columns  TEXT;
BEGIN
    SELECT STRING_AGG(
                   QUOTE_IDENT(column_name), ', '
                   ORDER BY ordinal_position
           )
    INTO v_columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tds_todos_view';

    EXECUTE FORMAT(
            'SELECT TO_JSONB(t) FROM (SELECT %s FROM public.tds_todos_view WHERE todo_item_id = %L) t',
            v_columns,
            p_todo_item_id
            ) INTO v_node;

    SELECT CASE
               WHEN COUNT(*) = 0 THEN NULL
               ELSE JSONB_AGG(public.get_todo_node(c.todo_item_id)
                              ORDER BY created_at DESC)
               END
    INTO v_children
    FROM public.tds_todos_view c
    WHERE c.todo_item_parent_id = p_todo_item_id;

    RETURN v_node || JSONB_BUILD_OBJECT('children', v_children);
END;
$$;

CREATE VIEW tds_todos_tree_view AS
SELECT JSONB_AGG(get_todo_node(todo_item_id)
                 ORDER BY created_at DESC)
FROM tds_todos_view
WHERE todo_item_parent_id IS NULL;