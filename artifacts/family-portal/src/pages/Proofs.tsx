import { useGetFamilyPrintItems } from "@workspace/api-client-react";
import { Loader2, Printer } from "lucide-react";

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
 * summary is not something you can proofread.
 */
export default function Proofs() {
  const items = useGetFamilyPrintItems();

  if (items.isPending) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  const rows = items.data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl mb-1">Things to check</h1>
        <p className="text-muted-foreground">
          Please read the names carefully — spellings are the one thing we
          can't check for you. Tell your director if anything is wrong.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-12 text-center text-muted-foreground">
          Nothing to check at the moment.
        </p>
      ) : (
        <ul className="space-y-6">
          {rows.map((item) => (
            <li key={item.id} className="space-y-2">
              <div className="flex items-center gap-2">
                <p className="font-medium">{item.title ?? item.templateName}</p>
                {item.status === "approved" && (
                  <span className="text-sm text-muted-foreground">
                    · approved
                  </span>
                )}
              </div>

              <div className="overflow-hidden rounded-xl border border-border bg-white">
                <iframe
                  title={item.title ?? item.templateName}
                  src={`/api/print/${item.id}/render`}
                  className="h-[30rem] w-full"
                />
              </div>

              <a
                href={`/api/print/${item.id}/render`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-[var(--accent-deep)] underline"
              >
                <Printer className="size-4" />
                Open it full size
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
