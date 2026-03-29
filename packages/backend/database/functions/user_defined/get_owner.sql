DROP FUNCTION get_owner();
CREATE OR REPLACE FUNCTION get_owner()
    RETURNS TABLE
            (
                OWNER_ID UUID
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
        SELECT user_id AS owner_id
        FROM public.users
        WHERE clerk_user_id = v_clerk_user_id
        LIMIT 1;
END;
$$;
