CREATE OR REPLACE FUNCTION get_owner()
    RETURNS TABLE
            (
                USER_ID       UUID,
                CLERK_USER_ID TEXT
            )
    LANGUAGE plpgsql
    SET search_path = ''
AS
$$
DECLARE
    v_clerk_user_id TEXT := (SELECT auth.jwt() ->> 'sub');
    v_user_id       UUID;
BEGIN
    SELECT u.user_id
    INTO v_user_id
    FROM public.users AS u
    WHERE u.clerk_user_id = v_clerk_user_id
    LIMIT 1;

    IF v_user_id IS NULL THEN
        INSERT INTO public.users (clerk_user_id) VALUES (v_clerk_user_id);
    END IF;

    RETURN QUERY
        SELECT u1.user_id, u1.clerk_user_id
        FROM public.users AS u1
        WHERE u1.clerk_user_id = v_clerk_user_id
        LIMIT 1;
END;
$$;
