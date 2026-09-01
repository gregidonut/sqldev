CREATE TYPE D_STORAGE_OBJECTS_TAB AS ENUM ('public', 'mine', 'shared_with_me');

CREATE OR REPLACE FUNCTION public.get_d_storage_objects(
    p_tab D_STORAGE_OBJECTS_TAB
)
    RETURNS TABLE
            (
                storage_object_id UUID,
                user_id           UUID,
                clerk_user_id     TEXT,
                created_at        TIMESTAMPTZ,
                updated_at        TIMESTAMPTZ,
                s3_object_key     TEXT,
                file_name         TEXT,
                public            BOOLEAN
            )
    LANGUAGE plpgsql
    STABLE
    SET search_path = ''
AS
$$
BEGIN
    IF p_tab = 'public' THEN
        RETURN QUERY
            SELECT v.storage_object_id
                 , v.user_id
                 , v.clerk_user_id
                 , v.created_at
                 , v.updated_at
                 , v.s3_object_key
                 , v.file_name
                 , v.public
            FROM public.d_storage_objects_public_view AS v;
    ELSIF p_tab = 'mine' THEN
        RETURN QUERY
            SELECT v.storage_object_id
                 , v.user_id
                 , v.clerk_user_id
                 , v.created_at
                 , v.updated_at
                 , v.s3_object_key
                 , v.file_name
                 , v.public
            FROM public.d_storage_objects_mine_view AS v;
    ELSIF p_tab = 'shared_with_me' THEN
        RETURN QUERY
            SELECT v.storage_object_id
                 , v.user_id
                 , v.clerk_user_id
                 , v.created_at
                 , v.updated_at
                 , v.s3_object_key
                 , v.file_name
                 , v.public
            FROM public.d_storage_objects_shared_with_me_view AS v;
    ELSE
        RAISE EXCEPTION 'get_d_storage_objects: unsupported tab %', p_tab;
    END IF;
END;
$$;
