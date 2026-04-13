CREATE OR REPLACE FUNCTION update_ig_post(
    p_post_id UUID,
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
    v_post_id UUID;
BEGIN
    INSERT INTO public.ig_post_text_content (post_id, text_content)
    VALUES (p_post_id, p_text_content)
    RETURNING public.ig_post_text_content.post_id INTO v_post_id;

    RETURN QUERY
        SELECT v_post_id AS post_id;

END;
$$;
