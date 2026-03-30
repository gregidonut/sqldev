import React from 'react';
import {$authStore} from "@clerk/astro/client";
import {useStore} from "@nanostores/react";
import {
    QueryClient,
    QueryClientProvider,
    useQuery,
} from "@tanstack/react-query";
import {ReactQueryDevtools} from "@tanstack/react-query-devtools";
import {queryFn} from "./queryFn"
import PhotoList from "./PhotoList.tsx";


function FilesSection(): React.JSX.Element {
    const {userId} = useStore($authStore);
    const {
            data,
            isLoading,
            isError,
            error,
        } = useQuery({
                queryKey: [
                    "get",
                    "igPostAttachments",
                    {
                        userId,
                    },
                ],
                queryFn: queryFn,
            }
        )
    ;
    if (isLoading) {
        return <p>loading...</p>;
    }
    if (isError) {
        return <p>{error.message}</p>;
    }
    if (!data || data.length === 0) {
        return <p>no tickets yet..</p>;
    }

    return (
        <section className="w-auto rounded-md p-1 border-[0.2rem] border-drac-selection">
            <header className="pb-5">
                <h2>Files</h2>
            </header>
            <PhotoList images={data.map((item) => ({
                ...item,
                id: item.name,
                userId,
            }))}/>
        </section>
    );
}

export default function FilesSectionWrapper(): React.JSX.Element {
    const queryClient = new QueryClient();
    return (
        <QueryClientProvider client={queryClient}>
            <ReactQueryDevtools initialIsOpen={false}/>
            <FilesSection/>
        </QueryClientProvider>
    );
}
