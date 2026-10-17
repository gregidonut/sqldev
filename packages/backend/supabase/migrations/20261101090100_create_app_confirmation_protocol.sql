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
--
-- `operation_kind` is the primary key and the challenge foreign-key binding.
-- `registry_id` is a generated, permanent BIGINT (first value 1000) that identifies
-- the row to clients; it is presentation/protocol identity only and carries no
-- authorization weight. The three dialog_* columns are the operation's source copy:
-- PostgreSQL owns the text of the confirmation dialog and resolves it against
-- committed target data when a challenge is issued
-- (app_confirmation_resolve_dialog_copy).
--
-- Sequence values are allocated outside transactions. A failed or rolled-back
-- insert still consumes a value, so identifiers are unique and increasing but not
-- gapless. The sequence is NO CYCLE: at the maximum the next allocation raises,
-- the registry INSERT fails, and no retained row changes.
CREATE SEQUENCE public.app_confirmable_operations_registry_id_seq
    AS BIGINT
    START WITH 1000
    INCREMENT BY 1
    MINVALUE 1000
    MAXVALUE 9223372036854775807
    CACHE 1
    NO CYCLE;

-- One definition of "blank" shared with the Go and TypeScript decoders: NULL, the
-- empty string, or only characters of the Unicode White_Space class. btrim (spaces
-- only), Go TrimSpace and JavaScript trim() disagree on characters such as U+0085
-- and U+FEFF, so none of them is used for this decision.
CREATE FUNCTION public.app_confirmation_text_is_blank(
    p_value TEXT
)
    RETURNS BOOLEAN
    LANGUAGE sql
    IMMUTABLE
    SET search_path = ''
AS
$$
SELECT p_value IS NULL
           OR p_value ~ '^[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]*$';
$$;

-- char_length counts Unicode code points (the database encoding is UTF8), which is
-- the length unit shared with Go (utf8.RuneCountInString) and TypeScript
-- (Array.from(value).length).
CREATE TABLE public.app_confirmable_operations
(
    operation_kind        TEXT PRIMARY KEY CHECK (operation_kind ~ '^[a-z]+(\.[a-z_]+)+$'),
    target_type           TEXT     NOT NULL,
    validity              INTERVAL NOT NULL CHECK (validity > INTERVAL '0' AND validity <= INTERVAL '15 minutes'),
    registry_id           BIGINT   NOT NULL DEFAULT nextval('public.app_confirmable_operations_registry_id_seq'::REGCLASS),
    dialog_title_template TEXT     NOT NULL,
    dialog_description    TEXT     NOT NULL,
    dialog_confirm_label  TEXT     NOT NULL,
    CONSTRAINT app_confirmable_operations_registry_id_key UNIQUE (registry_id),
    CONSTRAINT app_confirmable_operations_registry_id_min CHECK (registry_id >= 1000),
    CONSTRAINT app_confirmable_operations_dialog_title_template_valid CHECK (
        NOT public.app_confirmation_text_is_blank(dialog_title_template)
            -- exactly one {{targetLabel}} token (15 characters) ...
            AND char_length(dialog_title_template)
                    - char_length(replace(dialog_title_template, '{{targetLabel}}', '')) = 15
            -- ... and no other placeholder delimiters once it is removed
            AND position('{{' IN replace(dialog_title_template, '{{targetLabel}}', '')) = 0
            AND position('}}' IN replace(dialog_title_template, '{{targetLabel}}', '')) = 0
        ),
    CONSTRAINT app_confirmable_operations_dialog_description_valid CHECK (
        NOT public.app_confirmation_text_is_blank(dialog_description)
            AND char_length(dialog_description) BETWEEN 1 AND 2000
        ),
    CONSTRAINT app_confirmable_operations_dialog_confirm_label_valid CHECK (
        NOT public.app_confirmation_text_is_blank(dialog_confirm_label)
            AND char_length(dialog_confirm_label) BETWEEN 1 AND 80
        )
);

ALTER SEQUENCE public.app_confirmable_operations_registry_id_seq
    OWNED BY public.app_confirmable_operations.registry_id;

-- The identifier is permanent. Authored copy edits stay allowed.
CREATE FUNCTION public.app_confirmable_operations_registry_id_guard()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SET search_path = ''
AS
$$
BEGIN
    RAISE EXCEPTION 'app_confirmable_operations: registry_id is immutable';
END;
$$;

CREATE TRIGGER app_confirmable_operations_registry_id_immutable
    BEFORE UPDATE
    ON public.app_confirmable_operations
    FOR EACH ROW
    WHEN (OLD.registry_id IS DISTINCT FROM NEW.registry_id)
EXECUTE FUNCTION public.app_confirmable_operations_registry_id_guard();

-- registry_id is omitted so the sequence assigns it: the first row gets exactly 1000.
INSERT INTO public.app_confirmable_operations (operation_kind, target_type, validity,
                                               dialog_title_template, dialog_description, dialog_confirm_label)
