/**
 * The layouts a funeral home actually orders.
 *
 * Sizes are the trade's, not invented: a prayer card is 2.5 x 4.25 inches
 * because that is what card stock is guillotined to and what the plastic
 * sleeves fit; a folded program is a letter sheet folded once. Getting these
 * wrong by an eighth of an inch is how two hundred cards come back trimmed
 * through somebody's mother's face.
 *
 * Each template declares **named slots**, not coordinates. A director chooses
 * which template and what goes in the slots; they never choose where things
 * sit. That is the difference between this and a drag-and-drop canvas, and it
 * is the whole reason the output is reliable — nobody can nudge the name 3mm
 * into the fold at nine at night before an eleven o'clock service.
 */

export type SlotKind = "text" | "longText" | "photo" | "date";

export type TemplateSlot = {
  key: string;
  label: string;
  kind: SlotKind;
  /** Shown under the field, in the words a director would use. */
  hint?: string;
  /** Filled from the case unless the director types over it. */
  from?: "decedentName" | "dates" | "serviceLine" | "portrait";
  /** Roughly what fits before it stops looking like a card. */
  maxLength?: number;
};

export type PrintTemplate = {
  key: string;
  name: string;
  /** What it is for, in a sentence a director would recognise. */
  description: string;
  /** Finished size in inches, after trimming. */
  width: number;
  height: number;
  /** Panels, for anything folded. One means a flat card. */
  panels: number;
  /** How many fit on a letter sheet, for the printer conversation. */
  perSheet: number;
  slots: TemplateSlot[];
};

const NAME_SLOT: TemplateSlot = {
  key: "name",
  label: "Name",
  kind: "text",
  from: "decedentName",
  maxLength: 60,
};

const DATES_SLOT: TemplateSlot = {
  key: "dates",
  label: "Dates",
  kind: "text",
  from: "dates",
  hint: "Filled in from the case. Type over it if you'd rather.",
  maxLength: 60,
};

const PHOTO_SLOT: TemplateSlot = {
  key: "photo",
  label: "Photograph",
  kind: "photo",
  from: "portrait",
  hint: "Defaults to the portrait chosen for this case.",
};

export const PRINT_TEMPLATES: readonly PrintTemplate[] = [
  {
    key: "prayer-card",
    name: "Prayer card",
    description:
      "The card handed out at the service. Photograph on the front, a verse on the back.",
    width: 2.5,
    height: 4.25,
    panels: 2,
    perSheet: 8,
    slots: [
      PHOTO_SLOT,
      NAME_SLOT,
      DATES_SLOT,
      {
        key: "verse",
        label: "Verse or reading",
        kind: "longText",
        hint: "Pick one from your snippets, or type it here.",
        maxLength: 600,
      },
      {
        key: "closing",
        label: "Closing line",
        kind: "text",
        hint: "Often the funeral home's name.",
        maxLength: 80,
      },
    ],
  },
  {
    key: "bookmark",
    name: "Bookmark",
    description:
      "Taller than a prayer card and kept for longer. Good for a longer poem.",
    width: 2,
    height: 6,
    panels: 1,
    perSheet: 8,
    slots: [
      PHOTO_SLOT,
      NAME_SLOT,
      DATES_SLOT,
      {
        key: "verse",
        label: "Poem or verse",
        kind: "longText",
        maxLength: 900,
      },
    ],
  },
  {
    key: "program-folded",
    name: "Order of service",
    description:
      "A letter sheet folded once: cover, the order inside, and a closing page.",
    width: 5.5,
    height: 8.5,
    panels: 4,
    perSheet: 1,
    slots: [
      PHOTO_SLOT,
      NAME_SLOT,
      DATES_SLOT,
      {
        key: "serviceLine",
        label: "Service details",
        kind: "text",
        from: "serviceLine",
        hint: "Filled in from the case.",
        maxLength: 160,
      },
      {
        key: "order",
        label: "The order of service",
        kind: "longText",
        hint:
          "One item per line. Hymns, readings and who is speaking come through from the Service tab.",
        maxLength: 2000,
      },
      {
        key: "bearers",
        label: "Pallbearers",
        kind: "longText",
        hint: "Also filled in from the Service tab.",
        maxLength: 500,
      },
      {
        key: "thanks",
        label: "A word of thanks",
        kind: "longText",
        hint: "What the family would like to say to everyone who came.",
        maxLength: 800,
      },
      {
        key: "reception",
        label: "Afterwards",
        kind: "text",
        hint: "Where people are going next.",
        maxLength: 200,
      },
    ],
  },
  {
    key: "program-single",
    name: "Order of service — single sheet",
    description: "Everything on one side. Quicker, and cheaper to reprint.",
    width: 5.5,
    height: 8.5,
    panels: 1,
    perSheet: 2,
    slots: [
      PHOTO_SLOT,
      NAME_SLOT,
      DATES_SLOT,
      {
        key: "serviceLine",
        label: "Service details",
        kind: "text",
        from: "serviceLine",
        maxLength: 160,
      },
      {
        key: "order",
        label: "The order of service",
        kind: "longText",
        maxLength: 1400,
      },
    ],
  },
  {
    key: "register-page",
    name: "Register book page",
    description: "The heading page for the book people sign as they arrive.",
    width: 8.5,
    height: 11,
    panels: 1,
    perSheet: 1,
    slots: [
      PHOTO_SLOT,
      NAME_SLOT,
      DATES_SLOT,
      {
        key: "serviceLine",
        label: "Service details",
        kind: "text",
        from: "serviceLine",
        maxLength: 160,
      },
    ],
  },
  {
    key: "thank-you",
    name: "Thank-you card",
    description:
      "Sent afterwards. Folded, with the message inside and room to sign.",
    width: 4.25,
    height: 5.5,
    panels: 2,
    perSheet: 4,
    slots: [
      PHOTO_SLOT,
      NAME_SLOT,
      {
        key: "message",
        label: "Message",
        kind: "longText",
        hint: "Left blank below the message so it can be signed by hand.",
        maxLength: 600,
      },
    ],
  },
];

export function findTemplate(key: string): PrintTemplate | undefined {
  return PRINT_TEMPLATES.find((template) => template.key === key);
}
