-- Call after create_ig_post / update_ig_post returns so MQTT publish
-- happens after the insert transaction commits. HTTP still goes through
-- public.notify_http_post (extensions.http).

CREATE OR REPLACE FUNCTION public.notify_ig_posts_view_for_post(p_post_id UUID)
    RETURNS VOID
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
    IF p_post_id IS NULL THEN
        RETURN;
    END IF;

    SELECT decrypted_secret
    INTO notify_ig_posts_view_url
    FROM vault.decrypted_secrets
    WHERE name = 'notify_ig_posts_view_url';

    SELECT decrypted_secret
    INTO notify_secret
    FROM vault.decrypted_secrets
    WHERE name = 'notify_ig_posts_view_secret';

    IF notify_ig_posts_view_url IS NULL OR notify_secret IS NULL THEN
        RAISE WARNING 'notify_ig_posts_view_for_post: missing vault secrets';
        RETURN;
    END IF;

    SELECT pc.public
    INTO is_public
    FROM public.ig_post_config AS pc
    WHERE pc.post_id = p_post_id
    ORDER BY pc.created_at DESC
    LIMIT 1;

    IF COALESCE(is_public, FALSE) THEN
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
        WHERE r.post_id = p_post_id;

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
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_ig_posts_view_for_post(UUID)
    TO authenticated, service_role;
