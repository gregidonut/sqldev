CREATE OR REPLACE VIEW tds_todo_spaces_view
AS
SELECT ts.todo_space_id
     , u.user_id
     , u.clerk_user_id
     , ts.created_at
     , ltc.created_at AS updated_at
     , ltc.name
     , lpc.public
FROM public.tds_todo_spaces AS ts
         INNER JOIN LATERAL (
    SELECT tsd.created_at, tsd.name
    FROM public.tds_todo_space_data AS tsd
    WHERE tsd.todo_space_id = ts.todo_space_id
    ORDER BY tsd.created_at DESC
    LIMIT 1
    ) AS ltc ON TRUE
         INNER JOIN LATERAL (
    SELECT tsc.public
    FROM public.tds_todo_space_config AS tsc
    WHERE tsc.todo_space_id = ts.todo_space_id
    ORDER BY tsc.created_at DESC
    LIMIT 1
    ) AS lpc ON TRUE
         INNER JOIN LATERAL (
    SELECT r.user_id
    FROM public.tds_todo_spaces_roles AS r
    WHERE r.todo_space_id = ts.todo_space_id
      AND r.role = 'owner'
    LIMIT 1
    ) AS owner_role ON TRUE
         INNER JOIN public.users AS u
                    ON u.user_id = owner_role.user_id
WHERE lpc.public = TRUE
   OR public.authorize_tds_todo_space(public.set_owner(), 'tds_todo_spaces.read', ts.todo_space_id)
ORDER BY ts.created_at DESC;
