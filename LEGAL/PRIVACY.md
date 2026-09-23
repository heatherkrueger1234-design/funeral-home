# Privacy Policy

`[LEGAL ENTITY]`, `[REGISTERED ADDRESS]`. Effective `[EFFECTIVE DATE]`.

> **Draft.** Not reviewed by counsel. See [`README.md`](./README.md) for what
> is unfilled and what the business still has to decide.

---

## If you are a family, read this part

**If a funeral home sent you a link, the funeral home holds your information —
not us.** We make the software they are using. We hold their copy of it, and
we do not use anything about you or about the person who died for any purpose
of our own.

So if you want to know what is held about your relative, or want it corrected,
or want it deleted, **ask the funeral home**. They can do all three themselves,
without asking us. They can hand you the whole file as a folder of photographs
and plain text, and they can erase it permanently.

Three things that may be worth knowing, and that we would rather you heard
plainly:

- **Your link is your way in, and there is no account.** We did not ask you to
  choose a password or fill in a registration form, because three days after
  somebody dies is the wrong moment to be locked out of a form. That means the
  link works for whoever holds it, so treat the text message as private, and
  tell the funeral home if it goes somewhere it should not — they can switch it
  off in one click, immediately.
- **Nobody sells any of this.** Not the photographs, not the obituary, not what
  you wrote in the message thread. There is no advertising here, no tracking
  across other websites, and nothing is used to train any artificial
  intelligence. There is no version of this where your mother's photographs are
  somebody's asset.
- **Nothing you write here is published.** An obituary written in this portal
  goes to the funeral home, not to a website. If it appears anywhere public,
  that is because the home put it there.
- **A photograph can carry where it was taken.** Cameras and phones record
  hidden information inside an image file, sometimes including the exact place
  it was taken. Large photographs are re-processed on the way in and lose that;
  smaller ones are kept exactly as you sent them and keep it. We would rather
  tell you than let you assume otherwise. It goes only to the funeral home —
  but it does go to them, along with the picture.

The rest of this page is the full detail, and it is mostly about funeral homes
because they are our customers.

---

## 1. Who is responsible for what

There are two different kinds of information here and they are governed
differently. Being clear about which is which is the point of this section.

**Information about a deceased person and their family.** The funeral home is
the **controller**. They decide what is collected, why, and how long it is
kept. We are their **processor**: we hold it and act on their instructions and
have no purpose of our own for it. The home's own privacy notice governs it,
and the [Data Processing Agreement](./DPA.md) is what we have promised them
about how we handle it.

**Information about a funeral home and its staff.** Here we are the
**controller**. This is our own business record — who our customer is, who
works there, and what we bill them. Sections 3 onward are about this.

## 2. What we hold on behalf of a funeral home

Because we are the processor and not the controller, this is a description
rather than a purpose. In full, it is:

- **About the person who died.** Name, dates, place of birth, parents' names,
  marital status, occupation, veteran status, residence — and the full data set
  a death certificate requires, which includes a **social security number** and
  cause-of-death information.
- **Photographs** the family uploads, commonly of the deceased.
- **About the family.** Names, relationships, phone numbers, email addresses.
- **What the family writes.** The obituary, messages to the home, hymn and
  reading choices, memories, eulogies, life stories.
- **The arrangements.** Service date and place, the timeline, belongings and
  their chain of custody.

**How it is protected.** Photographs and social security numbers are encrypted
with AES-256-GCM before they are written, and backups are encrypted as whole
files. Social security numbers are masked wherever they are shown and are
deliberately left out of exports, because an export gets emailed and copied to
a laptop.

**Where a photograph was taken.** Phones record the location in every
photograph. We remove that, and the rest of the hidden camera data, from every
photograph as it arrives, so nothing we store or pass on says where a picture
was taken. Schedule 2 of the [DPA](./DPA.md) describes how.

**We do not use any of it for anything.** No analytics, no marketing, no
research, no training any model, and never combined with another home's data or
with anything from outside. Those are written as prohibitions in Section 3 of
the DPA, not as preferences here.

**Who at our company can see it.** Almost nobody, and never without a record.
Access requires both a staff account of ours and membership of an access list
that is empty by default, and every single time one of us reads across the
boundary between funeral homes it writes a log entry naming who did it and
what they looked at — written before the data comes back. A funeral home can
ask us for every entry concerning them.

## 3. What we hold about a funeral home and its staff

| What | Why |
| --- | --- |
| Staff name, work email address, job title | So they can sign in, and so the family knows who they are talking to |
| A hashed password, and session records | To sign them in and keep them signed in |
| The home's name, address, phone numbers, opening hours, logo, brand color | To run the service, and so the family's experience looks like it came from that home |
| Billing contact, subscription state, and a count of funerals | To bill for the service |
| Colorado registration and practitioner licensure details, where entered | So the console can show the home where its own deadlines fall |
| Server logs | To keep the service running and to investigate a fault |

**Why we are allowed to.** To perform our contract with the home, and for our
legitimate interest in running and securing a service and getting paid for it.

