ALTER TABLE ig_post_text_content
    ENABLE ROW LEVEL SECURITY;

CREATE
    POLICY ig_post_text_content_select_policy
    ON ig_post_text_content
    FOR
    SELECT
    TO authenticated
    USING (
    public.authorize_ig_post(
            (SELECT user_id
             FROM public.get_owner())
        , 'ig_posts.read'
        , ig_post_text_content.post_id)
    );

CREATE
    POLICY ig_post_text_content_insert_policy
    ON ig_post_text_content
    AS PERMISSIVE
    FOR INSERT
    TO authenticated
    WITH CHECK (
    public.authorize_ig_post(
            (SELECT user_id
             FROM public.get_owner())
        , 'ig_posts.write'
        , ig_post_text_content.post_id)
    );
