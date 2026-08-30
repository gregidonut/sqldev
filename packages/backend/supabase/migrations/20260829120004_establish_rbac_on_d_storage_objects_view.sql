CREATE TYPE D_STORAGE_OBJECTS_ROLE AS ENUM ('owner', 'viewer', 'editor');

CREATE TYPE D_STORAGE_OBJECTS_PERMISSION AS ENUM (
    'd_storage_objects.read',
    'd_storage_objects.write',
    'd_storage_objects.create',
    'd_storage_objects.delete'
    );

CREATE TABLE d_storage_objects_permissions
(
    d_storage_objects_permission_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role                            D_STORAGE_OBJECTS_ROLE       NOT NULL,
    permission                      D_STORAGE_OBJECTS_PERMISSION NOT NULL,
    UNIQUE (role, permission)
);

INSERT INTO d_storage_objects_permissions (role, permission)
VALUES ('viewer', 'd_storage_objects.read')

     , ('editor', 'd_storage_objects.read')
     , ('editor', 'd_storage_objects.write')

     , ('owner', 'd_storage_objects.read')
     , ('owner', 'd_storage_objects.write')
     , ('owner', 'd_storage_objects.create')
     , ('owner', 'd_storage_objects.delete');

CREATE TABLE d_storage_objects_roles
(
    storage_object_role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at             TIMESTAMPTZ      DEFAULT NOW()                                          NOT NULL,
    storage_object_id      UUID REFERENCES d_storage_objects (storage_object_id) ON DELETE CASCADE NOT NULL,
    user_id                UUID REFERENCES users (user_id) ON DELETE CASCADE                       NOT NULL,
    role                   D_STORAGE_OBJECTS_ROLE                                                  NOT NULL,
    UNIQUE (storage_object_id, user_id, role)
);

CREATE OR REPLACE FUNCTION authorize_d_storage_object(
    p_requested_user_id UUID
, p_requested_permission D_STORAGE_OBJECTS_PERMISSION
, p_requested_storage_object_id UUID
)
    RETURNS BOOLEAN
AS
$$
DECLARE
    v_user_role_for_d_storage_object public.D_STORAGE_OBJECTS_ROLE;
BEGIN
    SELECT role
    INTO v_user_role_for_d_storage_object
    FROM public.d_storage_objects_roles
    WHERE user_id = p_requested_user_id
      AND storage_object_id = p_requested_storage_object_id;

    RETURN EXISTS (SELECT 1
                   FROM public.d_storage_objects_permissions
                   WHERE role = v_user_role_for_d_storage_object
                     AND permission = p_requested_permission);
END
$$ LANGUAGE plpgsql STABLE
                    SECURITY DEFINER
                    SET search_path = '';
