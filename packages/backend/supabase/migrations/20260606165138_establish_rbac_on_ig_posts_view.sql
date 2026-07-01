CREATE TYPE IG_POSTS_ROLE AS ENUM ('owner', 'viewer', 'editor');

CREATE TYPE IG_POSTS_PERMISSION AS ENUM (
    'ig_posts.read',
    'ig_posts.write',
    'ig_posts.create',
    'ig_posts.delete'
    );

CREATE TABLE ig_posts_permissions
(
    ig_posts_permission_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role                   IG_POSTS_ROLE       NOT NULL,
    permission             IG_POSTS_PERMISSION NOT NULL,
    UNIQUE (role, permission)
);

INSERT INTO ig_posts_permissions (role, permission)
VALUES ('viewer', 'ig_posts.read')

     , ('editor', 'ig_posts.read')
     , ('editor', 'ig_posts.write')

     , ('owner', 'ig_posts.read')
     , ('owner', 'ig_posts.write')
     , ('owner', 'ig_posts.create')
     , ('owner', 'ig_posts.delete');

CREATE TABLE ig_posts_roles
(
    post_role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ      DEFAULT NOW()                       NOT NULL,
    post_id      UUID REFERENCES ig_posts (post_id) ON DELETE CASCADE NOT NULL,
    user_id      UUID REFERENCES users (user_id) ON DELETE CASCADE    NOT NULL,
    role         IG_POSTS_ROLE                                        NOT NULL,
    UNIQUE (post_id, user_id, role)
);

CREATE OR REPLACE FUNCTION authorize_ig_post(
    p_requested_user_id UUID
, p_requested_permission IG_POSTS_PERMISSION
, p_requested_post_id UUID
)
    RETURNS BOOLEAN
AS
$$
DECLARE
    v_user_role_for_post public.IG_POSTS_ROLE;
BEGIN
    SELECT role
    INTO v_user_role_for_post
    FROM public.ig_posts_roles
    WHERE user_id = p_requested_user_id
      AND post_id = p_requested_post_id;

    RETURN EXISTS (SELECT 1
                   FROM public.ig_posts_permissions
                   WHERE role = v_user_role_for_post
                     AND permission = p_requested_permission);
END
$$ LANGUAGE plpgsql STABLE
                    SECURITY DEFINER
                    SET search_path = '';
