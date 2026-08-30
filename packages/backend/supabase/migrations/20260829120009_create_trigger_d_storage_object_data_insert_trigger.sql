CREATE OR REPLACE FUNCTION notify_d_storage_objects_view()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
AS
$$
DECLARE
    notify_url    TEXT;
    notify_secret TEXT;
    is_public     BOOLEAN;
    recipients    TEXT[];
BEGIN

    SELECT decrypted_secret
    INTO notify_url
    FROM vault.decrypted_secrets
    WHERE name = 'notify_ig_posts_view_url';

    SELECT decrypted_secret
    INTO notify_secret
    FROM vault.decrypted_secrets
    WHERE name = 'notify_ig_posts_view_secret';

    IF notify_url IS NULL OR notify_secret IS NULL THEN
        RAISE WARNING 'notify_d_storage_objects_view: missing vault secrets';
        RETURN NEW;
    END IF;

    SELECT soc.public
    INTO is_public
    FROM public.d_storage_object_config AS soc
    WHERE soc.storage_object_id = NEW.storage_object_id
    ORDER BY soc.created_at DESC
    LIMIT 1;

    IF COALESCE(is_public, FALSE) THEN
        PERFORM public.notify_http_post(
                notify_url,
                JSONB_BUILD_OBJECT(
                        'view', 'd_storage_objects_view',
                        'message', 'new_storage_object_data',
                        'visibility', 'public'
                ),
                notify_secret
                );
    ELSE
        SELECT COALESCE(ARRAY_AGG(DISTINCT u.clerk_user_id), ARRAY []::TEXT[])
        INTO recipients
        FROM public.d_storage_objects_roles AS r
                 JOIN public.d_storage_objects_permissions AS p
                      ON p.role = r.role
                          AND p.permission = 'd_storage_objects.read'::public.D_STORAGE_OBJECTS_PERMISSION
                 JOIN public.users AS u
                      ON u.user_id = r.user_id
        WHERE r.storage_object_id = NEW.storage_object_id;

        PERFORM public.notify_http_post(
                notify_url,
                JSONB_BUILD_OBJECT(
                        'view', 'd_storage_objects_view',
                        'message', 'new_storage_object_data',
                        'visibility', 'private',
                        'recipients', TO_JSONB(recipients)
                ),
                notify_secret
                );
    END IF;

    RETURN NEW;
END;
$$;
CREATE TRIGGER d_storage_object_data_insert_trigger
    AFTER INSERT
    ON public.d_storage_object_data
    FOR EACH ROW
EXECUTE FUNCTION notify_d_storage_objects_view();
