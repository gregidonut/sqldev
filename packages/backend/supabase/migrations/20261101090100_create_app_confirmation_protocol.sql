-- Generic, reusable "confirm before commit" primitives. PostgreSQL is the
-- authority: a challenge is bound to one actor, operation kind, target and
-- expected revision, expires on PostgreSQL time, and is consumed in the same
-- transaction as the mutation it authorizes. A challenge is consent, never
-- authorization: every confirming function re-checks authorization itself.
--
-- Nothing here is granted to anon or authenticated. Operation-specific
-- SECURITY DEFINER entry points (see the storage visibility migration) call the
-- internal primitives.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TYPE public.APP_CONFIRMATION_STATE AS ENUM ('active', 'consumed', 'expired', 'superseded');

-- The only extension point for new confirmable operations.
CREATE TABLE public.app_confirmable_operations
(
    operation_kind TEXT PRIMARY KEY CHECK (operation_kind ~ '^[a-z]+(\.[a-z_]+)+$'),
    target_type    TEXT     NOT NULL,
    validity       INTERVAL NOT NULL CHECK (validity > INTERVAL '0' AND validity <= INTERVAL '15 minutes')
);

INSERT INTO public.app_confirmable_operations (operation_kind, target_type, validity)
VALUES ('storage.visibility.make_public', 'storage_object', INTERVAL '5 minutes');

CREATE TABLE public.app_confirmation_challenges
(
    challenge_id             UUID PRIMARY KEY                  DEFAULT gen_random_uuid(),
    actor_user_id            UUID                     NOT NULL REFERENCES public.users (user_id) ON DELETE CASCADE,
    operation_kind           TEXT                     NOT NULL REFERENCES public.app_confirmable_operations (operation_kind),
    target_type              TEXT                     NOT NULL,
    target_id                UUID                     NOT NULL,
    expected_revision        BIGINT                   NOT NULL CHECK (expected_revision > 0),
    created_at               TIMESTAMPTZ              NOT NULL,
    expires_at               TIMESTAMPTZ              NOT NULL,
    proof_verifier           BYTEA                    NOT NULL CHECK (octet_length(proof_verifier) = 32),
    state                    public.APP_CONFIRMATION_STATE NOT NULL DEFAULT 'active',
    state_changed_at         TIMESTAMPTZ              NOT NULL,
    initiation_request_id    UUID                     NOT NULL UNIQUE,
    consumed_by_request_id   UUID UNIQUE,
    consumed_config_revision BIGINT,
    CONSTRAINT app_confirmation_challenges_expiry_after_creation CHECK (expires_at > created_at),
    CONSTRAINT app_confirmation_challenges_consumed_fields CHECK (
        (state = 'consumed') = (consumed_by_request_id IS NOT NULL AND consumed_config_revision IS NOT NULL)
        )
);

-- At most one active challenge per binding, enforced by the index itself.
CREATE UNIQUE INDEX app_confirmation_challenges_one_active
    ON public.app_confirmation_challenges (actor_user_id, operation_kind, target_type, target_id, expected_revision)
    WHERE state = 'active';

CREATE INDEX app_confirmation_challenges_cleanup_idx
    ON public.app_confirmation_challenges (created_at);

ALTER TABLE public.app_confirmable_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_confirmation_challenges ENABLE ROW LEVEL SECURITY;

-- No policies: only SECURITY DEFINER functions touch these tables.
-- init_permissions grants ALL on new tables to authenticated by default.
REVOKE ALL ON public.app_confirmable_operations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.app_confirmation_challenges FROM PUBLIC, anon, authenticated;

-- One-way verifier. The proof itself is never stored. 256 bits of entropy
-- makes a plain SHA-256 sufficient; the prefix is domain separation.
CREATE FUNCTION public.app_confirmation_proof_verifier(
    p_proof TEXT
)
    RETURNS BYTEA
    LANGUAGE sql
    IMMUTABLE
    SET search_path = ''
AS
$$
SELECT sha256(convert_to('sqldev.confirmation.proof.v1' || chr(10) || COALESCE(p_proof, ''), 'UTF8'));
$$;

-- Caller must already hold the target's parent-row lock, so the supersede and
-- the insert cannot interleave with another issue for the same binding.
CREATE FUNCTION public.app_confirmation_issue(
    p_actor_user_id UUID,
    p_operation_kind TEXT,
    p_target_id UUID,
    p_expected_revision BIGINT,
    p_request_id UUID
)
    RETURNS TABLE
            (
                challenge_id UUID,
                proof        TEXT,
                expires_at   TIMESTAMPTZ
            )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
AS
$$
DECLARE
    v_op         public.app_confirmable_operations%ROWTYPE;
    v_now        TIMESTAMPTZ := now();
    v_proof      TEXT;
    v_challenge  UUID;
    v_expires_at TIMESTAMPTZ;
