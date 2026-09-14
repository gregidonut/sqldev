import React from "react";
import { useStore } from "@nanostores/react";
import { $userStore } from "@clerk/astro/client";
import FormSection from "./FormSection";

export default function PostArea() {
    const user = useStore($userStore);

    return (
        <section className="flex-row-start">
            <figure className="relative border-2 border-drac-comment rounded-sm w-1/4 flex-col-center max-h-40 aspect-square">
                {user === undefined ? (
                    <p>Loading...</p>
                ) : (
                    <>
                        <img
                            src={user?.imageUrl}
                            alt="User Avatar"
                            className="object-contain w-full h-full rounded-sm"
                        />
                        <figcaption className="absolute bottom-[-0.8rem] left-1 bg-drac-background p-1 rounded-sm text-xs">
                            @{user?.username}
                        </figcaption>
                    </>
                )}
            </figure>
            <FormSection />
        </section>
    );
}
