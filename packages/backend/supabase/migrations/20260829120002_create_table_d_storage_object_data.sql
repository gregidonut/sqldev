CREATE TABLE d_storage_object_data
(
    storage_object_data_id UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    storage_object_id      UUID        NOT NULL REFERENCES public.d_storage_objects (storage_object_id),
    file_name              TEXT        NOT NULL,
    s3_object_key          TEXT        NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.build_d_storage_object_s3_key(
    p_user_id UUID,
    p_storage_object_id UUID,
    p_storage_object_data_id UUID,
    p_file_name TEXT
)
    RETURNS TEXT
    LANGUAGE plpgsql
    IMMUTABLE
    SET search_path = ''
AS
$$
BEGIN
    IF p_file_name IS NULL OR btrim(p_file_name) = '' THEN
        RAISE EXCEPTION 'build_d_storage_object_s3_key: file_name is required';
    END IF;

    RETURN p_user_id::TEXT || '/' ||
           p_storage_object_id::TEXT || '/' ||
           p_storage_object_data_id::TEXT || '/' ||
           p_file_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_d_storage_object_data_s3_key()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SET search_path = ''
AS
$$
DECLARE
    v_user_id UUID;
BEGIN
    SELECT r.user_id
    INTO v_user_id
    FROM public.d_storage_objects_roles AS r
    WHERE r.storage_object_id = NEW.storage_object_id
      AND r.role = 'owner'::public.D_STORAGE_OBJECTS_ROLE
    LIMIT 1;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'set_d_storage_object_data_s3_key: owner not found for storage_object_id %', NEW.storage_object_id;
    END IF;

    NEW.s3_object_key := public.build_d_storage_object_s3_key(
            v_user_id,
            NEW.storage_object_id,
            NEW.storage_object_data_id,
            NEW.file_name
                          );

    RETURN NEW;
END;
$$;

CREATE TRIGGER d_storage_object_data_set_s3_key_trigger
    BEFORE INSERT
    ON public.d_storage_object_data
    FOR EACH ROW
EXECUTE FUNCTION public.set_d_storage_object_data_s3_key();
