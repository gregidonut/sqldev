-- Resolves one storage object for the signed-in viewer. Missing, deleted,
-- and unauthorized objects are the same unavailable result. The source key is
-- for the worker; HTTP responses must not copy it.

CREATE OR REPLACE FUNCTION public.resolve_d_storage_reference(
    p_storage_object_id UUID
)
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
AS
$$
DECLARE
    v_user_id    UUID;
    v_deleted    BOOLEAN;
    v_file_name  TEXT;
    v_source_key TEXT;
    v_revision   UUID;
    v_public     BOOLEAN;
    v_allowed    BOOLEAN;
BEGIN
    IF p_storage_object_id IS NULL THEN
        RETURN jsonb_build_object('kind', 'unavailable');
    END IF;

    SELECT go.user_id
    INTO v_user_id
    FROM public.get_owner() AS go;

    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('kind', 'unavailable');
    END IF;

    SELECT so.is_deleted
    INTO v_deleted
    FROM public.d_storage_objects AS so
    WHERE so.storage_object_id = p_storage_object_id;

    IF NOT FOUND OR v_deleted THEN
        RETURN jsonb_build_object('kind', 'unavailable');
    END IF;

    SELECT d.file_name, d.s3_object_key, d.storage_object_data_id
    INTO v_file_name, v_source_key, v_revision
    FROM public.d_storage_object_data AS d
    WHERE d.storage_object_id = p_storage_object_id
    ORDER BY d.created_at DESC, d.storage_object_data_id DESC
    LIMIT 1;

    IF NOT FOUND OR v_revision IS NULL OR v_source_key IS NULL OR btrim(v_file_name) = '' THEN
        RETURN jsonb_build_object('kind', 'unavailable');
    END IF;

    v_public := public.d_storage_object_is_public(p_storage_object_id);
    IF NOT v_public THEN
        v_allowed := public.authorize_d_storage_object(
                v_user_id,
                'd_storage_objects.read'::public.D_STORAGE_OBJECTS_PERMISSION,
                p_storage_object_id);
        IF NOT v_allowed THEN
            RETURN jsonb_build_object('kind', 'unavailable');
        END IF;
    END IF;

    RETURN jsonb_build_object(
            'kind', 'ready',
            'fileName', v_file_name,
            'revisionId', v_revision,
            'sourceKey', v_source_key);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_d_storage_reference(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_d_storage_reference(UUID) TO authenticated, service_role;
