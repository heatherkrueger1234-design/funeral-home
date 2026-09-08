/**
 * Static files live in `public/`, which Vite serves under the configured base
 * path. Hard-coding a leading slash would break the moment the app is served
 * from anywhere but the domain root.
 */
export function asset(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${base}/${path.replace(/^\//, "")}`;
}

/**
 * A full page load back to the root.
 *
 * Signing in and out are the two moments where every cached query belongs to
 * the wrong person. Clearing the cache in place invites races — the session
 * query can settle before or after the clear, and the app either stalls on
 * the form it just submitted or briefly shows the previous account's data. A
 * reload has neither failure mode, and at these two moments it costs nothing.
 */
export function reloadToHome(): void {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  window.location.assign(`${base}/`);
}
