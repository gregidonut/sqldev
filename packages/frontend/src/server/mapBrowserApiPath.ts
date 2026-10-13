/**
 * Maps a browser-facing `/api/**` pathname to the upstream Go API pathname.
 *
 * The only rewrite is the exact, case-sensitive mapping of `/api/renderMd` to
 * the public Go operation at `/renderMd`. Every other pathname — including
 * trailing-slash, case, sibling, and child variants — is returned unchanged so
 * unrelated `/api/**` routes keep forwarding to the same upstream path.
 */
export function mapBrowserApiPath(pathname: string): string {
    return pathname === "/api/renderMd" ? "/renderMd" : pathname;
}
