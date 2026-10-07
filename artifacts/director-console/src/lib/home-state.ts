/**
 * Whether a home is in Colorado, from whatever was typed into its State
 * field.
 *
 * The same reading the server gives `region` when it sets the certificate
 * clock (lib/db, `homeStateCode`): free text, so "CO", "co" and "Colorado"
 * all mean Colorado, and a blank means Colorado too, because it is the only
 * market this is sold in and every new home's clock is already set to
 * Denver. A home that has said it is somewhere else is believed. Kept in
 * step by hand rather than imported: the schema package is the server's.
 */
export function homeIsInColorado(region: string | null | undefined): boolean {
  const typed = (region ?? "").trim().toUpperCase();
  return typed === "" || typed === "CO" || typed === "COLORADO";
}
