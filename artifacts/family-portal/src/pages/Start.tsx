import { useEffect, useRef, useState } from "react";
import { useLocation, useRoute } from "wouter";
import {
  useGetPublicHome,
  useSubmitIntakeRequest,
  getGetPublicHomeQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Phone, ArrowLeft, ArrowRight, Check } from "lucide-react";

/**
 * The home's front door: which of the three situations is this, and where
 * does that person go.
 *
 * The three are genuinely different people and the screen says so before it
 * asks anything. Somebody arrives here either holding a link a director
 * texted them, or having found the home themselves after a death, or while
 * perfectly well and thinking ahead. Guessing wrong is not a small error:
 * showing a bereavement screen to someone planning their own funeral is
 * unkind, and burying "I have a link" under a form is how a family who
 * already has one ends up filing a second request.
 *
 * Everything here is unauthenticated, so the copy assumes nothing about who
 * is reading and never implies the home knows them.
 */

type Door = "at_need" | "pre_need" | null;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--background)]">
      {/* A landmark, so a screen reader's "jump to main" lands somewhere. */}
      <main className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16">
        {children}
      </main>
    </div>
  );
}

/**
 * The number, always, and near the top.
 *
 * A form is never the right answer to "my mother has just died". The whole
 * screen exists on the assumption that the telephone is still the fastest way
 * to reach a human, and this product's job is to be honest about that rather
 * than to capture the interaction.
 */
function UrgentLine({
  urgentPhone,
  phone,
}: {
  urgentPhone: string | null;
  phone: string | null;
}) {
  const number = urgentPhone || phone;
  if (!number) return null;

  return (
    <a
      href={`tel:${number.replace(/[^\d+]/g, "")}`}
      className="lift mb-8 flex items-center gap-3.5 rounded-xl border border-[var(--accent)]/25
                 bg-[var(--accent-soft)] px-4 py-4 no-underline shadow-[var(--elevation-1)]
                 transition-gentle hover:border-[var(--accent)]/50"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/70 text-[var(--accent-deep)]">
        <Phone className="size-5" strokeWidth={1.75} />
      </span>
      <span className="text-sm">
        <span className="block font-semibold text-[var(--accent-deep)]">
          If this cannot wait, telephone{" "}
          <span className="tabular">{number}</span>
        </span>
        <span className="mt-0.5 block text-muted-foreground">
          A death in the night, or anything urgent. Someone answers.
        </span>
      </span>
    </a>
  );
}

/*
 * Which door is open lives in the address, not in component state.
 *
 * It used to be state, which made the phone's own back button — the one
 * everybody actually uses — leave the page altogether from half-way down the
 * form, taking whatever had been typed with it, instead of going back to
 * "which of these is you?". As a path segment it is a real step in the
 * history, and the in-page "Back" does the same thing as the phone's.
 */
const DOOR_SEGMENTS: Record<Exclude<Door, null>, string> = {
  at_need: "someone-has-died",
  pre_need: "planning-ahead",
};

function doorFrom(segment: string | undefined): Door {
  if (segment === DOOR_SEGMENTS.at_need) return "at_need";
  if (segment === DOOR_SEGMENTS.pre_need) return "pre_need";
  return null;
}

