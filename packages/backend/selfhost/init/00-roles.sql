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
