import { useGetFamilyPrintItems } from "@workspace/api-client-react";
import { Check, FileCheck, Printer } from "lucide-react";
import { Empty, Loading, PageHeader } from "@/components/page";
import { useAuthedPrintUrl } from "@/hooks/use-authed-print-url";

/**
 * Proofs the funeral home has shared.
 *
 * There is one job on this screen and it is spelling. The most common reason
 * cards get reprinted is a misspelled name — usually a grandchild's, in a
 * list nobody outside the family could check — and the family is the only
 * party who can catch it. So the ask is specific rather than "does this look
 * alright": read the names.
 *
 * Shown as the real rendered card rather than a description, because a
 * summary is not something you can proofread. The frame around it is
 * deliberately plain and deliberately white: this is the only place in the
 * portal where the product's own styling would get in the way of judging how
 * something will look on paper.
 */
function ProofItem({ item }: { item: { id: number; title: string | null; templateName: string; status: string } }) {
  const title = item.title ?? item.templateName;
  const { src, isPending, isError } = useAuthedPrintUrl(item.id);

  return (
    <li>
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <p className="font-semibold">{title}</p>
        {item.status === "approved" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--accent-deep)]">
            <Check className="size-3" />
            Approved
          </span>
        )}
      </div>

      {/*
        A hair of extra elevation and a white mount, so the proof reads as a
        sheet of paper sitting on the page rather than as another panel of
        the website.
      */}
      <div className="overflow-hidden rounded-xl border border-[var(--border-strong)] bg-white shadow-[var(--elevation-2)]">
        {src ? (
          // Sandboxed: an object URL is same-origin with the portal, so
          // without this the card would run with the family's token in
          // reach. It is a picture of a card; it needs to run nothing.
          <iframe title={title} src={src} sandbox="" className="h-[30rem] w-full" />
        ) : (
          <div
            role="img"
            aria-label={isError ? `${title} (could not be shown)` : title}
            aria-busy={isPending || undefined}
            className={`h-[30rem] w-full bg-[var(--muted)] ${isPending ? "animate-pulse" : ""}`}
          />
        )}
      </div>

      {src && (
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="mt-2.5 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--accent-deep)] decoration-[var(--accent)]/40 underline-offset-4 hover:decoration-[var(--accent)]"
        >
          <Printer className="size-4" />
          Open it full size
        </a>
      )}
    </li>
  );
}

export default function Proofs() {
  const items = useGetFamilyPrintItems();

  if (items.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="Things to check" />
        <Loading rows={2} />
      </div>
    );
  }

  const rows = items.data ?? [];

  return (
    <div className="space-y-7">
      <PageHeader title="Things to check">
        Please read the names carefully — spellings are the one thing we can't
        check for you. Tell your director if anything is wrong.
      </PageHeader>

      {rows.length === 0 ? (
        <Empty icon={FileCheck} title="Nothing to check at the moment">
          When the funeral home has a card, a booklet or an order of service
          ready, it will appear here for you to read before it is printed.
        </Empty>
      ) : (
        <ul className="space-y-8">
          {rows.map((item) => (
            <ProofItem key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}
