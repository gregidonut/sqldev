CREATE OR REPLACE VIEW ig_posts_view
AS
SELECT p.post_id
     , u.user_id
     , u.clerk_user_id
     , p.created_at
     , ltc.created_at AS updated_at
     , ltc.text_content
     , ltc.text_content_html
     , lpc.public
FROM public.ig_posts AS p
         INNER JOIN LATERAL (
    SELECT ptc.created_at, ptc.text_content, ptc.text_content_html
    FROM public.ig_post_text_content AS ptc
    WHERE ptc.post_id = p.post_id
    ORDER BY ptc.created_at DESC
    LIMIT 1
    ) AS ltc ON TRUE
         INNER JOIN LATERAL (
    SELECT pc.public
    FROM public.ig_post_config AS pc
    WHERE pc.post_id = p.post_id
    ORDER BY pc.created_at DESC
    LIMIT 1
    ) AS lpc ON TRUE
         INNER JOIN LATERAL (
    SELECT r.user_id
    FROM public.ig_posts_roles AS r
    WHERE r.post_id = p.post_id
      AND r.role = 'owner'
    LIMIT 1
    ) AS owner_role ON TRUE
         INNER JOIN public.users AS u
                    ON u.user_id = owner_role.user_id
WHERE lpc.public = TRUE
   OR public.authorize_ig_post((SELECT go.user_id FROM public.get_owner() AS go)
    , 'ig_posts.read'
    , p.post_id)
ORDER BY p.created_at DESC;
