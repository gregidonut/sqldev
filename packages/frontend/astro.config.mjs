// @ts-check
import { defineConfig } from "astro/config";
import compressor from "astro-compressor";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import aws from "astro-sst";
import clerk from "@clerk/astro";
import { neobrutalism } from "@clerk/themes";

// https://astro.build/config
export default defineConfig({
    integrations: [
        compressor(),
        react(),
        clerk({
            appearance: {
                theme: [neobrutalism],
            },
        }),
    ],
    output: "server",

    adapter: aws({
        responseMode: "stream",
    }),

    vite: {
        plugins: [
            // @ts-ignore
            tailwindcss(),
        ],
    },
});
