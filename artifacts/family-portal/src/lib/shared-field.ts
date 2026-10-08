/**
 * A box several relatives may be typing into at once.
 *
 * The obituary is answered a field at a time by different people on
 * different phones, and the portal keeps pulling the latest copy down. The
 * question is what the box should show when the server's text changes
 * underneath it. The rule: never take away what somebody is typing, and
 * never put back over an edit the server has not confirmed yet.
 */

export type SharedField = {
  /** What the box shows. */
  draft: string;
  /** The server's text the box last agreed with, seeded or saved. */
  agreed: string;
};

/**
 * What the box shows once the server's copy of the field has changed.
 *
 * - If the server now holds exactly what the box shows, the save landed (or
 *   the two were always the same) and the box simply agrees with it.
 * - While the box has focus, or shows an edit the server has not confirmed
 *   (so one still in flight, or one that failed), it is left alone.
 * - Otherwise the newer text is shown, which is what a sister who filled in
 *   "Survived by" on her own phone would expect her brother to see.
 */
export function takeServerText(
  field: SharedField,
  server: string,
  focused: boolean,
): SharedField {
  if (server === field.draft) return { draft: server, agreed: server };
  if (focused || field.draft !== field.agreed) return field;
  return { draft: server, agreed: server };
}
