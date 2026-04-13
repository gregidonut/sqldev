CREATE VIEW ig_posts_view AS
SELECT p.post_id, p.user_id, u.clerk_user_id, p.created_at, latest.created_at AS updated_at, latest.text_content
FROM ig_posts AS p
         INNER JOIN LATERAL (
    SELECT ptc.created_at, ptc.text_content
    FROM ig_post_text_content AS ptc
    WHERE ptc.post_id = p.post_id
    ORDER BY ptc.created_at DESC
    LIMIT 1
    ) AS latest ON TRUE
         INNER JOIN users AS u
                    ON p.user_id = u.user_id
ORDER BY p.created_at DESC;
