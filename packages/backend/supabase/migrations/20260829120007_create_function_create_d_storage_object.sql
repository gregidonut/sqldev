CREATE OR REPLACE FUNCTION public.prepare_d_storage_upload(
    p_file_name TEXT
)
    RETURNS TABLE
            (
                user_id                 UUID,
                storage_object_id       UUID,
                storage_object_data_id  UUID,
                file_name               TEXT,
                s3_object_key           TEXT,
                is_new_object           BOOLEAN
            )
    LANGUAGE plpgsql
    SET search_path = ''
AS
$$
DECLARE
    v_user_id                UUID := public.set_owner();
    v_storage_object_id      UUID;
    v_storage_object_data_id UUID := gen_random_uuid();
    v_is_new_object          BOOLEAN := FALSE;
    v_existing_object_id     UUID;
BEGIN
    IF p_file_name IS NULL OR btrim(p_file_name) = '' THEN
        RAISE EXCEPTION 'prepare_d_storage_upload: file_name is required';
    END IF;

    SELECT v.storage_object_id
    INTO v_existing_object_id
    FROM public.d_storage_objects_mine_view AS v
    WHERE v.user_id = v_user_id
      AND v.file_name = p_file_name
    LIMIT 1;

    IF v_existing_object_id IS NOT NULL THEN
        IF NOT public.authorize_d_storage_object(
                v_user_id,
                'd_storage_objects.write'::public.D_STORAGE_OBJECTS_PERMISSION,
                v_existing_object_id) THEN
            RAISE EXCEPTION 'prepare_d_storage_upload: forbidden';
        END IF;

        v_storage_object_id := v_existing_object_id;
        v_is_new_object := FALSE;
    ELSE
        INSERT INTO public.d_storage_objects
            DEFAULT
        VALUES
        RETURNING d_storage_objects.storage_object_id INTO v_storage_object_id;

        INSERT INTO public.d_storage_objects_roles (storage_object_id, user_id, role)
        VALUES (v_storage_object_id, v_user_id, 'owner');

        INSERT INTO public.d_storage_object_config (storage_object_id, public)
        VALUES (v_storage_object_id, FALSE);

        v_is_new_object := TRUE;
    END IF;

    RETURN QUERY
        SELECT v_user_id,
               v_storage_object_id,
               v_storage_object_data_id,
               p_file_name,
               public.build_d_storage_object_s3_key(
                       v_user_id,
                       v_storage_object_id,
                       v_storage_object_data_id,
                       p_file_name
               ),
               v_is_new_object;
END;
$$;

CREATE OR REPLACE FUNCTION public.abort_d_storage_upload(
    p_storage_object_id UUID,
    p_is_new_object BOOLEAN
)
    RETURNS VOID
    LANGUAGE plpgsql
    SET search_path = ''
AS
$$
BEGIN
    IF p_is_new_object THEN
        DELETE
        FROM public.d_storage_objects
        WHERE storage_object_id = p_storage_object_id;
    END IF;
END;
$$;
