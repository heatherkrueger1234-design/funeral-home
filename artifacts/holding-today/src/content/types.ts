import type { Relationship } from "./relationships";

/**
 * The shape of the written guides.
 *
 * These pages are the part of this site that has to be right. They are read by
 * someone deciding, today, whether to view their child's body, or whether they
 * are allowed to say no to embalming, or whether the thing they are feeling
 * means something is wrong with them. So the content lives here as data rather
 * than as markup, for three reasons:
 *
 * 1. A block model can carry things prose cannot — a deadline attached to a
 *    task, the state a law applies in. Rendering can then be honest about each
 *    of those rather than flattening them into a paragraph.
 * 2. Every legal statement has to name the state it is true in. Making `state`
 *    a required field on the block that carries law means it cannot be
 *    forgotten in a paragraph somewhere.
 * 3. A funeral director reviewing the body and autopsy chapters for accuracy
 *    should be able to read them without reading React.
 */

export type Block =
  | { kind: "p"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] }
  /**
   * A task with a window that closes. The window is the whole point — a lock
   * of hair is a different decision on day one than on day four.
   */
  | { kind: "checklist"; items: { text: string; deadline: string }[] }
  /**
   * Anything whose truth depends on where you live. `state` is required, and
   * is rendered as a visible tag, so a reader in Ohio is never quietly told
   * Colorado's law.
   */
  | { kind: "law"; state: string; text: string }
  /** Something to be careful with, or warned about before reading on. */
  | { kind: "warn"; text: string }
  /** A quiet aside. Permission, usually. */
  | { kind: "note"; text: string };

export type Chapter = {
  /** URL fragment. Stable — these get linked to and shared. */
  id: string;
  title: string;
  /**
   * Who this chapter was written for, when it was written for someone
   * specific. Omitted means universal, which most chapters genuinely are — an
   * autopsy, a death certificate and a landlord do not care who died.
   *
   * This only ever reorders and labels. A tagged chapter is still shown to
   * everybody, because grief is layered and nobody's loss is only one thing.
   */
  relationships?: Relationship[];
  /**
   * One line, shown collapsed. It should say what the chapter is actually
   * about, plainly, so nobody has to open a chapter to find out whether it is
   * the one they cannot read today.
   */
  summary: string;
  body: Block[];
};

export type ChapterGroup = {
  heading: string;
  /** Optional line under the group heading. */
  blurb?: string;
  chapters: Chapter[];
};
