CREATE TABLE d_storage_object_config
(
    storage_object_config_id UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    storage_object_id        UUID        NOT NULL REFERENCES public.d_storage_objects (storage_object_id),
    public                   BOOLEAN     NOT NULL DEFAULT FALSE
);