export default function Start() {
  const [, params] = useRoute("/start/:slug/:door?");
  const [, navigate] = useLocation();
  const slug = params?.slug ?? "";
  const door = doorFrom(params?.door);
  const setDoor = (next: Door) =>
    navigate(
      next === null
        ? `/start/${encodeURIComponent(slug)}`
        : `/start/${encodeURIComponent(slug)}/${DOOR_SEGMENTS[next]}`,
    );
  const [sent, setSent] = useState<{ kind: Door; homeName: string } | null>(null);

  const home = useGetPublicHome(slug, {
    query: {
      queryKey: getGetPublicHomeQueryKey(slug),
      enabled: slug.length > 0,
      // A home's name and telephone number do not change while somebody is
      // reading the page, and a retry storm is the last thing a person on
      // hotel wifi at 2am needs. A 404 is an answer, not a failure, so it is
      // shown at once rather than after a second's pointless retry.
      retry: (count, error) =>
        count < 1 && ((error as { status?: number })?.status ?? 500) >= 500,
    },
  });

  /*
   * The tab says whose page this is. It used to say "Your funeral
   * arrangements" — the portal's title — to somebody who has arranged
   * nothing and is trying to work out whether this is the right home.
   */
  const homeName = home.data?.name;
  useEffect(() => {
    document.title = homeName ?? "Funeral home";
  }, [homeName]);

  if (home.isPending) {
    return (
      <Shell>
        <div
          className="animate-pulse space-y-8"
          role="status"
          aria-label="Loading"
        >
          <div className="space-y-2.5">
            <div className="h-9 w-3/5 rounded-md bg-[var(--muted)]" />
            <div className="h-4 w-2/5 rounded-md bg-[var(--muted)]/70" />
          </div>
          <div className="h-[4.5rem] rounded-xl bg-[var(--muted)]/60" />
          <div className="space-y-3">
            {[0, 1, 2].map((row) => (
              <div key={row} className="h-28 rounded-xl bg-[var(--muted)]/50" />
            ))}
          </div>
        </div>
      </Shell>
    );
  }

  if (home.isError || !home.data) {
    return (
      <Shell>
        <div className="rounded-2xl border border-border bg-card p-7 shadow-[var(--elevation-2)] sm:p-9">
          <h1 className="font-display text-2xl">
            We could not find that funeral home
          </h1>
          <p className="mt-3 text-muted-foreground">
            Please check the address, or go back to the funeral home's own
            website and follow the link from there.
          </p>
        </div>
      </Shell>
    );
  }

  const h = home.data;

  if (sent) {
    return (
      <Shell>
        <div className="text-center">
          <div
            className="mx-auto mb-6 grid size-14 place-items-center rounded-full
                       bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]/15"
          >
            <Check className="size-7 text-[var(--accent-deep)]" strokeWidth={1.75} />
          </div>
          {/* Focused on arrival, so a screen reader says it was sent rather
              than going quiet where the form used to be. */}
          <h1
            ref={(element) => element?.focus()}
            tabIndex={-1}
            className="font-display text-[1.75rem] leading-tight outline-none"
          >
            {h.name} has your message
          </h1>
          <p className="mx-auto mb-8 mt-3 max-w-sm leading-relaxed text-muted-foreground">
            {sent.kind === "at_need"
              ? "Someone will be in touch. If anything cannot wait, please telephone them rather than waiting for a reply here."
              : "There is no hurry, and nothing more for you to do today. Someone will be in touch to talk it through."}
          </p>
          <UrgentLine urgentPhone={h.urgentPhone} phone={h.phone} />
        </div>
      </Shell>
    );
  }

  // Only when the home is actually taking requests: an address typed or
  // bookmarked straight to the form must not bring it back for a home whose
  // form is switched off or not yet confirmed. The server refuses it too, but
  // only after the person has written everything out.
  if (door && h.intakeEnabled) {
    return (
      <Shell>
        <button
          onClick={() => setDoor(null)}
          className="group mb-7 inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground
                     transition-colors duration-200 hover:text-foreground"
        >
          <ArrowLeft className="size-4 transition-transform duration-200 ease-[cubic-bezier(0.2,0.6,0.3,1)] group-hover:-translate-x-0.5" />
          Back
        </button>
        <IntakeForm
          slug={slug}
          kind={door}
          homeName={h.name}
          urgentPhone={h.urgentPhone}
          phone={h.phone}
          onSent={() => setSent({ kind: door, homeName: h.name })}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      {/*
        A masthead rather than a page title. The rule underneath it is doing
        the same job the rule under a letterhead does: it says this is
        somebody's establishment, and what follows is addressed to you.
      */}
      <header className="mb-8 border-b border-border pb-7">
        <h1 className="font-display text-[2rem] leading-tight sm:text-[2.25rem]">
          {h.name}
        </h1>
        {h.storefrontHeadline && (
          <p className="font-display text-lg mt-1.5 text-muted-foreground">
            {h.storefrontHeadline}
          </p>
        )}
        {(h.city || h.addressLine1) && (
          <p className="mt-1.5 text-muted-foreground">
            {[h.addressLine1, h.city, h.region].filter(Boolean).join(", ")}
          </p>
        )}
      </header>

      <UrgentLine urgentPhone={h.urgentPhone} phone={h.phone} />

      {/*
        The home's own words, below the number rather than above it. Someone
        reaching this page an hour after a death needs the telephone first;
        what the home has to say about itself is for the person who has time
        to read it.
      */}
      {h.storefrontAbout && (
        <p className="mb-8 whitespace-pre-wrap text-muted-foreground">
          {h.storefrontAbout}
        </p>
      )}

      <h2 className="font-display text-xl">Which of these is you?</h2>
      <p className="mb-5 mt-1 text-sm text-muted-foreground">
        So we take you to the right place.
      </p>

      <div className="space-y-3">
        {/*
          First, and deliberately. Most people who reach this page already
          have a link and have lost it in their messages; sending them into a
          form would create a second file for the same death.
        */}
        <DoorCard
          title="I was sent a link"
          body="The funeral home texted or emailed you a link. Open it from that
                message and it will remember you — there is nothing to sign in to."
          footnote="Can't find it? Telephone them and they will send another."
        />

        {h.intakeEnabled ? (
          <>
            <DoorCard
              title="Someone has died, and I need to start"
              body="Nobody has sent you anything yet. Tell them who you are and
                    who has died, and they will open a file and send you the link."
              onClick={() => setDoor("at_need")}
              actionLabel="Start"
            />
            <DoorCard
              title="I am planning my own funeral, in advance"
              body="Nobody has died. You are thinking ahead and writing down what
                    you want — the photographs, the music, the words — so that
                    nobody has to guess later."
              onClick={() => setDoor("pre_need")}
              actionLabel="Start"
            />
          </>
        ) : (
          <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]">
            <p className="mb-1 font-semibold">Starting something new</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {h.name} would rather you telephoned for a first conversation,
              whether that is because of a death or because you are planning
              ahead.{" "}
              {/*
                A home that has just registered may not have put a number in
                yet, and "their number is above" over no number is a dead end
                for somebody an hour after a death.
              */}
              {h.urgentPhone || h.phone
                ? "Their number is above."
                : "Their telephone number will be on their own website, or on anything they have sent you."}
            </p>
          </div>
        )}
      </div>

      <Policies policies={h.policies} />
    </Shell>
  );
}

