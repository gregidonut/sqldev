CREATE OR REPLACE FUNCTION create_ig_post(
    p_text_content TEXT,
    p_public BOOLEAN DEFAULT TRUE
)
    RETURNS TABLE
            (
                POST_ID UUID
            )
    LANGUAGE plpgsql
    SET search_path = ''
AS
$$
DECLARE
    v_user_id UUID := public.set_owner();
    v_post_id UUID;
BEGIN
    INSERT INTO public.ig_posts
        DEFAULT
    VALUES
    RETURNING ig_posts.post_id INTO v_post_id;

    INSERT INTO public.ig_posts_roles (post_id, user_id, role)
    VALUES (v_post_id, v_user_id, 'owner');

    -- Config must exist before text_content so the notify trigger can read visibility.
    INSERT INTO public.ig_post_config (post_id, public)
    VALUES (v_post_id, p_public);

    INSERT INTO public.ig_post_text_content (post_id, text_content)
    VALUES (v_post_id, p_text_content);

    RETURN QUERY
        SELECT v_post_id AS post_id;

END;
$$;