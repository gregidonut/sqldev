CREATE OR REPLACE FUNCTION post_text(
    p_text_content TEXT
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
    v_user_id UUID := (SELECT user_id AS v_user_id
                       FROM public.get_owner());
    v_post_id UUID;
BEGIN
    INSERT INTO public.ig_posts (user_id)
    VALUES (v_user_id)
    RETURNING ig_posts.post_id INTO v_post_id;

    INSERT INTO public.ig_post_text_content (post_id, text_content)
    VALUES (v_post_id, p_text_content);

    RETURN QUERY
        SELECT v_post_id as post_id;

END;
$$;
