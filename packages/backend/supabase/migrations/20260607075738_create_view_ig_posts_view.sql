CREATE VIEW ig_posts_view
    WITH (security_invoker = on)
AS
SELECT p.post_id
     , u.user_id
     , u.clerk_user_id
     , p.created_at
     , latest.created_at AS updated_at
     , latest.text_content
     , latest.text_content_html
FROM ig_posts AS p
         INNER JOIN LATERAL (
    SELECT ptc.created_at, ptc.text_content, ptc.text_content_html
    FROM ig_post_text_content AS ptc
    WHERE ptc.post_id = p.post_id
    ORDER BY ptc.created_at DESC
    LIMIT 1
    ) AS latest ON TRUE
         INNER JOIN LATERAL (
    SELECT r.user_id
    FROM ig_posts_roles AS r
    WHERE r.post_id = p.post_id
      AND r.role = 'owner'
    LIMIT 1
    ) AS owner_role ON TRUE
         INNER JOIN users AS u
                    ON u.user_id = owner_role.user_id
ORDER BY p.created_at DESC;