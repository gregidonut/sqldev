import React, {Suspense, lazy} from 'react';

const FormSection = lazy(() => import('./FormSection'));
const FilesSection = lazy(() => import('./FilesSection'));


export default function FileUploadSection(): React.JSX.Element {
    return (
        <section className="min-w-60 rounded-md p-1 border-[0.2rem] border-drac-selection flex-col-start">
            <header className="pb-5 flex-row-start">
                <h2>FileUploadSection</h2>
            </header>
            <main className="flex w-full flex-col items-start justify-start gap-2.5">
                <Suspense fallback={<div>Loading...</div>}>
                    <FormSection/>
                </Suspense>
                <Suspense fallback={<div>Loading...</div>}>
                    <FilesSection/>
                </Suspense>
            </main>
        </section>
    );
}