import { useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetPublicHome,
  useSubmitIntakeRequest,
  getGetPublicHomeQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Phone, ArrowLeft, Check } from "lucide-react";

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
      <div className="mx-auto w-full max-w-xl px-5 py-10 sm:py-14">{children}</div>
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
      className="flex items-center gap-3 rounded-lg border border-[var(--accent)]/30
                 bg-[var(--accent-soft)] px-4 py-3 mb-8 hover:bg-[var(--accent-soft)]/70"
    >
      <Phone className="size-5 text-[var(--accent-deep)] shrink-0" />
      <span className="text-sm">
        <span className="block font-medium text-[var(--accent-deep)]">
          If this cannot wait, telephone {number}
        </span>
        <span className="block text-muted-foreground">
          A death in the night, or anything urgent. Someone answers.
        </span>
      </span>
    </a>
  );
}

export default function Start() {
  const [, params] = useRoute("/start/:slug");
  const slug = params?.slug ?? "";
  const [door, setDoor] = useState<Door>(null);
  const [sent, setSent] = useState<{ kind: Door; homeName: string } | null>(null);

  const home = useGetPublicHome(slug, {
    query: {
      queryKey: getGetPublicHomeQueryKey(slug),
      enabled: slug.length > 0,
      // A home's name and telephone number do not change while somebody is
      // reading the page, and a retry storm is the last thing a person on
      // hotel wifi at 2am needs.
      retry: 1,
    },
  });

  if (home.isPending) {
    return (
      <Shell>
        <Loader2 className="size-6 animate-spin mx-auto text-muted-foreground" />
      </Shell>
    );
  }

  if (home.isError || !home.data) {
    return (
      <Shell>
        <h1 className="font-display text-2xl mb-3">
          We could not find that funeral home
        </h1>
        <p className="text-muted-foreground">
          Please check the address, or go back to the funeral home's own
          website and follow the link from there.
        </p>
      </Shell>
    );
  }

  const h = home.data;

  if (sent) {
    return (
      <Shell>
        <div className="text-center">
          <div
            className="mx-auto mb-5 grid size-12 place-items-center rounded-full
                       bg-[var(--accent-soft)]"
          >
            <Check className="size-6 text-[var(--accent-deep)]" />
          </div>
          <h1 className="font-display text-2xl mb-3">
            {h.name} has your message
          </h1>
          <p className="text-muted-foreground mb-8">
            {sent.kind === "at_need"
              ? "Someone will be in touch. If anything cannot wait, please telephone them rather than waiting for a reply here."
              : "There is no hurry, and nothing more for you to do today. Someone will be in touch to talk it through."}
          </p>
          <UrgentLine urgentPhone={h.urgentPhone} phone={h.phone} />
        </div>
      </Shell>
    );
  }

  if (door) {
    return (
      <Shell>
        <button
          onClick={() => setDoor(null)}
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground
                     hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back
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
      <header className="mb-8">
        <h1 className="font-display text-3xl leading-tight">{h.name}</h1>
        {(h.city || h.addressLine1) && (
          <p className="text-muted-foreground mt-1">
            {[h.addressLine1, h.city, h.region].filter(Boolean).join(", ")}
          </p>
        )}
      </header>

      <UrgentLine urgentPhone={h.urgentPhone} phone={h.phone} />

      <h2 className="font-display text-xl mb-1">Which of these is you?</h2>
      <p className="text-muted-foreground text-sm mb-5">
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
          <div className="rounded-lg border p-4">
            <p className="font-medium mb-1">Starting something new</p>
            <p className="text-sm text-muted-foreground">
              {h.name} would rather you telephoned for a first conversation,
              whether that is because of a death or because you are planning
              ahead. Their number is above.
            </p>
          </div>
        )}
      </div>
    </Shell>
  );
}

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
  return (
    <div className="rounded-lg border p-4">
      <p className="font-medium mb-1">{title}</p>
      <p className="text-sm text-muted-foreground">{body}</p>
      {footnote && (
        <p className="text-sm text-muted-foreground mt-2">{footnote}</p>
      )}
      {onClick && (
        <Button onClick={onClick} className="mt-3" size="sm">
          {actionLabel}
        </Button>
      )}
    </div>
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

  const submit = useSubmitIntakeRequest({
    mutation: { onSuccess: onSent },
  });

  const reachable =
    requesterPhone.trim().length > 0 || requesterEmail.trim().length > 0;

  // On a pre-need form the person is the subject, so their own name fills both.
  const subjectFirst = preNeed ? requesterName.trim().split(/\s+/)[0] ?? "" : subjectFirstName;
  const subjectLast = preNeed
    ? requesterName.trim().split(/\s+/).slice(1).join(" ")
    : subjectLastName;

  const ready =
    requesterName.trim().length > 0 &&
    reachable &&
    subjectFirst.length > 0 &&
    subjectLast.length > 0;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;

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
      <h1 className="font-display text-2xl mb-2">
        {preNeed ? "Planning ahead" : "Starting with " + homeName}
      </h1>
      <p className="text-muted-foreground mb-6">
        {preNeed
          ? "A few details so someone can get in touch. Nothing here is a commitment, and nothing is decided today."
          : "Just enough for someone to ring you back. Everything else can wait until you have spoken to them."}
      </p>

      {!preNeed && <UrgentLine urgentPhone={urgentPhone} phone={phone} />}

      <div className="space-y-4">
        <div>
          <Label htmlFor="requesterName">Your full name</Label>
          <Input
            id="requesterName"
            value={requesterName}
            onChange={(event) => setRequesterName(event.target.value)}
            autoComplete="name"
            required
          />
          {preNeed && (
            <p className="text-xs text-muted-foreground mt-1">
              This is the name the plan will be in.
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="requesterPhone">Telephone</Label>
            <Input
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
              id="requesterEmail"
              type="email"
              value={requesterEmail}
              onChange={(event) => setRequesterEmail(event.target.value)}
              autoComplete="email"
            />
          </div>
        </div>
        {!reachable && (
          <p className="text-xs text-muted-foreground -mt-2">
            One of the two, so they can reach you.
          </p>
        )}

        {!preNeed && (
          <>
            <div className="pt-2 border-t">
              <p className="font-medium text-sm mb-3 mt-3">Who has died</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="subjectFirstName">First name</Label>
                  <Input
                    id="subjectFirstName"
                    value={subjectFirstName}
                    onChange={(event) => setSubjectFirstName(event.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="subjectLastName">Last name</Label>
                  <Input
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
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={4}
            maxLength={4000}
          />
        </div>
      </div>

      <Button type="submit" className="mt-6 w-full" disabled={!ready || submit.isPending}>
        {submit.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : preNeed ? (
          "Send this to " + homeName
        ) : (
          "Send this to " + homeName
        )}
      </Button>

      <p className="text-xs text-muted-foreground mt-4">
        This goes to {homeName} and to nobody else. It is not a public notice,
        and nothing is published anywhere.
      </p>
    </form>
  );
}
