CREATE OR REPLACE FUNCTION notify_tds_todo_spaces_view()
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
        RAISE WARNING 'notify_tds_todo_spaces_view: missing vault secrets';
        RETURN NEW;
    END IF;

    SELECT tsc.public
    INTO is_public
    FROM public.tds_todo_space_config AS tsc
    WHERE tsc.todo_space_id = NEW.todo_space_id
    ORDER BY tsc.created_at DESC
    LIMIT 1;

    IF COALESCE(is_public, FALSE) THEN
        PERFORM net.http_post(
                notify_url,
                JSONB_BUILD_OBJECT(
                        'view', 'tds_todo_spaces_view',
                        'message', 'new_todo_space_data',
                        'visibility', 'public'
                ),
                '{}'::JSONB,
                JSONB_BUILD_OBJECT(
                        'Content-Type', 'application/json',
                        'X-Notify-Secret', notify_secret
                )
                );
    ELSE
        SELECT COALESCE(ARRAY_AGG(DISTINCT u.clerk_user_id), ARRAY []::TEXT[])
        INTO recipients
        FROM public.tds_todo_spaces_roles AS r
                 JOIN public.tds_todo_spaces_permissions AS p
                      ON p.role = r.role
                          AND p.permission = 'tds_todo_spaces.read'::public.TDS_TODO_SPACES_PERMISSION
                 JOIN public.users AS u
                      ON u.user_id = r.user_id
        WHERE r.todo_space_id = NEW.todo_space_id;

        PERFORM net.http_post(
                notify_url,
                JSONB_BUILD_OBJECT(
                        'view', 'tds_todo_spaces_view',
                        'message', 'new_todo_space_data',
                        'visibility', 'private',
                        'recipients', TO_JSONB(recipients)
                ),
                '{}'::JSONB,
                JSONB_BUILD_OBJECT(
                        'Content-Type', 'application/json',
                        'X-Notify-Secret', notify_secret
                )
                );
    END IF;

    RETURN NEW;
END;
$$;
CREATE TRIGGER tds_todo_space_data_insert_trigger
    AFTER INSERT
    ON public.tds_todo_space_data
    FOR EACH ROW
EXECUTE FUNCTION notify_tds_todo_spaces_view();