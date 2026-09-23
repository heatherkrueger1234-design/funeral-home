/**
 * Where this app is mounted, without a trailing slash: "" when it owns its
 * own hostname (the Docker deployment), "/family" when it shares one with the
 * console (Replit, where one domain is split by path).
 *
 * Vite bakes BASE_PATH into `import.meta.env.BASE_URL` at build time. The
 * router takes this as its base, so every `<Link href="/photos">` resolves
 * under it; this constant is for the few places that touch the address bar
 * directly and would otherwise send a family to the console's front page.
 */
export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/+$/, "");