BEGIN
    SELECT *
    INTO v_op
    FROM public.app_confirmable_operations AS o
    WHERE o.operation_kind = p_operation_kind;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'app_confirmation_issue: operation is not registered';
    END IF;

    UPDATE public.app_confirmation_challenges AS c
    SET state            = 'superseded',
        state_changed_at = v_now
    WHERE c.state = 'active'
      AND c.actor_user_id = p_actor_user_id
      AND c.operation_kind = p_operation_kind
      AND c.target_type = v_op.target_type
      AND c.target_id = p_target_id
      AND c.expected_revision = p_expected_revision;

    -- 32 random bytes -> 43 URL-safe base64 characters (unpadded).
    v_proof := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
    v_expires_at := v_now + v_op.validity;

    INSERT INTO public.app_confirmation_challenges AS c (actor_user_id, operation_kind, target_type, target_id,
                                                         expected_revision, created_at, expires_at, proof_verifier,
                                                         state, state_changed_at, initiation_request_id)
    VALUES (p_actor_user_id, p_operation_kind, v_op.target_type, p_target_id,
            p_expected_revision, v_now, v_expires_at, public.app_confirmation_proof_verifier(v_proof),
            'active', v_now, p_request_id)
    RETURNING c.challenge_id INTO v_challenge;

    PERFORM public.app_confirmation_cleanup(100);

    RETURN QUERY SELECT v_challenge, v_proof, v_expires_at;
END;
$$;

-- Row lock on the challenge. Always taken AFTER the target's parent-row lock.
CREATE FUNCTION public.app_confirmation_lock(
    p_challenge_id UUID
)
    RETURNS public.app_confirmation_challenges
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
AS
$$
DECLARE
    v_challenge public.app_confirmation_challenges%ROWTYPE;
BEGIN
    SELECT *
    INTO v_challenge
    FROM public.app_confirmation_challenges AS c
    WHERE c.challenge_id = p_challenge_id
    FOR UPDATE;

    RETURN v_challenge;
END;
$$;

-- Decides what a confirmation attempt may do. Returns one of:
--   ok | replay | invalid_challenge | consumed_challenge | superseded_challenge | expired_challenge
-- Binding and proof are checked first, so a stranger holding someone else's
-- challenge id learns only "invalid_challenge". An active challenge whose time
-- has passed is moved to 'expired' here and the change is committed by the
-- caller, which returns the outcome instead of raising.
-- p_now exists so tests can probe the exact expiry boundary; entry points never
-- pass it, so execution time is the transaction timestamp.
CREATE FUNCTION public.app_confirmation_classify(
    p_challenge public.app_confirmation_challenges,
    p_actor_user_id UUID,
    p_operation_kind TEXT,
    p_target_type TEXT,
    p_target_id UUID,
    p_expected_revision BIGINT,
    p_proof TEXT,
    p_request_id UUID,
    p_now TIMESTAMPTZ DEFAULT now()
)
    RETURNS TEXT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
AS
$$
BEGIN
    IF p_challenge.challenge_id IS NULL
        OR (p_challenge.actor_user_id, p_challenge.operation_kind, p_challenge.target_type,
            p_challenge.target_id, p_challenge.expected_revision)
           IS DISTINCT FROM
           (p_actor_user_id, p_operation_kind, p_target_type, p_target_id, p_expected_revision)
        OR p_challenge.proof_verifier IS DISTINCT FROM public.app_confirmation_proof_verifier(p_proof) THEN
        RETURN 'invalid_challenge';
    END IF;

    IF p_challenge.state = 'consumed' THEN
        IF p_challenge.consumed_by_request_id IS NOT DISTINCT FROM p_request_id THEN
            RETURN 'replay';
        END IF;
        RETURN 'consumed_challenge';
    ELSIF p_challenge.state = 'superseded' THEN
        RETURN 'superseded_challenge';
    ELSIF p_challenge.state = 'expired' THEN
        RETURN 'expired_challenge';
    END IF;

    IF p_now >= p_challenge.expires_at THEN
        UPDATE public.app_confirmation_challenges AS c
        SET state            = 'expired',
            state_changed_at = p_now
        WHERE c.challenge_id = p_challenge.challenge_id
          AND c.state = 'active';
        RETURN 'expired_challenge';
    END IF;

    RETURN 'ok';
END;
$$;

CREATE FUNCTION public.app_confirmation_consume(
    p_challenge_id UUID,
    p_request_id UUID,
    p_config_revision BIGINT
)
    RETURNS VOID
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
AS
$$
BEGIN
    UPDATE public.app_confirmation_challenges AS c
    SET state                    = 'consumed',
        state_changed_at         = now(),
        consumed_by_request_id   = p_request_id,
        consumed_config_revision = p_config_revision
    WHERE c.challenge_id = p_challenge_id
      AND c.state = 'active';

    IF NOT FOUND THEN
        -- The caller holds the row lock and has just classified it as ok.
        RAISE EXCEPTION 'app_confirmation_consume: challenge is not active';
    END IF;
END;
$$;

-- Bounded retention. Never touches an unexpired active challenge.
CREATE FUNCTION public.app_confirmation_cleanup(
    p_limit INT
)
    RETURNS VOID
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = ''
AS
$$
DELETE
FROM public.app_confirmation_challenges AS c
WHERE c.challenge_id IN (SELECT x.challenge_id
                         FROM public.app_confirmation_challenges AS x
                         WHERE x.created_at < now() - INTERVAL '1 day'
                           AND (x.state <> 'active' OR x.expires_at <= now())
                         ORDER BY x.created_at
                         LIMIT GREATEST(p_limit, 0)
                             FOR UPDATE SKIP LOCKED);
$$;

-- Default privileges give anon and authenticated EXECUTE on new functions.
REVOKE ALL ON FUNCTION public.app_confirmation_proof_verifier(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_confirmation_issue(UUID, TEXT, UUID, BIGINT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_confirmation_lock(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_confirmation_classify(public.app_confirmation_challenges, UUID, TEXT, TEXT, UUID,
    BIGINT, TEXT, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_confirmation_consume(UUID, UUID, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_confirmation_cleanup(INT) FROM PUBLIC, anon, authenticated;
