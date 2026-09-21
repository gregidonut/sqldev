export function textValue(value: unknown) {
    return typeof value === "string" ? value : "";
}