/**
 * What the home says the same way to everyone.
 *
 * Last on the page, and collapsed, because nobody arrives here to read a
 * policy — they arrive to reach a person. It earns its place for the person
 * who comes back on day three wanting to know when the balance is due and
 * would otherwise have to ring and ask.
 */
function Policies({
  policies,
}: {
  policies: Array<{ id: number; title: string; body: string }>;
}) {
  if (policies.length === 0) return null;

  return (
    <section className="mt-10 border-t border-border pt-7">
      <h2 className="font-display text-lg mb-3">Things people ask</h2>
      <div className="space-y-2">
        {policies.map((policy) => (
          <details
            key={policy.id}
            className="rounded-lg border border-border px-4 py-3 [&_summary]:cursor-pointer"
          >
            <summary className="font-medium">{policy.title}</summary>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-snug text-muted-foreground">
              {policy.body}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}

/**
 * One of the three doors.
 *
 * Where there is somewhere to go, the whole card is the button — not a small
 * "Start" in the corner of a paragraph. Somebody reading this at 2am after a
 * death should not have to aim.
 *
 * The first card has no action at all and is not pretending to: no hover, no
 * arrow, nothing to click. It is an instruction to go and look in their
 * messages, and dressing it as a button would send them somewhere useless.
 */
function DoorCard({
  title,
  body,
  footnote,
  onClick,
  actionLabel,
}: {
  title: string;
  body: string;
  footnote?: string;
  onClick?: () => void;
  actionLabel?: string;
}) {
  const inner = (
    <>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
      {footnote && (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {footnote}
        </p>
      )}
    </>
  );

  if (!onClick) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]">
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="lift group w-full rounded-xl border border-border bg-card p-5 text-left
                 shadow-[var(--elevation-1)] transition-gentle
                 hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--border))]
                 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
    >
      {inner}
      <span className="mt-3.5 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--accent-deep)]">
        {actionLabel}
        <ArrowRight className="size-4 transition-transform duration-200 ease-[cubic-bezier(0.2,0.6,0.3,1)] group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}

/**
 * The two forms, which are the same fields wearing very different words.
 *
 * The at-need form is answered by someone who may not have slept. It asks the
 * fewest things that let a director ring back: who you are, how to reach you,
 * who died. Everything else can wait for the conversation.
 *
 * The pre-need form is answered at leisure by someone who is well. It says so
 * out loud, because the single worst thing this product could do is make a
 * healthy person planning ahead feel as though it is treating them as dead.
 */
function IntakeForm({
  slug,
  kind,
  homeName,
  urgentPhone,
  phone,
  onSent,
}: {
  slug: string;
  kind: "at_need" | "pre_need";
  homeName: string;
  urgentPhone: string | null;
  phone: string | null;
  onSent: () => void;
}) {
  const preNeed = kind === "pre_need";

  const [requesterName, setRequesterName] = useState("");
  const [requesterPhone, setRequesterPhone] = useState("");
  const [requesterEmail, setRequesterEmail] = useState("");
  const [relationship, setRelationship] = useState("");
  const [subjectFirstName, setSubjectFirstName] = useState("");
  const [subjectLastName, setSubjectLastName] = useState("");
  const [note, setNote] = useState("");

  const sending = useRef(false);
  const submit = useSubmitIntakeRequest({
    mutation: {
      onSuccess: onSent,
      // A refusal (a limit, a typo the server caught) leaves the form open
      // to correct and send again.
      onError: () => {
        sending.current = false;
      },
    },
  });

  const reachable =
    requesterPhone.trim().length > 0 || requesterEmail.trim().length > 0;

  // On a pre-need form the person is the subject, so their own name fills both.
  const subjectFirst = preNeed ? requesterName.trim().split(/\s+/)[0] ?? "" : subjectFirstName;
  const subjectLast = preNeed
    ? requesterName.trim().split(/\s+/).slice(1).join(" ")
    : subjectLastName;

  const emailLooksWrong =
    requesterEmail.trim().length > 0 &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail.trim());

  const ready =
    requesterName.trim().length > 0 &&
    reachable &&
    !emailLooksWrong &&
    subjectFirst.length > 0 &&
    subjectLast.length > 0;

  /*
   * What is still needed, said in words, once somebody has tried to send.
   *
   * The button used to stay greyed out until the form was complete, with no
   * word about why. For most people the missing piece was obvious; for the
   * one planning ahead who typed a single name ("Cher", or a first name
   * alone) it never was — the plan needs a last name, the form split it off
   * a single word as empty, and the only thing on the screen was a button
   * that would not press. A disabled button also cannot be reached by a
   * screen reader's tab order, so it could not even say that it was there.
   */
  const [tried, setTried] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  const missing: Array<{ field: string; text: string }> = [];
  if (!requesterName.trim()) {
    missing.push({ field: "requesterName", text: "your name" });
  } else if (preNeed && !subjectLast) {
    missing.push({
      field: "requesterName",
      text: "your last name as well as your first, so the plan is in your full name",
    });
  }
  if (!reachable) {
    missing.push({ field: "requesterPhone", text: "a telephone number or an email address" });
  }
  if (emailLooksWrong) {
    missing.push({
      field: "requesterEmail",
      text: "an email address written like name@example.com",
    });
  }
  if (!preNeed && !subjectFirstName.trim()) {
    missing.push({ field: "subjectFirstName", text: "the first name of the person who has died" });
  }
  if (!preNeed && !subjectLastName.trim()) {
    missing.push({ field: "subjectLastName", text: "their last name" });
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        // A ref rather than `isPending`, which only re-renders the button
        // disabled after the second of a double tap has already landed —
        // and put the same death in a director's queue twice.
        if (sending.current) return;
        if (!ready) {
          setTried(true);
          // Next frame, so the summary exists to be read out.
          requestAnimationFrame(() => summary.current?.focus());
          return;
        }

        sending.current = true;
        submit.mutate({
          data: {
            homeSlug: slug,
            kind,
            requesterName: requesterName.trim(),
            requesterPhone: requesterPhone.trim() || null,
            requesterEmail: requesterEmail.trim() || null,
            relationship: preNeed ? null : relationship.trim() || null,
            subjectFirstName: subjectFirst,
            subjectLastName: subjectLast,
            dateOfDeath: null,
            note: note.trim() || null,
          },
        });
      }}
    >
      <h1 className="font-display text-[1.75rem] leading-tight">
        {preNeed ? "Planning ahead" : "Starting with " + homeName}
      </h1>
      <p className="mb-7 mt-2 leading-relaxed text-muted-foreground">
        {preNeed
          ? "A few details so someone can get in touch. Nothing here is a commitment, and nothing is decided today."
          : "Just enough for someone to ring you back. Everything else can wait until you have spoken to them."}
      </p>

      {!preNeed && <UrgentLine urgentPhone={urgentPhone} phone={phone} />}

      <div className="space-y-5">
        <div>
          <Label htmlFor="requesterName">Your full name</Label>
          <Input
            className="mt-2"
            id="requesterName"
            value={requesterName}
            onChange={(event) => setRequesterName(event.target.value)}
            autoComplete="name"
            required
          />
          {preNeed && (
            <p className="mt-1.5 text-sm text-muted-foreground">
              This is the name the plan will be in.
            </p>
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="requesterPhone">Telephone</Label>
            <Input
              className="mt-2"
              id="requesterPhone"
              type="tel"
              value={requesterPhone}
              onChange={(event) => setRequesterPhone(event.target.value)}
              autoComplete="tel"
            />
          </div>
          <div>
            <Label htmlFor="requesterEmail">Email</Label>
            <Input
              className="mt-2"
              id="requesterEmail"
              type="email"
              value={requesterEmail}
              onChange={(event) => setRequesterEmail(event.target.value)}
              autoComplete="email"
            />
          </div>
        </div>
        {!reachable && (
          <p className="-mt-2 text-sm text-muted-foreground">
            One of the two, so they can reach you.
          </p>
        )}

        {!preNeed && (
          <>
            <div className="border-t border-border pt-5">
              <p className="eyebrow mb-3.5">Who has died</p>
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <Label htmlFor="subjectFirstName">First name</Label>
                  <Input
                    className="mt-2"
                    id="subjectFirstName"
                    value={subjectFirstName}
                    onChange={(event) => setSubjectFirstName(event.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="subjectLastName">Last name</Label>
                  <Input
                    className="mt-2"
                    id="subjectLastName"
                    value={subjectLastName}
                    onChange={(event) => setSubjectLastName(event.target.value)}
                    required
                  />
                </div>
              </div>
            </div>
            <div>
              <Label htmlFor="relationship">They were your</Label>
              <Input
                className="mt-2"
                id="relationship"
                value={relationship}
                onChange={(event) => setRelationship(event.target.value)}
                placeholder="Mother, husband, brother…"
              />
            </div>
          </>
        )}

        <div>
          <Label htmlFor="note">
            {preNeed
              ? "Anything you would like them to know (optional)"
              : "Anything else they should know (optional)"}
          </Label>
          <Textarea
            id="note"
            className="mt-2"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={4}
            maxLength={4000}
          />
        </div>
      </div>

      {tried && missing.length > 0 && (
        <div
          ref={summary}
          tabIndex={-1}
          role="alert"
          className="mt-7 rounded-xl border border-border bg-[var(--sunken)] px-4 py-3.5 text-sm leading-relaxed"
        >
          <p className="font-semibold">Before this can go, we still need:</p>
          <ul className="mt-1.5 list-disc pl-5 text-muted-foreground">
            {missing.map((item) => (
              <li key={item.text}>
                <a
                  href={`#${item.field}`}
                  className="underline decoration-[var(--accent)]/40 underline-offset-4"
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(item.field)?.focus();
                  }}
                >
                  {item.text}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button
        type="submit"
        size="lg"
        className="mt-7 w-full"
        disabled={submit.isPending}
      >
        {submit.isPending && <Loader2 className="size-4 animate-spin" />}
        Send this to {homeName}
      </Button>

      <p className="mt-5 border-l-2 border-[var(--accent)]/30 pl-4 text-sm leading-relaxed text-muted-foreground">
        This goes to {homeName} and to nobody else. It is not a public notice,
        and nothing is published anywhere.
      </p>
    </form>
  );
}
