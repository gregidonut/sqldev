-- d_storage_object_config is an append-only history. The current row is the one
-- with the greatest config_version, never the latest created_at: created_at is
-- the transaction start time, so a writer that waited on a lock can commit a
-- later row with an earlier (or equal) timestamp. config_version is an explicit
-- per-object revision that totally orders the history and doubles as the
-- optimistic-concurrency token.
CREATE TABLE d_storage_object_config
(
    storage_object_config_id UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    storage_object_id        UUID        NOT NULL REFERENCES public.d_storage_objects (storage_object_id),
    public                   BOOLEAN     NOT NULL DEFAULT FALSE,
    config_version           BIGINT      NOT NULL,
    CONSTRAINT d_storage_object_config_version_positive CHECK (config_version > 0),
    CONSTRAINT d_storage_object_config_object_version_key UNIQUE (storage_object_id, config_version)
);

-- Insert-only. DELETE stays possible because abort_d_storage_upload removes the
-- config row of an upload shell that never committed any data, and the e2e reset
-- TRUNCATEs the table (TRUNCATE does not fire row triggers).
CREATE FUNCTION public.d_storage_object_config_reject_update()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SET search_path = ''
AS
$$
BEGIN
    RAISE EXCEPTION 'd_storage_object_config is insert-only';
END;
$$;

CREATE TRIGGER d_storage_object_config_no_update
    BEFORE UPDATE
    ON public.d_storage_object_config
    FOR EACH ROW
EXECUTE FUNCTION public.d_storage_object_config_reject_update();

-- The one definition of "current config": the greatest revision.
CREATE FUNCTION public.d_storage_object_current_config(
    p_storage_object_id UUID
)
    RETURNS TABLE
            (
                config_version BIGINT,
                public         BOOLEAN
            )
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
AS
$$
SELECT c.config_version, c.public
FROM public.d_storage_object_config AS c
WHERE c.storage_object_id = p_storage_object_id
ORDER BY c.config_version DESC
LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.d_storage_object_current_config(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.d_storage_object_current_config(UUID) TO service_role;
