import { useId, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFamilyRelatives,
  useGetFamilySession,
  useInviteFamilyRelative,
  getGetFamilyRelativesQueryKey,
  type FamilyRelativeInvited,
} from "@workspace/api-client-react";
import { Check, Copy, Loader2, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Divider, Empty, Loading, PageHeader, Panel } from "@/components/page";
import { useToast } from "@/hooks/use-toast";
import { plainError } from "@/lib/memory-book";

/**
 * Passing the link on.
 *
 * The brother in Ohio wants to add photographs, and the sister holding the
 * link should not have to ring the funeral home to ask for him to be sent
 * one. This is the screen that lets her give him his own — his own name on
 * what he adds, and a link the home can stop for him without stopping hers.
 *
 * Only offered to somebody the home has allowed to do it (the next of kin,
 * by default); for anybody else the hub never links here, and arriving by
 * address says, kindly, to ask the home.
 *
 * The link is texted or emailed straight to the relative. Only when neither
 * could go is it shown here, once, to copy — the same "shown once, never
 * again" rule the director's console follows, because the link is the key.
 */

function LinkOnce({ result }: { result: FamilyRelativeInvited }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const link = result.link!;
  const phone = result.relative.phone;

  return (
    <div
      role="status"
      className="rounded-xl border border-[var(--accent)]/40 bg-[var(--accent-soft)] p-4"
    >
      <p className="font-semibold text-[var(--accent-deep)]">
        Here is {result.relative.name}'s link
      </p>
      <p className="mt-1 text-sm leading-relaxed text-[var(--accent-deep)]/85">
        We couldn't send it from here, so please pass it on yourself. It's only
        shown this once, and it's theirs alone — it opens this page as them.
      </p>
      <div className="mt-3 flex gap-2">
        <Input
          readOnly
          value={link}
          aria-label={`${result.relative.name}'s link`}
          className="bg-white font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              toast({
                title: "Couldn't copy that",
                description: "Press and hold the link to copy it instead.",
                variant: "destructive",
              });
            }
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {/* On a phone, the quickest way: straight into their messages app. */}
      {phone && (
        <a
          href={`sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(link)}`}
          className="mt-3 inline-block text-sm font-semibold text-[var(--accent-deep)] underline decoration-[var(--accent)]/40 underline-offset-4"
        >
          Open it in your messages
        </a>
      )}
    </div>
  );
}

function sentLine(result: FamilyRelativeInvited): string {
  const { relative, sentBySms, sentByEmail } = result;
  if (sentBySms && sentByEmail) {
    return `We've sent ${relative.name} their link by text and by email.`;
  }
  if (sentBySms) return `We've texted ${relative.name} their link.`;
  return `We've emailed ${relative.name} their link.`;
}

