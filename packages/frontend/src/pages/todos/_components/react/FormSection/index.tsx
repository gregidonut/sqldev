import React, { Suspense, lazy } from "react";

const FormSection = lazy(() => import("./FormSection.tsx"));

export default function LazyLoadedFormSection({
    onSuccess,
}: {
    onSuccess?: () => void;
}) {
    return (
        <Suspense fallback={<p>Loading...</p>}>
            <FormSection onSuccess={onSuccess} />
        </Suspense>
    );
}
