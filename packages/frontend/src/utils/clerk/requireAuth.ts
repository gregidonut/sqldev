import type { APIContext } from "astro";

export function requirePageAuth(context: APIContext): Response | undefined {
    const { userId, redirectToSignIn } = context.locals.auth();
    if (!userId) return redirectToSignIn();
}

export function requireApiAuth(context: APIContext): Response | undefined {
    const { userId } = context.locals.auth();
    if (!userId) {
        return new Response(JSON.stringify({ message: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }
}
