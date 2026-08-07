CREATE VIEW tds_todos_view AS
SELECT td.todo_space_id
     , td.todo_item_id
     , td.created_at
     , latest.created_at AS updated_at
     , latest.todo_item_parent_id
     , latest.title
     , latest.description
FROM tds_todo_items AS td
         INNER JOIN LATERAL (
    SELECT tdc.created_at, tdc.title, tdc.description, tdc.todo_item_parent_id
    FROM tds_todo_item_data AS tdc
    WHERE td.todo_item_id = tdc.todo_item_id
    ORDER BY tdc.created_at DESC
    LIMIT 1
    ) AS latest ON TRUE
         INNER JOIN LATERAL (
    SELECT tsc.public
    FROM public.tds_todo_space_config AS tsc
    WHERE tsc.todo_space_id = td.todo_space_id
    ORDER BY tsc.created_at DESC
    LIMIT 1
    ) AS lpc ON TRUE
         INNER JOIN LATERAL (
    SELECT r.user_id
    FROM public.tds_todo_spaces_roles AS r
    WHERE r.todo_space_id = td.todo_space_id
      AND r.role = 'owner'
    LIMIT 1
    ) AS owner_role ON TRUE
         INNER JOIN public.users AS u
                    ON u.user_id = owner_role.user_id
WHERE lpc.public = TRUE
   OR public.authorize_tds_todo_space(
        (SELECT go.user_id FROM public.get_owner() AS go)
    , 'tds_todo_spaces.read'
    , td.todo_space_id)
ORDER BY td.created_at DESC;