export default function Family() {
  const id = useId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const session = useGetFamilySession();
  const relatives = useGetFamilyRelatives();

  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<FamilyRelativeInvited | null>(null);

  // Set synchronously, so a double tap cannot send two before the button's
  // disabled state has had a chance to render.
  const inFlight = useRef(false);

  const invite = useInviteFamilyRelative({
    mutation: {
      meta: { inlineErrors: true },
      onSettled: () => {
        inFlight.current = false;
      },
      onSuccess: (created) => {
        setResult(created);
        setName("");
        setRelationship("");
        setPhone("");
        setEmail("");
        setProblem(null);
        void queryClient.invalidateQueries({
          queryKey: getGetFamilyRelativesQueryKey(),
        });
        if (created.link === null) {
          toast({ title: "Sent", description: sentLine(created) });
        }
      },
      onError: (error) => setProblem(plainError(error)),
    },
  });

  if (relatives.isPending || session.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="Family" />
        <Loading rows={2} />
      </div>
    );
  }

  const data = relatives.data;
  const homeName = session.data?.home.name ?? "The funeral home";

  if (!data?.canInvite) {
    return (
      <div className="space-y-6">
        <PageHeader title="Family" />
        <Empty icon={Users} title="Ask the funeral home to add someone">
          {homeName} can send a link to anyone else in the family who would
          like to help. Just let them know who, and how to reach them.
        </Empty>
        <div className="text-center">
          <Link
            href="/messages"
            className="text-sm font-semibold text-[var(--accent-deep)] underline decoration-[var(--accent)]/40 underline-offset-4"
          >
            Send them a message
          </Link>
        </div>
      </div>
    );
  }

  const full = data.remaining <= 0;
  const trimmedName = name.trim();
  const reachable = phone.trim() !== "" || email.trim() !== "";

  return (
    <div className="space-y-6">
      <PageHeader title="Family">
        Anyone you add gets their own private link to this page, so they can
        add photographs and memories under their own name. {homeName} will see
        who you've added.
      </PageHeader>

      {result?.link && <LinkOnce result={result} />}
      {result && !result.link && (
        <p
          role="status"
          className="flex items-start gap-2.5 rounded-xl border border-border bg-[var(--sunken)] px-4 py-3 text-sm leading-relaxed"
        >
          <Check className="mt-0.5 size-4 shrink-0 text-[var(--accent-deep)]" />
          {sentLine(result)}
        </p>
      )}

      {full ? (
        <Panel>
          <p className="font-semibold">That's as many as we can add from here</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {homeName} can add anyone else — just let them know who.
          </p>
        </Panel>
      ) : (
        <Panel>
          <form
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (inFlight.current) return;
              // The second half of a double tap, landing after the first had
              // already succeeded and cleared the form: not a mistake to
              // scold anybody about underneath their success.
              if (result && !trimmedName && !relationship.trim() && !reachable) return;
              if (!trimmedName) {
                setProblem("Please give their name.");
                return;
              }
              if (!reachable) {
                setProblem(
                  "Please add a mobile number or an email address, so their link has somewhere to go.",
                );
                return;
              }
              setResult(null);
              setProblem(null);
              inFlight.current = true;
              invite.mutate({
                data: {
                  name: trimmedName,
                  relationship: relationship.trim() || null,
                  phone: phone.trim() || null,
                  email: email.trim() || null,
                },
              });
            }}
          >
            <h2 className="font-display text-lg">Add someone</h2>

            <div>
              <Label htmlFor={`${id}-name`}>Their name</Label>
              <Input
                id={`${id}-name`}
                className="mt-2"
                autoComplete="off"
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div>
              <Label htmlFor={`${id}-relationship`}>
                How they're related (if you like)
              </Label>
              <Input
                id={`${id}-relationship`}
                className="mt-2"
                placeholder="Brother, granddaughter, old friend"
                autoComplete="off"
                value={relationship}
                maxLength={60}
                onChange={(event) => setRelationship(event.target.value)}
              />
            </div>

            <div>
              <Label htmlFor={`${id}-phone`}>Their mobile number</Label>
              <Input
                id={`${id}-phone`}
                className="mt-2 tabular"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={phone}
                maxLength={40}
                aria-describedby={`${id}-reach`}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>

            <div>
              <Label htmlFor={`${id}-email`}>Their email address</Label>
              <Input
                id={`${id}-email`}
                className="mt-2"
                type="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                maxLength={254}
                aria-describedby={`${id}-reach`}
                onChange={(event) => setEmail(event.target.value)}
              />
              <p id={`${id}-reach`} className="mt-1.5 text-sm text-muted-foreground">
                Either one is enough.
              </p>
            </div>

            {problem && (
              <p role="alert" className="text-sm text-[var(--destructive)]">
                {problem}
              </p>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={invite.isPending}>
              {invite.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <UserPlus className="size-4" />
              )}
              Send them a link
            </Button>
          </form>
        </Panel>
      )}

      {data.relatives.length > 0 && (
        <section className="space-y-3">
          <Divider label="Added by you" />
          <ul className="space-y-2">
            {data.relatives.map((relative) => (
              <li
                key={relative.id}
                className="rounded-xl border border-border bg-card px-4 py-3 shadow-[var(--elevation-1)]"
              >
                <p className="font-semibold">
                  {relative.name}
                  {relative.relationship && (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · {relative.relationship}
                    </span>
                  )}
                </p>
                {/* Whether the link landed, so nobody has to wonder. */}
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {relative.revoked
                    ? `${homeName} has closed this link`
                    : relative.firstSeenAt
                      ? "Has opened their link"
                      : "Hasn't opened their link yet"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
