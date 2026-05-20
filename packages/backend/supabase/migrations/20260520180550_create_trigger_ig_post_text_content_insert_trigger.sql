CREATE OR REPLACE FUNCTION notify_ig_post_view()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
AS
$$
DECLARE
    notify_ig_post_view_url TEXT;
    notify_secret           TEXT;
BEGIN

    SELECT decrypted_secret
    INTO notify_ig_post_view_url
    FROM vault.decrypted_secrets
    WHERE name = 'notify_ig_post_view_url';

    SELECT decrypted_secret
    INTO notify_secret
    FROM vault.decrypted_secrets
    WHERE name = 'notify_ig_post_view_secret';


    PERFORM net.http_post(
            notify_ig_post_view_url,
            JSONB_BUILD_OBJECT(
                    'view', 'ig_posts_view'
            ),
            '{}'::JSONB,
            JSONB_BUILD_OBJECT(
                    'Content-Type', 'application/json',
                    'X-Notify-Secret', notify_secret
            )
            );

    RETURN new;
END;
$$;
CREATE TRIGGER ig_post_text_content_insert_trigger
    AFTER INSERT
    ON public.ig_post_text_content
    FOR EACH ROW
EXECUTE FUNCTION notify_ig_post_view();