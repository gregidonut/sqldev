import React, {Suspense, lazy} from 'react';
import {
    QueryClient,
    QueryClientProvider,
} from "@tanstack/react-query";
import {ReactQueryDevtools} from "@tanstack/react-query-devtools";

const FormSection = lazy(() => import('./FormSection.tsx'));
const FilesSection = lazy(() => import('./FilesSection'));


export default function FileUploadSection(): React.JSX.Element {
    const queryClient = new QueryClient();
    return (
        <section className="min-w-60 rounded-md p-1 border-[0.2rem] border-drac-selection flex-col-start">
            <header className="pb-5 flex-row-start">
                <h2>FileUploadSection</h2>
            </header>
            <main className="flex w-full flex-col items-start justify-start gap-2.5">
                <QueryClientProvider client={queryClient}>
                    <ReactQueryDevtools initialIsOpen={false}/>
                    <Suspense fallback={<div>Loading...</div>}>
                        <FormSection/>
                    </Suspense>
                    <Suspense fallback={<div>Loading...</div>}>
                        <FilesSection/>
                    </Suspense>
                </QueryClientProvider>
            </main>
        </section>
    );
}