/*
 * Screenshots of the real product, taken with Playwright against a running
 * stack seeded through the API with an invented funeral home (Juniper Ridge),
 * invented families, and generated landscape pictures standing in for their
 * photographs. Nobody in them is real. The files are in public/screens/.
 *
 * Width and height are the intrinsic size of the largest file, so the browser
 * reserves the right box before any of them arrive and nothing on the page
 * moves when they do.
 */

export type Screen = {
  name: string;
  alt: string;
  width: number;
  height: number;
  sizes: number[];
};

const desk = (name: string, alt: string): Screen => ({
  name,
  alt,
  width: 1600,
  height: 1012,
  sizes: [960, 1600],
});

const phone = (name: string, alt: string): Screen => ({
  name,
  alt,
  width: 600,
  height: 1298,
  sizes: [390, 600],
});

export const screens = {
  consoleToday: desk(
    "console-today",
    "The director console's Today page for Juniper Ridge Funeral Home: three families waiting on a reply, one task past due, and this week's three services with their times and places.",
  ),
  consolePhotos: desk(
    "console-photos",
    "A case's Photographs tab in the console: nine chosen of twelve in the bin, a Download the pack button, and each photograph with its caption and who sent it.",
  ),
  consoleMessages: desk(
    "console-messages",
    "A case's message thread in the console: a daughter's question, the director's reply, and a note from her brother, all in one conversation.",
  ),
  consoleInbox: desk(
    "console-inbox",
    "The console's Messages page: every family in one list, the two waiting on a reply first, the answered one below.",
  ),
  familyHub: phone(
    "family-hub",
    "The family portal on a phone, headed with Juniper Ridge Funeral Home's own name and monogram: the service date and place, what is due next, and the things the family can do.",
  ),
  familyPhotos: phone(
    "family-photos",
    "The family portal's Photographs page on a phone: nine chosen for the slideshow, a Choose photographs button, and each picture with its caption.",
  ),
  familyMessages: phone(
    "family-messages",
    "The family portal's message thread on a phone, late at night: a note says the message will be waiting and the director reads messages from 8:30 AM, with the 24-hour number beneath.",
  ),
  familyTimeline: phone(
    "family-timeline",
    "The family portal's What's due page on a phone: three tasks ticked off by the director, one still to do, and the service itself shown as an event rather than a task.",
  ),
  familyAftercare: phone(
    "family-aftercare",
    "The family portal asking whether the funeral home may check in: the four actual dates listed, a Yes, please button and a No, thank you button of the same size.",
  ),
};

export const srcSet = (screen: Screen) =>
  screen.sizes.map((w) => `/screens/${screen.name}-${w}.webp ${w}w`).join(", ");

export const src = (screen: Screen) =>
  `/screens/${screen.name}-${screen.sizes[screen.sizes.length - 1]}.webp`;
