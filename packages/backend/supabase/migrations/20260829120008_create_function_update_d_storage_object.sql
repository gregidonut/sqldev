CREATE OR REPLACE FUNCTION update_d_storage_object(
    p_storage_object_id UUID,
    p_s3_object_key TEXT
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
    v_storage_object_id UUID;
BEGIN
    INSERT INTO public.d_storage_object_data (storage_object_id, s3_object_key)
    VALUES (p_storage_object_id, p_s3_object_key)
    RETURNING public.d_storage_object_data.storage_object_id INTO v_storage_object_id;

    RETURN QUERY
        SELECT v_storage_object_id AS storage_object_id;

END;
$$;
