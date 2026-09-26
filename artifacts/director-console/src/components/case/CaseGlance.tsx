import type { ComponentType } from "react";
import {
  useGetCasePhotos,
  useGetDeadlines,
  useGetObituary,
  useGetPrintItems,
  useGetVitals,
} from "@workspace/api-client-react";
import {
  CalendarClock,
  ClipboardList,
  FileText,
  Images,
  MessageSquare,
  Printer,
} from "lucide-react";

/**
 * Where a case stands, before any tab is opened.
 *
 * A case has eleven tabs, and the question a director opens it with is
 * nearly always the same: what is waiting on me, and what is waiting on the
 * family? Answering it used to mean clicking through every one of them. This
 * is that answer in one row, each tile saying the state in words and opening
 * the tab it describes.
 *
 * Built from the same queries the tabs use, so opening a tab after reading
 * this is instant rather than a second fetch — and it adds nothing to the
 * API a tab does not already ask for.
 *
 * Three tones only. "Yours" is something the director has to act on; "done"
 * is settled; everything else is plain. A strip where every tile is shouting
 * is a strip nobody reads.
 */

type Tone = "yours" | "done" | "plain";

interface Tile {
  tab: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  state: string;
  tone: Tone;
}

function toneClasses(tone: Tone): string {
  return tone === "yours"
    ? "border-[var(--notice)]/35 bg-[var(--notice-soft)]"
    : tone === "done"
      ? "border-[var(--accent)]/25 bg-[var(--accent-soft)]"
      : "border-border bg-card";
}

export function CaseGlance({
  caseId,
  unreadFamilyMessages,
  onOpen,
}: {
  caseId: number;
  unreadFamilyMessages: number;
  onOpen: (tab: string) => void;
}) {
  const photos = useGetCasePhotos(caseId);
  const obituary = useGetObituary(caseId);
  const vitals = useGetVitals(caseId);
  const print = useGetPrintItems(caseId);
  const deadlines = useGetDeadlines(caseId);

  const tiles: Tile[] = [];

  {
    const all = (photos.data ?? []).filter((photo) => photo.status === "visible");
    const chosen = all.filter((photo) => photo.selected).length;
    tiles.push({
      tab: "photos",
      icon: Images,
      label: "Photographs",
      state: photos.isPending
        ? "…"
        : all.length === 0
          ? "None yet"
          : chosen > 0
            ? `${all.length} in · ${chosen} chosen`
            : `${all.length} in, none chosen`,
      tone: "plain",
    });
  }

  {
    const status = obituary.data?.status;
    tiles.push({
      tab: "obituary",
      icon: FileText,
      label: "Obituary",
      state: obituary.isPending
        ? "…"
        : status === "approved"
          ? "Approved"
          : status === "submitted"
            ? "Sent by the family — read it"
            : "The family is writing",
      tone: status === "submitted" ? "yours" : status === "approved" ? "done" : "plain",
    });
  }

  {
    const data = vitals.data;
    const missing = data?.missingForFiling?.length ?? 0;
    tiles.push({
      tab: "vitals",
      icon: ClipboardList,
      label: "Certificate",
      state: vitals.isPending
        ? "…"
        : data?.status === "verified"
          ? "Checked and ready to file"
          : data?.status === "submitted"
            ? missing > 0
              ? `Sent · ${missing} still missing`
              : "Sent by the family — check it"
            : missing > 0
              ? `${missing} still missing`
              : "Being filled in",
      tone:
        data?.status === "submitted"
          ? "yours"
          : data?.status === "verified"
            ? "done"
            : "plain",
    });
  }

  {
    const items = print.data ?? [];
    const changes = items.filter((item) => item.changesRequestedAt !== null).length;
    const waiting = items.filter(
      (item) => item.status === "proof" && item.sharedWithFamily,
    ).length;
    const approved = items.filter((item) => item.status === "approved").length;
    tiles.push({
      tab: "print",
      icon: Printer,
      label: "Print",
      state: print.isPending
        ? "…"
        : items.length === 0
          ? "Nothing started"
          : changes > 0
            ? `${changes === 1 ? "A change" : `${changes} changes`} asked for`
            : waiting > 0
              ? `${waiting} with the family to check`
              : `${approved} of ${items.length} approved`,
      tone:
        changes > 0
          ? "yours"
          : items.length > 0 && approved === items.length
            ? "done"
            : "plain",
    });
  }

  {
    const open = (deadlines.data ?? []).filter(
      (entry) => !entry.isEvent && entry.completedAt === null,
    );
    const now = Date.now();
    const late = open.filter((entry) => new Date(entry.dueAt).getTime() < now).length;
    tiles.push({
      tab: "timeline",
      icon: CalendarClock,
      label: "Timeline",
      state: deadlines.isPending
        ? "…"
        : late > 0
          ? `${late} past due`
          : open.length > 0
            ? `${open.length} still to do`
            : "Nothing outstanding",
      tone: late > 0 ? "yours" : open.length === 0 ? "done" : "plain",
    });
  }

  tiles.push({
    tab: "messages",
    icon: MessageSquare,
    label: "Messages",
    state:
      unreadFamilyMessages > 0
        ? `${unreadFamilyMessages} new from the family`
        : "Nothing new",
    tone: unreadFamilyMessages > 0 ? "yours" : "plain",
  });

  return (
    <section aria-label="Where this case stands">
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((tile) => (
          <li key={tile.tab}>
            <button
              type="button"
              onClick={() => onOpen(tile.tab)}
              className={`lift h-full w-full rounded-xl border px-3.5 py-3 text-left shadow-[var(--elevation-1)] transition-gentle hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--border))] ${toneClasses(tile.tone)}`}
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <tile.icon className="size-3.5" strokeWidth={1.75} />
                {tile.label}
              </span>
              <span
                className={`mt-1 block text-sm leading-snug ${
                  tile.tone === "yours"
                    ? "font-semibold text-foreground"
                    : tile.tone === "done"
                      ? "text-[var(--accent-deep)]"
                      : "text-foreground"
                }`}
              >
                {tile.state}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
