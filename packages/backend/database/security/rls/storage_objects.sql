DROP POLICY IF EXISTS
    objects_select_policy ON storage.objects;
CREATE POLICY objects_select_policy
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
    ((SELECT auth.jwt() ->> 'sub') = (owner_id)::TEXT)
    );


DROP POLICY IF EXISTS
    objects_insert_policy ON storage.objects;
CREATE POLICY objects_insert_policy
    ON storage.objects
    AS PERMISSIVE
    FOR INSERT
    TO authenticated
    WITH CHECK (
    ((SELECT auth.jwt() ->> 'sub') = (owner_id)::TEXT)
    );

DROP POLICY IF EXISTS
    objects_update_policy ON storage.objects;
CREATE POLICY objects_update_policy
    ON storage.objects
    AS PERMISSIVE
    FOR UPDATE
    TO authenticated
    USING (
    ((SELECT auth.jwt() ->> 'sub') = (owner_id)::TEXT)
    );

DROP POLICY IF EXISTS
    objects_delete_policy ON storage.objects;
CREATE POLICY objects_delete_policy
    ON storage.objects
    AS PERMISSIVE
    FOR DELETE
    TO authenticated
    USING (
    ((SELECT auth.jwt() ->> 'sub') = (owner_id)::TEXT)
    );


