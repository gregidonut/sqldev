import React, { Suspense, lazy } from "react";
import { useStore } from "@nanostores/react";
import { $userStore } from "@clerk/astro/client";

const FormSection = lazy(() => import("./FormSection"));

export default function PostArea() {
    const user = useStore($userStore);
    if (user === undefined) return <p>Loading...</p>;

    return (
        <section className="flex-row-start">
            <figure className="relative border-2 border-drac-comment rounded-sm w-1/4 flex-col-center max-h-40 aspect-square">
                <img
                    src={user?.imageUrl}
                    alt="User Avatar"
                    className="object-contain w-full h-full rounded-sm"
                />
                <figcaption className="absolute bottom-[-0.8rem] left-1 bg-drac-background p-1 rounded-sm text-xs">
                    @{user?.username}
                </figcaption>
            </figure>
            <Suspense fallback={<p>Loading...</p>}>
                <FormSection />
            </Suspense>
        </section>
    );
}
