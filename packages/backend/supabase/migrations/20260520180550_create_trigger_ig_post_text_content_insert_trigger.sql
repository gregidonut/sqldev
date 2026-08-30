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
END;
$$;

CREATE OR REPLACE FUNCTION notify_ig_posts_view()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
AS
$$
DECLARE
    notify_ig_posts_view_url TEXT;
    notify_secret            TEXT;
    is_public                BOOLEAN;
    recipients               TEXT[];
BEGIN

    SELECT decrypted_secret
    INTO notify_ig_posts_view_url
    FROM vault.decrypted_secrets
    WHERE name = 'notify_ig_posts_view_url';

    SELECT decrypted_secret
    INTO notify_secret
    FROM vault.decrypted_secrets
    WHERE name = 'notify_ig_posts_view_secret';

    SELECT pc.public
    INTO is_public
    FROM public.ig_post_config AS pc
    WHERE pc.post_id = new.post_id
    ORDER BY pc.created_at DESC
    LIMIT 1;

    IF
        COALESCE(is_public, FALSE) THEN
        PERFORM public.notify_http_post(
                notify_ig_posts_view_url,
                JSONB_BUILD_OBJECT(
                        'view', 'ig_posts_view',
                        'message', 'new_post_content',
                        'visibility', 'public'
                ),
                notify_secret
                );
    ELSE
        SELECT COALESCE(ARRAY_AGG(DISTINCT u.clerk_user_id), ARRAY []::TEXT[])
        INTO recipients
        FROM public.ig_posts_roles AS r
                 JOIN public.ig_posts_permissions AS p
                      ON p.role = r.role
                          AND p.permission = 'ig_posts.read'::public.IG_POSTS_PERMISSION
                 JOIN public.users AS u
                      ON u.user_id = r.user_id
        WHERE r.post_id = new.post_id;

        PERFORM public.notify_http_post(
                notify_ig_posts_view_url,
                JSONB_BUILD_OBJECT(
                        'view', 'ig_posts_view',
                        'message', 'new_post_content',
                        'visibility', 'private',
                        'recipients', TO_JSONB(recipients)
                ),
                notify_secret
                );
    END IF;

    RETURN new;
END;
$$;
CREATE TRIGGER ig_post_text_content_insert_trigger
    AFTER INSERT
    ON public.ig_post_text_content
    FOR EACH ROW
EXECUTE FUNCTION notify_ig_posts_view();
