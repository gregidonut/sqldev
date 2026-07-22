CREATE TYPE TDS_TODO_SPACES_ROLE AS ENUM ('owner', 'viewer', 'editor');

CREATE TYPE TDS_TODO_SPACES_PERMISSION AS ENUM (
    'tds_todo_spaces.read',
    'tds_todo_spaces.write',
    'tds_todo_spaces.create',
    'tds_todo_spaces.delete'
    );

CREATE TABLE tds_todo_spaces_permissions
(
    tds_todo_spaces_permission_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role                          TDS_TODO_SPACES_ROLE       NOT NULL,
    permission                    TDS_TODO_SPACES_PERMISSION NOT NULL,
    UNIQUE (role, permission)
);

INSERT INTO tds_todo_spaces_permissions (role, permission)
VALUES ('viewer', 'tds_todo_spaces.read')

     , ('editor', 'tds_todo_spaces.read')
     , ('editor', 'tds_todo_spaces.write')

     , ('owner', 'tds_todo_spaces.read')
     , ('owner', 'tds_todo_spaces.write')
     , ('owner', 'tds_todo_spaces.create')
     , ('owner', 'tds_todo_spaces.delete');

CREATE TABLE tds_todo_spaces_roles
(
    post_role_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at    TIMESTAMPTZ      DEFAULT NOW()                                    NOT NULL,
    todo_space_id UUID REFERENCES tds_todo_spaces (todo_space_id) ON DELETE CASCADE NOT NULL,
    user_id       UUID REFERENCES users (user_id) ON DELETE CASCADE                 NOT NULL,
    role          TDS_TODO_SPACES_ROLE                                              NOT NULL,
    UNIQUE (todo_space_id, user_id, role)
);

CREATE OR REPLACE FUNCTION authorize_tds_todo_space(
    p_requested_user_id UUID
, p_requested_permission TDS_TODO_SPACES_PERMISSION
, p_requested_todo_space_id UUID
)
    RETURNS BOOLEAN
AS
$$
DECLARE
    v_user_role_for_tds_todo_space public.TDS_TODO_SPACES_ROLE;
BEGIN
    SELECT role
    INTO v_user_role_for_tds_todo_space
    FROM public.tds_todo_spaces_roles
    WHERE user_id = p_requested_user_id
      AND todo_space_id = p_requested_todo_space_id;

    RETURN EXISTS (SELECT 1
                   FROM public.tds_todo_spaces_permissions
                   WHERE role = v_user_role_for_tds_todo_space
                     AND permission = p_requested_permission);
END
$$ LANGUAGE plpgsql STABLE
                    SECURITY DEFINER
                    SET search_path = '';
