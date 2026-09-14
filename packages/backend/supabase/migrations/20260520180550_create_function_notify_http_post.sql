CREATE OR REPLACE FUNCTION public.notify_http_post(
    url TEXT,
    body JSONB,
    notify_secret TEXT
)
    RETURNS VOID
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
AS
$$
DECLARE
    response RECORD;
BEGIN
    IF url IS NULL OR notify_secret IS NULL THEN
        RAISE WARNING 'notify_http_post: missing url or secret';
        RETURN;
    END IF;

    BEGIN
        SELECT *
        INTO response
        FROM extensions.http((
                              'POST',
                              url,
                              ARRAY [
                                  extensions.http_header('Content-Type', 'application/json'),
                                  extensions.http_header('X-Notify-Secret', notify_secret)
                                  ],
                              'application/json',
                              body::TEXT
                              )::extensions.http_request);

        IF response.status >= 400 THEN
            RAISE WARNING 'notify_http_post failed with status % for url %', response.status, url;
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            RAISE WARNING 'notify_http_post failed: %', SQLERRM;
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_http_post(TEXT, JSONB, TEXT)
    FROM PUBLIC, anon, authenticated;
