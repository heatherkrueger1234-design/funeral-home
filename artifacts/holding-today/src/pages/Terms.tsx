import { CONTACT_EMAIL, LegalPage, Section } from "@/components/LegalPage";

export default function Terms() {
  return (
    <LegalPage
      title="Terms"
      intro="The agreement between you and this site. Kept short, because you have enough to read."
    >
      <Section heading="What this is">
        <p>
          A private place to keep what you remember about your child. It is
          free. There is no subscription, no trial, and nothing behind a
          paywall. If you choose to give something, that is a gift and not a
          purchase — it buys you nothing here that anyone else does not have.
        </p>
      </Section>

      <Section heading="What this is not">
        <p className="text-foreground/90">
          This is not medical care, therapy, legal advice, or a crisis service.
          Nobody is watching what you write, and nothing here will reach a
          person who can help you in an emergency.
        </p>
        <p>
          If you are in crisis or having thoughts of ending your life, please
          call or text{" "}
          <a href="tel:988" className="text-primary hover:underline">
            988
          </a>{" "}
          in the US, or your local emergency number. Please do not write it
          here and wait.
        </p>
      </Section>

      <Section heading="What you write stays yours">
        <p>
          You keep every right to everything you put here. No ownership is
          claimed over your words or your photographs. The only permission this
          site takes is the technical one it cannot work without — to store
          your writing and show it back to you. That permission ends the moment
          you delete it.
        </p>
      </Section>

      <Section heading="Your account">
        <p>
          You must be 18 or older. Keep your password to yourself; anyone who
          has it can read everything in your account. If you think someone else
          has it, change it — doing so signs out every other device.
        </p>
      </Section>

      <Section heading="What not to put here">
        <p>
          Other people's private information without their agreement, anything
          unlawful, and anything you do not have the right to upload. This is
          your family's space, and the only limits on it are ones that protect
          other people.
        </p>
      </Section>

      <Section heading="Please keep your own copy">
        <p className="text-foreground/90">
          This is the most important paragraph on this page.
        </p>
        <p>
          This site is provided as it is, with no guarantee that it will always
          be available or that nothing will ever go wrong. It is run by one
          person, not a company with a support department. Servers fail,
          providers close accounts, and things break.
        </p>
        <p>
          So please use the download button in your account from time to time
          and keep the file somewhere of your own. What you have written about
          your child is far too important to exist in only one place — and that
          is true of every website in the world, not only this one.
        </p>
      </Section>

      <Section heading="Where responsibility ends">
        <p>
          Because this is free and provided as it is, it comes without
          warranties of any kind, and liability for any loss arising from using
          it — including loss of what you have stored — is limited to the
          fullest extent the law allows. That is not indifference; it is the
          honest position of something given away for nothing. It is also why
          the paragraph above matters.
        </p>
      </Section>

      <Section heading="Accounts that cause harm">
        <p>
          An account may be suspended or removed if it is used to break the
          law, to harm someone, or to consume so much storage that the site
          stops working for other families. This is not about moderating grief.
          Nobody is reading your writing and judging it.
        </p>
      </Section>

      <Section heading="Ending">
        <p>
          You can delete your account whenever you like, without notice or
          explanation.
        </p>
        <p>
          If this site ever has to close, you will be told in advance with
          enough time to download everything, and it will not simply disappear
          one morning. That is a promise worth making to people who have
          already had enough taken without warning.
        </p>
      </Section>

      <Section heading="Changes">
        <p>
          If these terms change, the new version appears here with a new date.
          Anything that materially affects you will be said plainly.
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
          .
        </p>
      </Section>
    </LegalPage>
  );
}