VALUES ('storage.visibility.make_public', 'storage_object', INTERVAL '5 minutes',
        'Make “{{targetLabel}}” public?',
        'Anyone signed in to SQLDev will be able to see and download this file. The stored file stays private in S3.',
        'Make public');

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
--
-- Returns the challenge plus the registry row's identity and copy source. The
-- registry row is read FOR SHARE so a concurrent edit of its copy cannot commit
-- between reading the copy and committing the challenge. The identity and copy come
-- from that same row, selected by the very operation_kind that the challenge row is
-- bound to. Raised messages are fixed strings: they never carry copy, a label, a
-- proof, or an identifier. Every table reference is alias-qualified because the
-- output column names (registry_id, ...) are also PL/pgSQL variables inside the body.
CREATE FUNCTION public.app_confirmation_issue(
    p_actor_user_id UUID,
    p_operation_kind TEXT,
    p_target_id UUID,
    p_expected_revision BIGINT,
    p_request_id UUID
)
    RETURNS TABLE
            (
                challenge_id          UUID,
                proof                 TEXT,
                expires_at            TIMESTAMPTZ,
                registry_id           BIGINT,
                dialog_title_template TEXT,
                dialog_description    TEXT,
                dialog_confirm_label  TEXT
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
    SELECT o.*
    INTO v_op
    FROM public.app_confirmable_operations AS o
    WHERE o.operation_kind = p_operation_kind
        FOR SHARE OF o;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'app_confirmation_issue: operation is not registered';
    END IF;

    -- Checked before anything is superseded or inserted. The table constraints make
    -- this unreachable for committed rows; it is the fail-closed backstop that keeps
    -- a challenge from being issued without usable dialog copy.
    IF v_op.registry_id IS NULL
        OR v_op.registry_id < 1000
        OR public.app_confirmation_text_is_blank(v_op.dialog_title_template)
        OR public.app_confirmation_text_is_blank(v_op.dialog_description)
        OR char_length(v_op.dialog_description) > 2000
        OR public.app_confirmation_text_is_blank(v_op.dialog_confirm_label)
        OR char_length(v_op.dialog_confirm_label) > 80 THEN
        RAISE EXCEPTION 'app_confirmation_issue: registry row is invalid';
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

    RETURN QUERY SELECT v_challenge, v_proof, v_expires_at,
                        v_op.registry_id, v_op.dialog_title_template,
                        v_op.dialog_description, v_op.dialog_confirm_label;
END;
$$;


-- The only place a dialog title is built. replace() is a literal substitution of
-- the single {{targetLabel}} token: it has no regex, backslash, or `&` semantics,
-- and it is one pass, so a label that itself contains "{{targetLabel}}" is not
-- expanded again. Nothing is trimmed, truncated, escaped, or normalized; a value
-- that does not fit is an error, never silently altered. Lengths are Unicode code
-- points (char_length on a UTF8 database), matching Go and TypeScript.
CREATE FUNCTION public.app_confirmation_resolve_dialog_copy(
    p_title_template TEXT,
    p_description TEXT,
    p_confirm_label TEXT,
    p_target_label TEXT
)
    RETURNS JSONB
    LANGUAGE plpgsql
    IMMUTABLE
    SET search_path = ''
AS
$$
DECLARE
    v_title TEXT;
BEGIN
    IF public.app_confirmation_text_is_blank(p_title_template)
        OR public.app_confirmation_text_is_blank(p_description)
        OR public.app_confirmation_text_is_blank(p_confirm_label)
        OR public.app_confirmation_text_is_blank(p_target_label) THEN
        RAISE EXCEPTION 'app_confirmation_resolve_dialog_copy: invalid dialog copy';
    END IF;

    v_title := replace(p_title_template, '{{targetLabel}}', p_target_label);

    IF public.app_confirmation_text_is_blank(v_title)
        OR char_length(v_title) > 200
        OR char_length(p_description) > 2000
        OR char_length(p_confirm_label) > 80 THEN
        RAISE EXCEPTION 'app_confirmation_resolve_dialog_copy: invalid dialog copy';
    END IF;

    RETURN jsonb_build_object('title', v_title,
                              'description', p_description,
                              'confirmLabel', p_confirm_label);
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
REVOKE ALL ON SEQUENCE public.app_confirmable_operations_registry_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_confirmation_text_is_blank(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_confirmable_operations_registry_id_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_confirmation_proof_verifier(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_confirmation_issue(UUID, TEXT, UUID, BIGINT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_confirmation_resolve_dialog_copy(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_confirmation_lock(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_confirmation_classify(public.app_confirmation_challenges, UUID, TEXT, TEXT, UUID,
    BIGINT, TEXT, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_confirmation_consume(UUID, UUID, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_confirmation_cleanup(INT) FROM PUBLIC, anon, authenticated;
