-- Storage writes go through JWT-checked functions. Direct table writes from
-- the Data API cannot forge an upload abort or grant a storage role.

CREATE OR REPLACE FUNCTION public.d_storage_object_is_public(
    p_storage_object_id UUID
)
    RETURNS BOOLEAN
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
AS
$$
SELECT COALESCE((SELECT c.public
                  FROM public.d_storage_object_config AS c
                  WHERE c.storage_object_id = p_storage_object_id
                  ORDER BY c.created_at DESC
                  LIMIT 1), FALSE);
$$;

REVOKE ALL ON FUNCTION public.d_storage_object_is_public(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.d_storage_object_is_public(UUID) TO authenticated, service_role;

ALTER TABLE public.d_storage_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.d_storage_object_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.d_storage_objects_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.d_storage_objects_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY d_storage_objects_select
    ON public.d_storage_objects
    FOR SELECT
    TO authenticated
    USING (
        (SELECT public.d_storage_object_is_public(d_storage_objects.storage_object_id))
        OR (SELECT public.authorize_d_storage_object(
                (SELECT go.user_id FROM public.get_owner() AS go),
                'd_storage_objects.read',
                d_storage_objects.storage_object_id))
    );

CREATE POLICY d_storage_object_config_select
    ON public.d_storage_object_config
    FOR SELECT
    TO authenticated
    USING (
        (SELECT public.d_storage_object_is_public(d_storage_object_config.storage_object_id))
        OR (SELECT public.authorize_d_storage_object(
                (SELECT go.user_id FROM public.get_owner() AS go),
                'd_storage_objects.read',
                d_storage_object_config.storage_object_id))
    );

CREATE POLICY d_storage_objects_roles_select
    ON public.d_storage_objects_roles
    FOR SELECT
    TO authenticated
    USING (
        user_id = (SELECT go.user_id FROM public.get_owner() AS go)
    );

CREATE POLICY d_storage_objects_permissions_select
    ON public.d_storage_objects_permissions
    FOR SELECT
    TO authenticated
    USING (TRUE);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
    public.d_storage_objects,
    public.d_storage_object_data,
    public.d_storage_object_config,
    public.d_storage_objects_roles,
    public.d_storage_objects_permissions
    FROM anon, authenticated;

REVOKE INSERT, UPDATE, DELETE ON
    public.d_storage_objects_public_view,
    public.d_storage_objects_mine_view,
    public.d_storage_objects_shared_with_me_view
    FROM anon, authenticated;

CREATE INDEX d_storage_object_config_object_created_at_idx
    ON public.d_storage_object_config (storage_object_id, created_at DESC);

CREATE INDEX d_storage_object_data_object_id_idx
    ON public.d_storage_object_data (storage_object_id);

CREATE OR REPLACE FUNCTION public.prepare_d_storage_upload(
    p_file_name TEXT
)
    RETURNS TABLE
            (
                user_id                UUID,
                storage_object_id      UUID,
                storage_object_data_id UUID,
                file_name              TEXT,
                s3_object_key          TEXT,
                is_new_object          BOOLEAN
            )
    LANGUAGE plpgsql
    SECURITY DEFINER
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
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'prepare_d_storage_upload: forbidden';
    END IF;

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
    SECURITY DEFINER
    SET search_path = ''
AS
$$
DECLARE
    v_user_id           UUID := public.set_owner();
    v_storage_object_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'commit_d_storage_upload: forbidden';
    END IF;

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

CREATE OR REPLACE FUNCTION public.abort_d_storage_upload(
    p_storage_object_id UUID,
    p_is_new_object BOOLEAN
)
    RETURNS VOID
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
AS
$$
DECLARE
    v_user_id             UUID := public.set_owner();
    v_is_owner            BOOLEAN;
    v_has_committed_data  BOOLEAN;
BEGIN
    IF v_user_id IS NULL OR p_storage_object_id IS NULL THEN
        RAISE EXCEPTION 'abort_d_storage_upload: forbidden';
    END IF;

    SELECT EXISTS (SELECT 1
                   FROM public.d_storage_objects_roles AS r
                   WHERE r.storage_object_id = p_storage_object_id
                     AND r.user_id = v_user_id
                     AND r.role = 'owner')
    INTO v_is_owner;

    IF NOT v_is_owner THEN
        RAISE EXCEPTION 'abort_d_storage_upload: forbidden';
    END IF;

    -- p_is_new_object is caller-controlled and must not decide deletion.
    SELECT EXISTS (SELECT 1
                   FROM public.d_storage_object_data AS d
                   WHERE d.storage_object_id = p_storage_object_id)
    INTO v_has_committed_data;

    IF v_has_committed_data THEN
        RETURN;
    END IF;

    -- Config has no ON DELETE CASCADE, so the shell row cannot be removed first.
    DELETE
    FROM public.d_storage_object_config
    WHERE storage_object_id = p_storage_object_id;

    DELETE
    FROM public.d_storage_objects
    WHERE storage_object_id = p_storage_object_id;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_d_storage_upload(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.commit_d_storage_upload(UUID, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.abort_d_storage_upload(UUID, BOOLEAN) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.prepare_d_storage_upload(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commit_d_storage_upload(UUID, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.abort_d_storage_upload(UUID, BOOLEAN) TO authenticated, service_role;
