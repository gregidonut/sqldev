CREATE TABLE ig_post_text_content
(
    post_content_id   UUID PRIMARY KEY                            DEFAULT gen_random_uuid(),
    created_at        TIMESTAMPTZ                        NOT NULL DEFAULT NOW(),
    post_id           UUID REFERENCES ig_posts (post_id) NOT NULL,
    text_content      TEXT,
    text_content_html TEXT
);

CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION render_md()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
AS
$$
DECLARE
    v_render_md_url  TEXT;
    v_request_result RECORD;
BEGIN
    SELECT decrypted_secret
    INTO v_render_md_url
    FROM vault.decrypted_secrets
    WHERE name = 'render_md_url';

    -- Explicitly cast parameters to VARCHAR to match pg_http's exact signature
    SELECT *
    INTO v_request_result
    FROM extensions.http_post(
            v_render_md_url::VARCHAR,
            JSONB_BUILD_OBJECT('text', new.text_content)::VARCHAR,
            'application/json'::VARCHAR
         );

    -- Check if the status code is 200 before attempting to parse
    IF v_request_result.status = 200 THEN
        new.text_content_html := (v_request_result.content::JSONB) ->> 'html';
    END IF;

    RETURN new;
END;
$$;

CREATE TRIGGER ig_post_text_content_render_trigger
    BEFORE INSERT
    ON public.ig_post_text_content
    FOR EACH ROW
EXECUTE FUNCTION render_md();