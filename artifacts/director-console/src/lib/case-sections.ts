/**
 * The case page's tabs and the four sections they are grouped into.
 */
export const TABS = [
  "family",
  "photos",
  "vitals",
  "belongings",
  "obituary",
  "service",
  "print",
  "book",
  "timeline",
  "messages",
  "details",
  "data",
] as const;

export type Tab = (typeof TABS)[number];

/**
 * Twelve tabs in a row read as a wall. Grouped into the four things a
 * director is doing on a case; the URL still names the tab.
 */
export const SECTIONS: ReadonlyArray<{ key: string; label: string; tabs: readonly Tab[] }> = [
  { key: "family", label: "Family", tabs: ["family", "messages", "timeline"] },
  { key: "service", label: "The service", tabs: ["service", "photos", "obituary", "print", "belongings"] },
  { key: "paperwork", label: "Paperwork", tabs: ["vitals", "details", "data"] },
  { key: "after", label: "Afterwards", tabs: ["book"] },
];

export const TAB_LABELS: Record<Tab, string> = {
  family: "People",
  photos: "Photos",
  vitals: "Certificate",
  belongings: "Belongings",
  obituary: "Obituary",
  service: "Service",
  print: "Print",
  book: "Memory book",
  timeline: "Timeline",
  messages: "Messages",
  details: "Key facts",
  data: "Export and erase",
};

