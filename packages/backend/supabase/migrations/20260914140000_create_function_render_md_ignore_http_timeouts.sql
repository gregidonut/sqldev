CREATE OR REPLACE FUNCTION public.render_md()
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

    IF v_render_md_url IS NULL THEN
        RAISE WARNING 'render_md: missing vault secret';
        RETURN NEW;
    END IF;

    BEGIN
        SELECT *
        INTO v_request_result
        FROM extensions.http_post(
                v_render_md_url::VARCHAR,
                JSONB_BUILD_OBJECT('text', new.text_content)::VARCHAR,
                'application/json'::VARCHAR
             );

        IF v_request_result.status = 200 THEN
            new.text_content_html := (v_request_result.content::JSONB) ->> 'html';
        ELSE
            RAISE WARNING 'render_md failed with status %', v_request_result.status;
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            RAISE WARNING 'render_md failed: %', SQLERRM;
    END;

    RETURN NEW;
END;
$$;
