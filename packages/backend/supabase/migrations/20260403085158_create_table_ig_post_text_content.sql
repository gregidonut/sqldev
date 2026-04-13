CREATE TABLE ig_post_text_content
(
    post_content_id UUID PRIMARY KEY                            DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ                        NOT NULL DEFAULT NOW(),
    post_id         UUID REFERENCES ig_posts (post_id) NOT NULL,
    text_content    TEXT
);

ALTER TABLE ig_post_text_content
    ENABLE ROW LEVEL SECURITY;

CREATE POLICY ig_post_text_content_select_policy
    ON ig_post_text_content
    FOR SELECT
    TO authenticated
    USING (
    (auth.jwt() ->> 'role'::TEXT = 'authenticated')
    );

CREATE POLICY ig_post_text_content_insert_policy
    ON ig_post_text_content
    AS PERMISSIVE
    FOR INSERT
    TO authenticated
    WITH CHECK (
    (SELECT auth.jwt() ->> 'sub'::TEXT) = (SELECT u.clerk_user_id
                                           FROM ig_posts AS p
                                                    INNER JOIN users AS u
                                                               ON u.user_id = p.user_id
                                           WHERE p.post_id = ig_post_text_content.post_id)
    );
