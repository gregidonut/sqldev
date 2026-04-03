CREATE POLICY objects_select_policy
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
    (auth.jwt() ->> 'role'::TEXT = 'authenticated')
    );

CREATE POLICY objects_insert_policy
    ON storage.objects
    AS PERMISSIVE
    FOR INSERT
    TO authenticated
    WITH CHECK (
    (auth.jwt() ->> 'role'::TEXT = 'authenticated')
    );

CREATE POLICY objects_update_policy
    ON storage.objects
    AS PERMISSIVE
    FOR UPDATE
    TO authenticated
    USING (
    (auth.jwt() ->> 'role'::TEXT = 'authenticated')
    );

CREATE POLICY objects_delete_policy
    ON storage.objects
    AS PERMISSIVE
    FOR DELETE
    TO authenticated
    USING (
    (auth.jwt() ->> 'role'::TEXT = 'authenticated')
    );


