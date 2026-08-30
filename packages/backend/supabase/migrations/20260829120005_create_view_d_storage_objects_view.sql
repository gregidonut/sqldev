CREATE OR REPLACE VIEW d_storage_objects_view
AS
SELECT so.storage_object_id
     , u.user_id
     , u.clerk_user_id
     , so.created_at
     , lsd.created_at AS updated_at
     , lsd.s3_object_key
     , lsc.public
FROM public.d_storage_objects AS so
         INNER JOIN LATERAL (
    SELECT sod.created_at, sod.s3_object_key
    FROM public.d_storage_object_data AS sod
    WHERE sod.storage_object_id = so.storage_object_id
    ORDER BY sod.created_at DESC
    LIMIT 1
    ) AS lsd ON TRUE
         INNER JOIN LATERAL (
    SELECT soc.public
    FROM public.d_storage_object_config AS soc
    WHERE soc.storage_object_id = so.storage_object_id
    ORDER BY soc.created_at DESC
    LIMIT 1
    ) AS lsc ON TRUE
         INNER JOIN LATERAL (
    SELECT r.user_id
    FROM public.d_storage_objects_roles AS r
    WHERE r.storage_object_id = so.storage_object_id
      AND r.role = 'owner'
    LIMIT 1
    ) AS owner_role ON TRUE
         INNER JOIN public.users AS u
                    ON u.user_id = owner_role.user_id
WHERE lsc.public = TRUE
   OR public.authorize_d_storage_object(
        (SELECT go.user_id FROM public.get_owner() AS go)
    , 'd_storage_objects.read'
    , so.storage_object_id)
ORDER BY so.created_at DESC;
