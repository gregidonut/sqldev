ALTER TABLE d_storage_object_data
    ENABLE ROW LEVEL SECURITY;

CREATE
    POLICY d_storage_object_data_select_policy
    ON d_storage_object_data
    FOR
    SELECT
    TO authenticated
    USING (
    public.authorize_d_storage_object(
            (SELECT user_id
             FROM public.get_owner())
        , 'd_storage_objects.read'
        , d_storage_object_data.storage_object_id)
    );

CREATE
    POLICY d_storage_object_data_insert_policy
    ON d_storage_object_data
    AS PERMISSIVE
    FOR INSERT
    TO authenticated
    WITH CHECK (
    public.authorize_d_storage_object(
            (SELECT user_id
             FROM public.get_owner())
        , 'd_storage_objects.write'
        , d_storage_object_data.storage_object_id)
    );
