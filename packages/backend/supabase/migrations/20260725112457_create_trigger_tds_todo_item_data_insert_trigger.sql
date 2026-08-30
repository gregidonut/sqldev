CREATE OR REPLACE FUNCTION notify_tds_todos_view()
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
        RAISE WARNING 'notify_tds_todos_view: missing vault secrets';
        RETURN new;
    END IF;

    SELECT tsc.public
    INTO is_public
    FROM public.tds_todo_space_config AS tsc
    WHERE tsc.todo_space_id =
          (SELECT ts.todo_space_id
           FROM public.tds_todo_spaces AS ts
                    INNER JOIN public.tds_todo_items AS ti
                               ON ts.todo_space_id = ti.todo_space_id
           WHERE ti.todo_item_id = new.todo_item_id
           LIMIT 1)
    LIMIT 1;

    IF COALESCE(is_public, FALSE) THEN
        PERFORM public.notify_http_post(
                notify_url,
                JSONB_BUILD_OBJECT(
                        'view', 'tds_todos_view',
                        'message', 'new_todo_item_data',
                        'visibility', 'public'
                ),
                notify_secret
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
        WHERE r.todo_space_id = (SELECT ts.todo_space_id
                                 FROM public.tds_todo_spaces AS ts
                                          INNER JOIN public.tds_todo_items AS ti
                                                     ON ts.todo_space_id = ti.todo_space_id
                                 WHERE ti.todo_item_id = new.todo_item_id
                                 LIMIT 1);

        PERFORM public.notify_http_post(
                notify_url,
                JSONB_BUILD_OBJECT(
                        'view', 'tds_todos_view',
                        'message', 'new_todo_item_data',
                        'visibility', 'private',
                        'recipients', TO_JSONB(recipients)
                ),
                notify_secret
                );
    END IF;

    RETURN new;
END;
$$;
CREATE TRIGGER tds_todo_item_data_insert_trigger
    AFTER INSERT
    ON public.tds_todo_item_data
    FOR EACH ROW
EXECUTE FUNCTION notify_tds_todos_view();
