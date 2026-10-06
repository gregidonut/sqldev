import { defineMiddleware, sequence } from "astro:middleware";
import { clerkMiddleware } from "@clerk/astro/server";

const preauth = defineMiddleware(async function (_, next) {
    const response = await next();
    return response;
});

const postauth = defineMiddleware(async function (_, next) {
    const response = await next();
    return response;
});

export const onRequest = sequence(preauth, clerkMiddleware(), postauth);
