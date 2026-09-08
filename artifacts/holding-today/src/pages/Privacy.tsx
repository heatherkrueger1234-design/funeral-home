import { CONTACT_EMAIL, LegalPage, Section } from "@/components/LegalPage";

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy"
      intro="What this site stores, who can see it, and how to take it back. Written to be read, not to be survived."
    >
      <Section heading="The short version">
        <p className="text-foreground/90">
          Everything you write here is private to your account. No other person
          using this site can see it. It is never sold, never used for
          advertising, and never used to train anything. You can download all
          of it or delete all of it at any time, without asking anyone, and
          deletion is permanent.
        </p>
      </Section>

      <Section heading="What you write">
        <p>
          Everything you put into this site: your child's name and details,
          memories, photographs, journal entries, letters, creative work,
          quotes and songs, records and documents, tribute and funeral notes,
          milestones, to-dos, affirmations, stories and signs.
        </p>
        <p>
          All of it is tied to your account and only ever returned to your
          account. This is enforced in the code itself — every request for
          data is filtered by who is asking, and asking for someone else's
          record returns nothing rather than the record.
        </p>
      </Section>

      <Section heading="What is encrypted">
        <p>
          Two things are encrypted before they are written to disk, using
          AES-256-GCM: the contents and notes of anything in{" "}
          <span className="text-foreground/90">Important Records</span> — the
          section that holds medical documents, autopsy reports and passwords —
          and the contents of every file you upload.
        </p>
        <p>
          Being straight with you about what that protects: it means a stolen
          copy of the database, a discarded disk, or a leaked backup is
          unreadable without a key held separately. It does not protect against
          someone who has broken into the running server, because the server
          must be able to unlock your records in order to show them to you.
          Anyone who tells you encryption solves everything is selling
          something.
        </p>
      </Section>

      <Section heading="What is collected that isn't your writing">
        <ul className="space-y-2 list-disc pl-5">
          <li>
            <span className="text-foreground/90">Your email address</span>, so
            you can sign in and reset your password.
          </li>
          <li>
            <span className="text-foreground/90">Your password</span>, stored
            only as a scrypt hash. It cannot be reversed, and nobody — not even
            the person running this site — can read it.
          </li>
          <li>
            <span className="text-foreground/90">A session</span> while you are
            signed in, so you are not asked to sign in on every page.
          </li>
          <li>
            <span className="text-foreground/90">A Google account id</span>,
            only if you choose to sign in with Google.
          </li>
          <li>
            Ordinary server logs — the time, the page, the response — kept
            briefly to find faults. What you wrote is never written to them.
          </li>
        </ul>
      </Section>

      <Section heading="What is not done">
        <p>
          There are no analytics, no tracking pixels, no advertising, and no
          third-party scripts following you around. Nothing you write is sold,
          shared, mined, profiled, or used to train an AI model. There is no
          subscription, so there is nothing to be gained from studying you.
        </p>
      </Section>

      <Section heading="Who else is involved">
        <ul className="space-y-2 list-disc pl-5">
          <li>
            <span className="text-foreground/90">The hosting provider</span>{" "}
            runs the servers and the database. They hold the data physically,
            as any host does.
          </li>
          <li>
            <span className="text-foreground/90">Google</span>, only if you
            choose Google sign-in, and only to confirm it is you. Google is not
            told anything about your child or what you write.
          </li>
          <li>
            <span className="text-foreground/90">An email provider</span>,
            used only to send a password reset link when you ask for one.
          </li>
          <li>
            <span className="text-foreground/90">Google Fonts.</span> The
            typefaces load from Google's servers, which means Google can see
            the IP address of anyone who opens the site. That is a small thing,
            but on a site like this even opening it says something, so it is
            named here rather than left out.
          </li>
        </ul>
      </Section>

      <Section heading="Cookies">
        <p>
          Two, both strictly necessary and neither used for tracking: one that
          keeps you signed in, and one that exists for a few minutes during
          Google sign-in to make sure the sign-in you finish is the one you
          started. There are no advertising or analytics cookies, which is why
          there is no cookie banner nagging you.
        </p>
      </Section>

      <Section heading="How long it is kept">
        <p>
          For as long as you want it, and not a moment past that. Your writing
          stays until you delete it or delete your account. Deleting your
          account removes everything belonging to it — every entry, every
          photograph, every record — immediately and permanently. There is no
          hidden copy and no thirty-day grace period, so please download your
          data first if there is any chance you will want it.
        </p>
      </Section>

      <Section heading="What you can do, whenever you like">
        <ul className="space-y-2 list-disc pl-5">
          <li>
            <span className="text-foreground/90">Take it with you.</span> One
            button in your account downloads everything you have written as a
            single file.
          </li>
          <li>
            <span className="text-foreground/90">Delete it.</span> One button,
            confirmed with your password, and it is gone.
          </li>
          <li>
            <span className="text-foreground/90">Correct anything.</span> Every
            entry can be edited or removed.
          </li>
        </ul>
        <p>
          You do not have to email anyone or explain yourself to do any of
          this. Your writing about your child should never be something you
          have to request permission to hold.
        </p>
      </Section>

      <Section heading="Age">
        <p>
          Accounts are for adults — you must be 18 or older. This site is not
          designed for children to sign up for, and no account is knowingly
          created for one.
        </p>
      </Section>

      <Section heading="If this changes">
        <p>
          If this policy changes in a way that affects what happens to your
          writing, the change will be posted here with a new date, and anything
          significant will be said plainly rather than buried.
        </p>
      </Section>

      <Section heading="Questions">
        <p>
          Write to{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-primary hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
          . A real person reads it.
        </p>
      </Section>
    </LegalPage>
  );
}
