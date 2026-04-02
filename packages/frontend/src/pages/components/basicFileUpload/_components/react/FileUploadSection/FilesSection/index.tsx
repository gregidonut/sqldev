import React from 'react';
import {$authStore} from "@clerk/astro/client";
import {useStore} from "@nanostores/react";
import {
    useQuery,
} from "@tanstack/react-query";
import {queryFn} from "./queryFn.ts"
import PhotoList from "./PhotoList.tsx";


export default function FilesSection(): React.JSX.Element {
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
                enabled: !!userId,
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
            <PhotoList images={data.map((item: any) => ({
                ...item,
                id: item.name,
                userId,
            }))}/>
        </section>
    );
}

