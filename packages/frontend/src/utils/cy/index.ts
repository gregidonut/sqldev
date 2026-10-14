export function cy(attr: string) {
  return (
    ["dev", "staging"].includes(import.meta.env.PUBLIC_APP_STAGE) && {
      "data-cy": attr,
    }
  );
}
