export function cy(attr: string) {
    return (
        ["dev"].includes(import.meta.env.PUBLIC_APP_STAGE) && {
            "data-cy": attr,
        }
    );
}
