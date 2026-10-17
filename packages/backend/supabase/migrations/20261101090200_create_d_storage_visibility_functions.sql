-- Owner-only visibility changes for storage objects.
--
-- Domain outcomes (forbidden, stale_revision, expired_challenge, ...) are
-- RETURNED as tagged jsonb, never RAISEd: a RAISE rolls back the whole job
-- transaction, which would also undo the active -> expired transition that must
-- commit. Only programming errors (NULL arguments, unregistered operation)
-- raise.
--
-- Lock order is fixed everywhere: the d_storage_objects parent row first, then
-- the challenge row. FOR NO KEY UPDATE does not conflict with the FOR KEY SHARE
-- that upload inserts take through their foreign key, so uploads are not
-- blocked while a visibility change is being decided.
--
-- Authorization is an exact role = 'owner' row. d_storage_objects.write is NOT
-- used: editors hold it and must not be able to change visibility.

CREATE FUNCTION public.d_storage_visibility_guard(
    p_actor_user_id UUID,
    p_storage_object_id UUID,
    p_expected_revision BIGINT,
    p_required_public BOOLEAN
)
    RETURNS TABLE
            (
                outcome          TEXT,
                current_revision BIGINT
            )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
AS
$$
DECLARE
    v_rev BIGINT;
    v_pub BOOLEAN;
BEGIN
    IF p_actor_user_id IS NULL THEN
        RETURN QUERY SELECT 'forbidden'::TEXT, NULL::BIGINT;
        RETURN;
    END IF;

    PERFORM 1
    FROM public.d_storage_objects AS so
    WHERE so.storage_object_id = p_storage_object_id
        FOR NO KEY UPDATE;

    -- A missing object and an object the actor cannot see are indistinguishable.
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'forbidden'::TEXT, NULL::BIGINT;
        RETURN;
    END IF;

    IF NOT EXISTS (SELECT 1
                   FROM public.d_storage_objects_roles AS r
                   WHERE r.storage_object_id = p_storage_object_id
                     AND r.user_id = p_actor_user_id
                     AND r.role = 'owner') THEN
        RETURN QUERY SELECT 'forbidden'::TEXT, NULL::BIGINT;
        RETURN;
    END IF;

    -- Read only after the lock, so a writer that waited sees the committed row.
    SELECT cc.config_version, cc.public
    INTO v_rev, v_pub
    FROM public.d_storage_object_current_config(p_storage_object_id) AS cc;

    IF v_rev IS DISTINCT FROM p_expected_revision OR v_pub IS DISTINCT FROM p_required_public THEN
        RETURN QUERY SELECT 'stale_revision'::TEXT, v_rev;
        RETURN;
    END IF;

    RETURN QUERY SELECT 'ok'::TEXT, v_rev;
END;
$$;

CREATE FUNCTION public.d_storage_visibility_rejected(
    p_reason TEXT
)
    RETURNS JSONB
    LANGUAGE sql
    IMMUTABLE
    SET search_path = ''
AS
$$
SELECT jsonb_build_object('kind', 'rejected', 'reason', p_reason);
$$;

CREATE FUNCTION public.d_storage_visibility_changed(
    p_storage_object_id UUID,
    p_public BOOLEAN,
    p_revision BIGINT
)
    RETURNS JSONB
    LANGUAGE sql
    IMMUTABLE
    SET search_path = ''
AS
$$
SELECT jsonb_build_object(
               'kind', 'visibility_changed',
               'target', jsonb_build_object('type', 'storage_object', 'id', p_storage_object_id),
               'visibility', CASE WHEN p_public THEN 'public' ELSE 'private' END,
               'revision', p_revision);
$$;

-- Job 1 of make-public: validate, issue a five-minute challenge, return it together
-- with the registry identity and the authoritative dialog copy. Appends no config
-- row. The job finishes immediately; nothing waits.
--
-- After the replay defense and the guard (which holds the d_storage_objects
-- parent-row lock and has proven owner, private and revision), the label is read
-- from committed data, the challenge is issued, and the copy is resolved from that
-- same registry row. A guard failure returns before any registry or label read, so
-- an unauthorized caller learns nothing about the copy. Any RAISE after issuance
-- aborts the whole RPC transaction, which rolls back the supersession and the new
-- challenge: no confirmation_required is returned and no config row is appended.
CREATE FUNCTION public.begin_d_storage_make_public(
    p_storage_object_id UUID,
    p_expected_revision BIGINT,
    p_request_id UUID
)
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
AS
$$
DECLARE
    v_actor     UUID;
    v_outcome   TEXT;
    v_existing  public.app_confirmation_challenges%ROWTYPE;
    v_challenge RECORD;
    v_label     TEXT;
    v_copy      JSONB;
