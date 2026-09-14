import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFamilyForms,
  useGetFamilyPolicies,
  useGetFamilySession,
  useAcknowledgeFamilyPolicy,
  getGetFamilyPoliciesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { FileText, Loader2, PenLine } from "lucide-react";

/**
 * The funeral home's own paperwork, as the family meets it.
 *
 * Nothing on this screen was written by us. Every form here is one the home
 * uploaded or built, reviewed by their own counsel, and chose to put on this
 * case — so the page introduces them as the home's, not as ours.
 *
 * What is deliberately not here is the clock. Colorado gives the home 72
 * hours from taking custody to file a death certificate, and that deadline
 * shapes the order these appear in — but a countdown belongs on a director's
 * screen and nowhere near a widow's. So the urgency arrives as sequence:
 * what the certificate needs is simply at the top.
 */

function stillToAnswer(form: {
  requiredCount: number;
  answeredCount: number;
  complete: boolean;
  authorizationCount: number;
  kind: string;
}): string {
  if (form.kind === "authorization") {
    return form.authorizationCount > 0
      ? "Signed"
      : "Ready for you when you are";
  }

  if (form.complete || form.requiredCount === 0) {
    return form.answeredCount > 0 ? "Nothing left to answer" : "Nothing needed yet";
  }

  const left = form.requiredCount - form.answeredCount;
  return left === 1 ? "One answer still needed" : `${left} answers still needed`;
}

/**
 * The home's standing documents — their privacy notice, their terms.
 *
 * Opening this page records that this person was shown the version they were
 * shown, which is the only thing anybody will want to know about it later.
 * Confirming they have read it is kept separate and is theirs to press:
 * being shown a privacy notice is not agreeing to one.
 */
function Documents() {
  const queryClient = useQueryClient();
  const policies = useGetFamilyPolicies();
  // The name the home already has for them. Asking somebody to type their own
  // name to confirm they have read a privacy notice is a form where a button
  // would do, and the record wants the person, not their typing.
  const session = useGetFamilySession();
  const [reading, setReading] = useState<number | null>(null);

  const acknowledge = useAcknowledgeFamilyPolicy({
    mutation: {
      onSuccess: () =>
        void queryClient.invalidateQueries({
          queryKey: getGetFamilyPoliciesQueryKey(),
        }),
    },
  });

  const rows = policies.data ?? [];
  if (rows.length === 0) return null;

  return (
    <section className="space-y-3 border-t border-border pt-6">
      <div>
        <h2 className="font-display text-lg">From the funeral home</h2>
        <p className="text-sm text-muted-foreground">
          Their own documents, as they stand today. You are welcome to read
          them whenever you want to, and to print them.
        </p>
      </div>

      <ul className="space-y-3">
        {rows.map((policy) => (
          <li key={policy.id} className="rounded-xl border border-border bg-card p-4">
            <p className="font-medium">{policy.title}</p>
            {policy.note && (
              <p className="text-sm text-muted-foreground">{policy.note}</p>
            )}

            {reading === policy.id ? (
              <>
                <p className="mt-3 whitespace-pre-wrap text-sm max-w-prose">
                  {policy.body}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="text-sm underline min-h-11"
                    onClick={() => setReading(null)}
                  >
                    Close it
                  </button>
                  {policy.acknowledgedAt === null && session.data && (
                    <Button
                      variant="outline"
                      className="h-11"
                      disabled={acknowledge.isPending}
                      onClick={() =>
                        acknowledge.mutate({
                          versionId: policy.versionId,
                          data: { name: session.data.contact.name },
                        })
                      }
                    >
                      I have read this
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <button
                type="button"
                className="mt-2 text-sm underline min-h-11"
                onClick={() => setReading(policy.id)}
              >
                Read it
              </button>
            )}

            {policy.acknowledgedAt !== null && (
              <p className="mt-2 text-sm text-muted-foreground">
                You confirmed you had read this on{" "}
                {new Date(policy.acknowledgedAt).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
                .
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Paperwork() {
  const forms = useGetFamilyForms();

  if (forms.isPending) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  const rows = forms.data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl mb-1">Paperwork</h1>
        <p className="text-muted-foreground">
          These are the funeral home's own forms. Answer what you can — each
          one saves as you go, and you can stop and come back.
        </p>
      </header>

      {rows.length === 0 ? (
        /*
         * Never a dead end. The honest answer is that nothing has been sent
         * yet, and the useful one is that it will arrive here rather than
         * somewhere they have to go looking.
         */
        <div className="rounded-xl border border-border bg-card px-4 py-6 text-center">
          <p className="font-medium mb-1">Nothing to fill in yet</p>
          <p className="text-sm text-muted-foreground">
            When the funeral home needs something from you in writing, it will
            appear here. They will usually mention it first.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((form) => {
            const Icon = form.kind === "authorization" ? PenLine : FileText;

            return (
              <li key={form.id}>
                <Link
                  href={`/paperwork/${form.id}`}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-4 min-h-11"
                >
                  <Icon className="size-5 shrink-0 mt-0.5 text-[var(--accent-deep)]" />
                  <span className="min-w-0">
                    <span className="block font-medium">{form.name}</span>
                    {form.note && (
                      <span className="block text-sm text-muted-foreground">
                        {form.note}
                      </span>
                    )}
                    <span className="block text-sm text-muted-foreground mt-0.5">
                      {stillToAnswer(form)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Documents />
    </div>
  );
}
