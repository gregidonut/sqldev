CREATE OR REPLACE FUNCTION public.commit_d_storage_upload(
    p_storage_object_id UUID,
    p_storage_object_data_id UUID,
    p_file_name TEXT
)
    RETURNS TABLE
            (
                storage_object_id UUID
            )
    LANGUAGE plpgsql
    SET search_path = ''
AS
$$
DECLARE
    v_user_id           UUID := public.set_owner();
    v_storage_object_id UUID;
BEGIN
    IF NOT public.authorize_d_storage_object(
            v_user_id,
            'd_storage_objects.write'::public.D_STORAGE_OBJECTS_PERMISSION,
            p_storage_object_id) THEN
        RAISE EXCEPTION 'commit_d_storage_upload: forbidden';
    END IF;

    INSERT INTO public.d_storage_object_data (
        storage_object_data_id,
        storage_object_id,
        file_name
    )
    VALUES (
        p_storage_object_data_id,
        p_storage_object_id,
        p_file_name
    )
    RETURNING public.d_storage_object_data.storage_object_id INTO v_storage_object_id;

    RETURN QUERY
        SELECT v_storage_object_id;
END;
$$;
