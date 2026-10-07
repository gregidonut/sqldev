-- Bootstrap roles used by the application migrations and the DBOS worker.
-- auth.jwt() reads the transaction-local claims set by the worker.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.jwt()
    RETURNS jsonb
    LANGUAGE sql
    STABLE
AS
$$
SELECT COALESCE(
               NULLIF(current_setting('request.jwt.claim', true), ''),
               NULLIF(current_setting('request.jwt.claims', true), '')
       )::jsonb
$$;

DO
$$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            CREATE ROLE authenticated NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            CREATE ROLE anon NOLOGIN;
        END IF;
    END
$$;

-- Supabase Storage is not deployed here; files live in S3. The migrations still
-- reference storage.objects (foreign keys on id and RLS policies), so provide
-- the table. postgres owns it because CREATE POLICY requires the owner.
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA storage TO postgres, authenticated, anon;
CREATE TABLE IF NOT EXISTS storage.objects
(
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id  TEXT,
    name       TEXT,
    owner      UUID,
    metadata   JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE storage.objects OWNER TO postgres;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
