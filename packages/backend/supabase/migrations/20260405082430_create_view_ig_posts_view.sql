CREATE VIEW ig_posts_view AS
(
SELECT p.post_id, p.user_id, u.clerk_user_id, p.created_at, MAX(ptc.created_at) AS updated_at, ptc.text_content
FROM ig_posts AS p
         INNER JOIN ig_post_text_content AS ptc
                    ON p.post_id = ptc.post_id
         INNER JOIN users AS u
                    ON p.user_id = u.user_id
GROUP BY p.post_id, p.user_id, u.clerk_user_id, p.created_at, ptc.text_content
ORDER BY p.created_at DESC
    );
