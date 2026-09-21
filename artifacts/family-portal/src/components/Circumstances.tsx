import type { ReactNode } from "react";
import { ChevronRight, Phone } from "lucide-react";

/**
 * What to say when what happened is hard to say.
 *
 * The obituary form asks named questions and the memories page asks small
 * ones, and both of them quietly assume a death nobody has to explain. A
 * great many are not that. A director handles an overdose, a suicide, a
 * homicide, a stillbirth and a man nobody in the family liked in the same
 * working week, and knows what to say in each; the family, once, does not.
 *
 * Every one of these is a real conversation directors have at kitchen
 * tables, written down so a family can have it at two in the morning when
 * there is nobody to ask.
 *
 * Three rules this is built to:
 *
 *  1. **Nothing is stored and nothing is asked.** There is no "cause of
 *     death" field feeding this, and there will not be. Making a bereaved
 *     family classify their loss from a dropdown to unlock the right advice
 *     is a cold thing to do, and it would put a sensitive fact in a column
 *     for no purpose the product has. They open what applies to them.
 *  2. **Choices, never instructions.** On every one of these there are
 *     families who name what happened and families who do not, and both are
 *     right. The job is to say what each choice costs and get out of the way.
 *  3. **Suicide and overdose follow safe-messaging practice**, which is not
 *     squeamishness. Obituaries are read by people at risk, and describing a
 *     method or framing a death as a response to one bad event measurably
 *     raises that risk. So: name it or do not, as the family wishes — but
 *     never the how, and never the because.
 */

/**
 * The number a family might need, said once, plainly.
 *
 * Put at the foot of the two entries where the people reading are
 * statistically likelier than anyone else on this product to need it
 * themselves — and worded for *them*, not for the person who died. A
 * bereaved-by-suicide family is at raised risk, and a helpline offered as
 * though it were only ever for somebody else is one they will not ring.
 */
function Lifeline({ substances = false }: { substances?: boolean }) {
  return (
    <div className="space-y-1.5 rounded-lg border border-[var(--accent)]/20 bg-[var(--accent-soft)] px-3 py-2.5 text-sm text-[var(--accent-deep)]">
      <p className="flex items-start gap-2">
        <Phone
          className="mt-0.5 size-4 shrink-0"
          strokeWidth={2}
          aria-hidden
        />
        <span>
          If anyone in the family is struggling, the{" "}
          <a
            href="tel:988"
            className="font-semibold underline-offset-4 hover:underline"
          >
            988 Suicide &amp; Crisis Lifeline
          </a>{" "}
          answers calls and texts, day and night, to anyone — including people
          grieving a death like this one.
        </span>
      </p>
      {substances && (
        <p className="pl-6">
          For addiction, in the family or otherwise, SAMHSA&apos;s national
          helpline is{" "}
          <a
            href="tel:18006624357"
            className="tabular font-semibold underline-offset-4 hover:underline"
          >
            1-800-662-4357
          </a>{" "}
          — free, confidential, and open all the time.
        </p>
      )}
    </div>
  );
}

function Case({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group/case border-t border-border first:border-t-0">
      <summary
        className="flex cursor-pointer list-none items-center gap-2 py-2.5 text-sm font-semibold
                   text-foreground [&::-webkit-details-marker]:hidden"
      >
        <ChevronRight
          className="size-4 shrink-0 text-[var(--accent)] transition-transform duration-200
                     ease-[cubic-bezier(0.2,0.6,0.3,1)] group-open/case:rotate-90"
          strokeWidth={2.25}
          aria-hidden
        />
        {title}
      </summary>
      <div className="space-y-2.5 pb-4 pl-6 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </details>
  );
}

/** A point: the short version in ink, the reason in grey. */
function P({ lead, children }: { lead: string; children?: ReactNode }) {
  return (
    <p>
      <strong className="font-semibold text-foreground">{lead}</strong>
      {children ? <> {children}</> : null}
    </p>
  );
}

