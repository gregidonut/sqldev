-- Reads through d_storage_object_data table on behalf of the caller,
-- exposing only rows the caller may read: public objects, or
-- objects granted through RBAC.
CREATE OR REPLACE FUNCTION public.get_d_storage_object_by_key(
    p_s3_object_key TEXT
)
    RETURNS TABLE
            (
                storage_object_id UUID,
                public            BOOLEAN
            )
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
AS
$$
SELECT b.storage_object_id
     , b.public
FROM public.d_storage_object_data AS sod
         INNER JOIN public.d_storage_objects_base_view AS b
                    ON b.storage_object_id = sod.storage_object_id
WHERE sod.s3_object_key = p_s3_object_key
  AND (b.public = TRUE
    OR public.authorize_d_storage_object(
               (SELECT go.user_id FROM public.get_owner() AS go)
           , 'd_storage_objects.read'
           , b.storage_object_id))
LIMIT 1;
$$;