BEGIN
    IF p_storage_object_id IS NULL OR p_expected_revision IS NULL OR p_request_id IS NULL THEN
        RAISE EXCEPTION 'begin_d_storage_make_public: arguments are required';
    END IF;

    SELECT go.user_id INTO v_actor FROM public.get_owner() AS go;

    -- Defense in depth only: the job layer already collapses a repeated key to
    -- one workflow. The proof is never stored, so a replayed initiation cannot
    -- be answered with the same challenge; it must not issue a second one.
    SELECT *
    INTO v_existing
    FROM public.app_confirmation_challenges AS c
    WHERE c.initiation_request_id = p_request_id
      AND c.actor_user_id IS NOT DISTINCT FROM v_actor;

    IF FOUND THEN
        RETURN public.d_storage_visibility_rejected(CASE v_existing.state
                                                        WHEN 'consumed' THEN 'consumed_challenge'
                                                        WHEN 'superseded' THEN 'superseded_challenge'
                                                        ELSE 'expired_challenge' END);
    END IF;

    SELECT g.outcome
    INTO v_outcome
    FROM public.d_storage_visibility_guard(v_actor, p_storage_object_id, p_expected_revision, FALSE) AS g;

    IF v_outcome <> 'ok' THEN
        RETURN public.d_storage_visibility_rejected(v_outcome);
    END IF;

    -- Newest committed name. The views order by created_at alone; the tiebreaker
    -- makes two rows with an equal transaction timestamp deterministic. No data
    -- row (an upload that never committed) leaves the label NULL, which the
    -- resolver rejects.
    SELECT sod.file_name
    INTO v_label
    FROM public.d_storage_object_data AS sod
    WHERE sod.storage_object_id = p_storage_object_id
    ORDER BY sod.created_at DESC, sod.storage_object_data_id DESC
    LIMIT 1;

    SELECT *
    INTO v_challenge
    FROM public.app_confirmation_issue(v_actor, 'storage.visibility.make_public', p_storage_object_id,
                                       p_expected_revision, p_request_id);

    v_copy := public.app_confirmation_resolve_dialog_copy(v_challenge.dialog_title_template,
                                                          v_challenge.dialog_description,
                                                          v_challenge.dialog_confirm_label,
                                                          v_label);

    RETURN jsonb_build_object(
            'kind', 'confirmation_required',
            'registryId', v_challenge.registry_id::TEXT,
            'operationKind', 'storage.visibility.make_public',
            'target', jsonb_build_object('type', 'storage_object', 'id', p_storage_object_id),
            'expectedRevision', p_expected_revision,
            'challengeId', v_challenge.challenge_id,
            'proof', v_challenge.proof,
            'expiresAt', to_char(v_challenge.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'dialogCopy', v_copy);
END;
$$;

-- Making an object private only reduces exposure, so it needs no confirmation.
CREATE FUNCTION public.make_d_storage_object_private(
    p_storage_object_id UUID,
    p_expected_revision BIGINT,
    p_request_id UUID
)
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
AS
$$
DECLARE
    v_actor   UUID;
    v_outcome TEXT;
    v_rev     BIGINT;
BEGIN
    IF p_storage_object_id IS NULL OR p_expected_revision IS NULL OR p_request_id IS NULL THEN
        RAISE EXCEPTION 'make_d_storage_object_private: arguments are required';
    END IF;

    SELECT go.user_id INTO v_actor FROM public.get_owner() AS go;

    SELECT g.outcome, g.current_revision
    INTO v_outcome, v_rev
    FROM public.d_storage_visibility_guard(v_actor, p_storage_object_id, p_expected_revision, TRUE) AS g;

    IF v_outcome <> 'ok' THEN
        RETURN public.d_storage_visibility_rejected(v_outcome);
    END IF;

    INSERT INTO public.d_storage_object_config (storage_object_id, public, config_version)
    VALUES (p_storage_object_id, FALSE, v_rev + 1);

    RETURN public.d_storage_visibility_changed(p_storage_object_id, FALSE, v_rev + 1);
END;
$$;

-- Storage binding of the generic confirm: lock order is parent row, then
-- challenge row. Checks run binding/proof -> lifecycle -> owner/revision, so a
-- challenge is never consumed by a request that fails a later check.
CREATE FUNCTION public.d_storage_apply_make_public(
    p_actor_user_id UUID,
    p_challenge_id UUID,
    p_storage_object_id UUID,
    p_expected_revision BIGINT,
    p_proof TEXT,
    p_request_id UUID
)
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
AS
$$
DECLARE
    v_challenge public.app_confirmation_challenges%ROWTYPE;
    v_class     TEXT;
    v_outcome   TEXT;
    v_rev       BIGINT;
BEGIN
    PERFORM 1
    FROM public.d_storage_objects AS so
    WHERE so.storage_object_id = p_storage_object_id
        FOR NO KEY UPDATE;

    v_challenge := public.app_confirmation_lock(p_challenge_id);

    v_class := public.app_confirmation_classify(v_challenge, p_actor_user_id, 'storage.visibility.make_public',
                                                'storage_object', p_storage_object_id, p_expected_revision,
                                                p_proof, p_request_id);

    IF v_class = 'replay' THEN
        RETURN public.d_storage_visibility_changed(p_storage_object_id, TRUE, v_challenge.consumed_config_revision);
    END IF;

    IF v_class <> 'ok' THEN
        RETURN public.d_storage_visibility_rejected(v_class);
    END IF;

    SELECT g.outcome, g.current_revision
    INTO v_outcome, v_rev
    FROM public.d_storage_visibility_guard(p_actor_user_id, p_storage_object_id, p_expected_revision, FALSE) AS g;

    -- The challenge stays active: a later retry at the right revision may still use it.
    IF v_outcome <> 'ok' THEN
        RETURN public.d_storage_visibility_rejected(v_outcome);
    END IF;

    INSERT INTO public.d_storage_object_config (storage_object_id, public, config_version)
    VALUES (p_storage_object_id, TRUE, v_rev + 1);

    PERFORM public.app_confirmation_consume(p_challenge_id, p_request_id, v_rev + 1);

    RETURN public.d_storage_visibility_changed(p_storage_object_id, TRUE, v_rev + 1);
END;
$$;

-- Generic job 2: dispatches by registered operation kind. A kind that is not
-- registered for the target type executes nothing.
CREATE FUNCTION public.confirm_app_operation(
    p_challenge_id UUID,
    p_operation_kind TEXT,
    p_target_type TEXT,
    p_target_id UUID,
    p_expected_revision BIGINT,
    p_proof TEXT,
    p_request_id UUID
)
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
AS
$$
DECLARE
    v_actor UUID;
BEGIN
    IF p_challenge_id IS NULL OR p_operation_kind IS NULL OR p_target_type IS NULL OR p_target_id IS NULL
        OR p_expected_revision IS NULL OR p_proof IS NULL OR p_request_id IS NULL THEN
        RAISE EXCEPTION 'confirm_app_operation: arguments are required';
    END IF;

    SELECT go.user_id INTO v_actor FROM public.get_owner() AS go;

    IF v_actor IS NULL THEN
        RETURN public.d_storage_visibility_rejected('forbidden');
    END IF;

    IF NOT EXISTS (SELECT 1
                   FROM public.app_confirmable_operations AS o
                   WHERE o.operation_kind = p_operation_kind
                     AND o.target_type = p_target_type) THEN
        RETURN public.d_storage_visibility_rejected('invalid_challenge');
    END IF;

    IF p_operation_kind = 'storage.visibility.make_public' THEN
        RETURN public.d_storage_apply_make_public(v_actor, p_challenge_id, p_target_id, p_expected_revision,
                                                  p_proof, p_request_id);
    END IF;

    -- Registered but not implemented by this feature: execute nothing.
    RETURN public.d_storage_visibility_rejected('invalid_challenge');
END;
$$;

-- Default privileges hand EXECUTE to anon and authenticated on new functions.
REVOKE ALL ON FUNCTION public.d_storage_visibility_guard(UUID, UUID, BIGINT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.d_storage_visibility_rejected(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.d_storage_visibility_changed(UUID, BOOLEAN, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.d_storage_apply_make_public(UUID, UUID, UUID, BIGINT, TEXT, UUID) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.begin_d_storage_make_public(UUID, BIGINT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.make_d_storage_object_private(UUID, BIGINT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_app_operation(UUID, TEXT, TEXT, UUID, BIGINT, TEXT, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.begin_d_storage_make_public(UUID, BIGINT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.make_d_storage_object_private(UUID, BIGINT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_app_operation(UUID, TEXT, TEXT, UUID, BIGINT, TEXT, UUID) TO authenticated, service_role;
