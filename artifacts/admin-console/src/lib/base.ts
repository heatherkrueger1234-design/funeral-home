/**
 * Where this app is mounted, without the trailing slash: "" at the root of its
 * own hostname (the Docker deployment), or e.g. "/console" when it shares one
 * hostname with the other front ends (the Replit deployment). Vite sets it
 * from `BASE_PATH` at build time.
 *
 * In-app navigation gets it through wouter's `<Router base>`; anything that
 * builds a URL by hand — a full-page redirect, a return address handed to
 * Stripe — has to add it itself.
 */
export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/+$/, "");
