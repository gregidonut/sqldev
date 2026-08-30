CREATE OR REPLACE FUNCTION create_d_storage_object(
    p_s3_object_key TEXT,
    p_public BOOLEAN DEFAULT FALSE
)
    RETURNS TABLE
            (
                STORAGE_OBJECT_ID UUID
            )
    LANGUAGE plpgsql
    SET search_path = ''
AS
$$
DECLARE
    v_user_id           UUID := public.set_owner();
    v_storage_object_id UUID;
BEGIN
    INSERT INTO public.d_storage_objects
        DEFAULT
    VALUES
    RETURNING d_storage_objects.storage_object_id
        INTO v_storage_object_id;

    INSERT INTO public.d_storage_objects_roles (storage_object_id, user_id, role)
    VALUES (v_storage_object_id, v_user_id, 'owner');

    INSERT INTO public.d_storage_object_config (storage_object_id, public)
    VALUES (v_storage_object_id, p_public);

    INSERT INTO public.d_storage_object_data (storage_object_id, s3_object_key)
    VALUES (v_storage_object_id, p_s3_object_key);

    RETURN QUERY
        SELECT v_storage_object_id AS storage_object_id;

END;
$$;