export function Circumstances() {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-1 shadow-[var(--elevation-1)]">
      <Case title="If they took their own life">
        <P lead="You do not have to say how they died.">
          "Died suddenly at home" is complete, honest and enough. No one
          reading an obituary is owed a cause of death, and nothing is being
          hidden by leaving it out.
        </P>
        <P lead="If you do want to name it, the words are “died by suicide”.">
          Not "committed" — that belongs to a time when it was a crime — and
          never "successful" or "failed". Many families find that naming it
          lifts something, and that people who had been avoiding the subject
          start talking to them instead of around them. Others do not want the
          rest of a life read through it. Both are right.
        </P>
        <P lead="Leave out how, and leave out why.">
          Not out of shame. An obituary is read by people who are themselves
          unwell, and a method described or a death explained by one bad week
          is the thing that puts them at risk. Say that they died. Say who
          they were for the fifty years before it.
        </P>
        <P lead="The illness is allowed to be named as an illness.">
          "After a long struggle with depression" is a true sentence about a
          medical condition, and families who write it say it was the line
          that made other people in their family go and get help.
        </P>
        <P lead="Tell the funeral home what you have decided.">
          They will keep everyone else's version in line with yours — the
          notice, the service sheet, and what is said at the front.
        </P>
        <Lifeline />
      </Case>

      <Case title="If it was an overdose">
        <P lead="More families name it every year, and say they are glad they did.">
          "Died of an accidental overdose" is a plain sentence, and writing it
          is what has changed how people talk about this at all. It is still
          a choice, not a duty.
        </P>
        <P lead="If you would rather not, “died suddenly” is true and sufficient.">
          Nobody is owed the rest.
        </P>
        <P lead="They were not “an addict”.">
          They were someone who struggled with addiction. It is the difference
          between a diagnosis and a description of a person, and it is the
          difference most families are reaching for and cannot find the words
          for at the time.
        </P>
        <P lead="Leave out what and how much.">
          For the same reason as above: this is read by people in the middle of
          it, and by their families.
        </P>
        <P lead="Say what they were besides this.">
          The illness is usually the last chapter and almost never the whole
          book. Write the book.
        </P>
        <Lifeline substances />
      </Case>

      <Case title="If they were killed">
        <P lead="Do not name anyone you believe was responsible.">
          Not in the obituary, not on the service sheet. It can genuinely
          damage a prosecution, and it exposes the family to a claim at the
          worst imaginable moment. Your funeral director has almost certainly
          had to say this before and will not be surprised that you asked.
        </P>
        <P lead="You need say no more than that they died.">
          "Died on the 14th of March" carries no less love than a full
          account, and it will not be quoted back at you in a newspaper.
        </P>
        <P lead="Expect people to ask, and let the funeral home be the wall.">
          Press, neighbours, people who mean well. A home will take those
          calls and give out nothing you have not agreed to — say the word and
          it stops being your job.
        </P>
        <P lead="The service can be private even if the death was public.">
          Unlisted times, a closed committal, somebody on the door. Ask.
        </P>
      </Case>

      <Case title="If it was sudden">
        <P lead="You are writing this far too soon, and everyone knows it.">
          A week ago nobody was thinking about any of this. Write the little
          you can hold on to, and let the home ask you the rest later.
        </P>
        <P lead="“Died unexpectedly” is the whole sentence.">
          You do not have to have understood it yet in order to write it down.
        </P>
        <P lead="Get other people to fill in the gaps.">
          Send this link to a sister, a best friend, a colleague. Sudden deaths
          leave the person closest too stunned to remember anything, and
          everyone else remembering everything.
        </P>
      </Case>

      <Case title="If it was a long illness">
        <P lead="You are allowed to say it was hard.">
          "After a long illness borne with great stubbornness" is a truer
          sentence than "after a courageous battle", and it sounds like a
          person rather than a press release.
        </P>
        <P lead="Name the people who looked after them.">
          A hospice, a ward, a neighbour who came every Tuesday. It is the
          part of an obituary that gets cut out and kept.
        </P>
        <P lead="Relief is not disloyalty.">
          Most families feel some, most think they are the only ones, and it
          does not belong in the obituary — but it is worth knowing that your
          funeral director has heard it from nearly everybody.
        </P>
      </Case>

      <Case title="If dementia took them first">
        <P lead="Write about the person, not the last two years.">
          The obituary is for the whole life. The woman who ran the shop for
          thirty years is more the truth of her than the woman who did not
          know you in August.
        </P>
        <P lead="You have been grieving for a long time already.">
          People will treat this as a death that happened last week. It did
          not, quite, and you are allowed to be further along than everyone
          expects you to be.
        </P>
      </Case>

      <Case title="If they were a child, or a baby">
        <P lead="Use their name, as many times as you want to.">
          It is the thing bereaved parents say afterwards that they wanted
          most and that everyone else was too frightened to do.
        </P>
        <P lead="A short life is not a short obituary.">
          Who they looked like. What made them laugh. Who was waiting for
          them. If they were born still, they were born, and they can be
          written about.
        </P>
        <P lead="Name siblings as siblings.">
          Children who have lost a brother or sister get left off these, and
          they notice, and they remember.
        </P>
        <P lead="There is no expected length, tone or restraint here.">
          Nobody will think you have said too much.
        </P>
      </Case>

      <Case title="If it was complicated">
        <P lead="An obituary is not a verdict, and you do not have to be fair.">
          It is what this family wants said in public. That is all it has ever
          been.
        </P>
        <P lead="You can leave people out, and you can leave things out.">
          Estrangements, a second family, a stretch inside, years nobody
          talks about. Silence in an obituary is not a lie.
        </P>
        <P lead="You can also be honest without being cruel.">
          "He was not an easy man, and he was ours" has been printed, and read
          aloud, and it was the truest thing in the room.
        </P>
        <P lead="If the family disagrees, say so to the funeral home early.">
          They will have watched two halves of a family write two different
          obituaries before, and they would much rather hear about it now than
          at the printer.
        </P>
      </Case>

      <Case title="If you are angry">
        <P lead="That is grief, and it is on time.">
          At them, at a hospital, at somebody who did not come. It is not a
          sign you are doing this wrong.
        </P>
        <P lead="Write it down somewhere that is not the obituary.">
          Put it in the memories page and leave it unticked, or write it and
          delete it. What you must not do is make the decision about what goes
          in print this week, and be stuck with it for thirty years.
        </P>
        <P lead="Nothing here has to be finished today.">
          You can add, change and take out anything until the funeral home
          sends it to print, and they will tell you before they do.
        </P>
      </Case>
    </div>
  );
}
