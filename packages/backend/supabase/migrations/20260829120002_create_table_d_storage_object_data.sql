CREATE TABLE d_storage_object_data
(
    storage_object_data_id UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    storage_object_id      UUID        NOT NULL REFERENCES public.d_storage_objects (storage_object_id),
    s3_object_key          TEXT        NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