**How long.** While the account is open, then 90 days, then deleted — except
invoices and the fact that the account existed, which we keep for tax and
accounting. Sessions expire after 30 days. Server logs are kept for
`[LOG RETENTION]` and hold no case content.

## 4. Cookies

One cookie: the staff session. It is `HttpOnly`, `Secure`, and `SameSite=Lax`,
and it exists so that a signed-in director stays signed in.

**There are no analytics cookies, no advertising cookies, and no third-party
trackers of any kind.** The family portal sets no cookie at all. We do not
track anybody across other websites, and there is nothing here to consent to
because there is nothing here to refuse.

## 5. Who else sees anything

Four services, and **no case content reaches any of them**:

| Who | What they get |
| --- | --- |
| `[HOSTING PROVIDER]` (`[REGION]`) | Runs the application and the database. Everything, encrypted at rest as described above. |
| Stripe | The home's billing contact; and per funeral, an internal case number, the date, and the figure `1`. No name, no case content, no family data, ever. |
| `[SMTP PROVIDER]` | A recipient address and a message: password resets, staff invitations, address confirmations, trial notices, aftercare check-ins, intake alerts. |
| Twilio | A phone number, the family's link, and the home's name — when a director texts a link. |
| Google Places | Search terms and a ZIP code, only if the home supplies a key and only when a vendor search runs. No family details. |

There is no analytics provider, no error-reporting service, no session
recording, no advertising network, and no customer-data platform. **The service
does not phone home.** There is no telemetry.

We will also disclose information if the law requires it. If we receive a
demand for a funeral home's data we will tell them before responding, unless we
are legally prohibited from doing so, so that they can object.

**If we are ever acquired**, your families' data does not change character on a
change of ownership: the prohibitions in Section 3 of the DPA bind whoever
acquires us.

## 6. Where it is, and where it is not

Everything is stored and processed in `[REGION]`. We do not transfer it
internationally. Our sub-processors are US companies.

## 7. Your rights

**If you are a family**, your rights run against the funeral home — see the top
of this page. They can honor all of them without us.

**If you are a funeral home or a member of its staff**, and depending on where
you live, you may have the right to know what we hold about you, to correct it,
to have it deleted, to get a copy, to object to processing based on legitimate
interest, and to appeal a refusal. Under the Colorado Privacy Act you also have
the right to opt out of targeted advertising, of the sale of personal data, and
of profiling. **We do none of those three, so there is nothing to opt out of**,
and we honor universal opt-out signals regardless.

Write to `[PRIVACY CONTACT]`. We answer within **45 days** and will not charge
you. If we refuse, we will say why and tell you how to appeal; if we refuse the
appeal you may complain to the Colorado Attorney General.

## 8. Consent, where it is actually asked for

One feature in this service asks for consent, and it asks properly.

When a funeral home closes a case it can enroll the family in grief check-ins
at 30, 60, and 90 days and on the anniversary, signed in the home's name. That
enrollment starts as **pending** and **sends nothing at all** until the family
agrees. Before they decide they are shown the actual dates the messages would
arrive, and a decline sits next to the agreement with equal visual weight. A
decline is final. Consent is checked again at the moment of sending, not just
when the schedule was written, and it can be withdrawn from either side at any
time — including from the check-in itself, each of which carries the home's
postal address and a link that stops the rest.

This is deliberate, and the reason is that the Colorado Privacy Act is explicit
that broad terms-of-service acceptance, a pre-ticked box, or a deceptively
designed page is **not** consent for sensitive data. Accepting a policy page is
not consent to be contacted about somebody who died.

## 9. Children

This service is not for children and we do not knowingly collect anything from
one. A deceased child's details may appear in a case, entered by an adult
arranging the funeral; that is the funeral home's record, held under Section 2.

## 10. Deceased people

Most privacy law does not give rights to the dead, and that is not the standard
we work to. The information here — a photograph of somebody in an open casket,
their cause of death, their social security number — is treated as sensitive
throughout, under Section 5 of the DPA, whichever statute happens to reach it.

## 11. Security, plainly

The measures are listed in full in Schedule 2 of the [DPA](./DPA.md). In short:
encryption at rest for the things that would hurt most, TLS everywhere, scrypt
password hashing, one funeral home's records unreachable from another's account
by a rule the build tests, family links stored only as a digest and revocable in
one click, and an audit log of every time anyone here looks across that
boundary.

We do not hold SOC 2 or ISO 27001 certification and do not claim to.

**No system is perfectly secure.** If something goes wrong with a funeral
home's data we will tell them within 72 hours, with what we know at the time.

## 12. Changes

If we change this in a way that matters we will tell funeral homes at least 30
days beforehand, at the address on their account, and date this page. We will
not change it to permit something Section 3 of the DPA forbids.

## 13. Contact

`[PRIVACY CONTACT]` — a person reads it.

`[LEGAL ENTITY]`, `[REGISTERED ADDRESS]`.
