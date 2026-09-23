# Data Processing Agreement

**Between** `[LEGAL ENTITY]`, a `[STATE OF INCORPORATION]` company, of
`[REGISTERED ADDRESS]` ("**we**", "**us**", "**the Processor**")

**and** the funeral home named in the Order ("**you**", "**the Home**",
"**the Controller**").

Effective `[EFFECTIVE DATE]`. Incorporated into, and subordinate to, the
[Terms of Service](./TERMS.md). Where the two conflict on the handling of
personal data, this document wins.

> **Draft.** Not reviewed by counsel. See [`README.md`](./README.md) for what
> is unfilled and what the business still has to decide.

---

## 1. Which of us is which, and why it matters

You are the **controller** of every piece of personal data about a deceased
person and their family that passes through this service. We are your
**processor**. You decide what is collected, from whom, why, and for how long
it is kept; we hold it and act on your instructions.

This is not a formality chosen to shift risk onto you. It is the only honest
description of the arrangement, and it has consequences we accept:

- **We have no independent purpose for your families' data.** We do not
  analyze it, market from it, sell it, share it, enrich it, or use it to train
  any model. There is no version of this service in which your families'
  photographs are our asset.
- **We do not decide what happens to it.** Not what is collected, not how long
  it is kept, and not whether it is deleted. Those are your calls, because the
  retention obligations are yours — set by Colorado law, by your board, and by
  your insurer, and not by us from an office in Denver.
- **We hold no record of any transaction.** There is no price list, invoice or
  contract in this service. For FTC Funeral Rule purposes the General Price
  List, the itemization and every disclosure remain entirely yours, and we
  could not produce them if asked.

We are a **controller** for exactly one category: the account and billing data
of your own staff — names, work email addresses, sign-in records, and what we
need to bill you. That is our own business record. It is described in the
[Privacy Policy](./PRIVACY.md) and is not covered by the rest of this
document.

### 1.1 We are not a HIPAA business associate

A funeral home is not a covered entity under HIPAA. There is therefore no
covered relationship for us to sit beneath, and we do not enter Business
Associate Agreements. We say so plainly rather than signing one to close a
sale: a BAA would assert a legal relationship that does not exist, which helps
neither of us if it is ever examined.

This does not lower the standard of care. Cause of death, a social security
number, and a photograph of a dead person are treated as sensitive data under
Section 5 whether or not HIPAA reaches them.

---

## 2. What we process, and on whose instruction

We process the categories in **Schedule 1** for the sole purpose of providing
the service described in the Terms, and for no other purpose.

Your instructions are: the configuration you set in the service, the actions
your staff take in it, and this document. We will not process your families'
data outside those instructions. If we believe an instruction of yours requires
us to break the law, we will tell you rather than quietly comply or quietly
refuse.

**Duration.** For as long as your account is open, plus the wind-down in
Section 9.

---

## 3. What we will not do

Stated as prohibitions because they are the questions your insurer asks:

1. We will not sell, rent, or share your families' personal data with anyone,
   for any consideration, ever.
2. We will not use it for our own marketing, product analytics, or research.
3. We will not use it to train, fine-tune, evaluate, or prompt any machine
   learning model.
4. We will not combine it with data from another funeral home, or from any
   other source.
5. We will not move it outside `[REGION]` without telling you first.
6. We will not engage a sub-processor without the notice in Section 7.
7. We will not edit a case. There is no route in this service that lets us
   change an obituary, a photograph, a message or a family contact, and there
   is not meant to be — a processor who can rewrite a family's record of their
   mother is not a processor.

---

## 4. Who at our company can see your data, and the log that proves it

**Almost nobody, and never silently.**

Access across the boundary between funeral homes is confined to a single
administrative console, and reaching it requires two separate things at once: a
real staff account of ours with its own password, **and** membership of an
access list held in the database. Membership grants nothing on its own. An
empty list means nobody, which is the default.

**Every access is logged before the data is returned.** Each cross-tenant read
writes a row recording who did it, what they looked at, which home it concerned,
and when — and it is written and committed first, so a read whose log entry
failed does not return data. That log is not rotated away and not editable from
the console.

Adding or removing one of our staff from that list is itself logged, with who
did it. A colleague who leaves is removed from a table, immediately, rather
than at the next deployment.

**On request we will give you every entry in that log concerning your home.**
Ask at `[PRIVACY CONTACT]`.

What that console can do is see, and almost nothing else. The complete list of
writes it can make that touch a funeral home is: create a home; suspend or
restore one; record its licensure and its practitioners; create a group and
move a home into or out of one; start a group's billing; and mark a home as
ours rather than a customer's.

**It cannot read a case.** Everything it shows about how much a home is using
the service is a count — `count(*)`, grouped by home. No row of a case, a
family contact, a photograph, an obituary, a message or an enrollment is ever
selected there, which is why a number computed across forty homes is not forty
homes' data. There is no route in that console that edits any of them.

---

## 5. How it is secured

**Schedule 2** lists the measures in force. Two are worth stating here because
they are the ones that matter if a disk goes missing:

**Encryption of the things that would hurt most.** Every uploaded file — every
photograph a family gave you — and every social security number is encrypted
with AES-256-GCM before it is written to storage. Backups are encrypted as
whole files with the same key. The key is held in the application's environment
and never in the database, so a copy of the database, or a misplaced backup, is
worth nothing without it.

**We hold that key, and we carry the consequence.** If we lose it, the
photographs are not recoverable — not by us, not by anyone. Key custody,
rotation and escrow are our obligation under Schedule 2, not yours.

**Sensitive data.** Cause of death, social security numbers, and images of the
deceased are treated as sensitive personal data under the Colorado Privacy Act
regardless of the thresholds in Section 11. Social security numbers are
encrypted at rest, masked everywhere they are displayed, and **deliberately
excluded from case exports** — an export gets emailed, copied to a laptop, and
left in a downloads folder, and a social security number does not belong in one.

---

## 6. When something goes wrong

If we become aware of a breach of security leading to the accidental or
unlawful destruction, loss, alteration, or unauthorized disclosure of your
families' personal data, we will notify you **without undue delay and in any
event within 72 hours**, at the address on your account.

That notification will say what we know: what happened, when, which categories
and roughly how many people are affected, what we have done, and what we
recommend you do. If we do not yet know all of it, we will send what we have
rather than wait to send something complete.

You are the controller, so **notifying affected families, and any regulator, is
your decision and your obligation.** We will give you everything you need to
make it, including the access log in Section 4, and we will not make a public
statement naming you without telling you first.

---

## 7. Sub-processors

The services we rely on are listed in **Schedule 1**, with what each one
receives. You authorize those on signing.

Before we add or replace one, we will give you **30 days' written notice**. If
you object on reasonable data-protection grounds within that period, we will
either not make the change for your account or, if that is not technically
possible, you may terminate the affected part of the service and receive a pro
rata refund of anything prepaid.

We remain liable to you for a sub-processor's handling of your families' data
as if it were our own, and each is bound by terms no weaker than these.

**No case content reaches any of them.** Photographs, obituaries, messages, and
vital statistics go to none of the four. Schedule 1 says exactly what each one
does receive, which is in every case a name, a phone number, a link, or a
search term.

---

## 8. Helping you answer a family

A family's rights — to know what is held, to correct it, to have it deleted —
run against **you**, because you are the controller. When one exercises them
you do not need to ask us: the service gives your staff the means directly.

| A family asks to… | You can, without contacting us |
| --- | --- |
| See everything held about their relative | Export the case. It comes out as a folder of plain text and full-size photographs that opens without this software. |
| Correct something | Edit it. Every field a family or a director can see is editable by your staff. |
| Delete everything | Erase the case. It destroys the encrypted photograph bytes, the vital statistics including the social security number, the message thread, the memory book, and the family's contact details and link. What survives is a record that you did it, holding no name. |
| Stop the aftercare messages | Revoke consent, from either side. A decline is final. |
| Revoke access | Revoke the family link. One click, immediate, absolute. |

Where you need something the service does not give you, ask at
`[PRIVACY CONTACT]` and we will help within **10 business days**, at no charge.

**Two honest limits**, which you should repeat to a family rather than soften:

1. **Erasure does not reach backups already taken.** A case erased today
   remains in an earlier encrypted backup until that backup ages out, within
   **30 days**. The accurate sentence is: *"It is deleted from the live system
   now, and it will be gone from the backups within thirty days."*
2. **Once you export a case, that copy is outside all of this.** The zip on
   somebody's laptop is yours to look after.

### 8.1 Nothing is deleted on a timer

No case data expires, ever. This is a deliberate refusal and not a missing
feature: your retention obligations are set by state law and your insurer, and
software that purged at 36 months because that sounded responsible would be
destroying records you are required to hold.

What does expire is credentials and working state, none of which is case
content: staff sessions after 30 days, password reset links after 60 minutes,
family links 90 days from issue, and email confirmation links after 14 days.

---

## 9. When it ends

**Your data does not become hostage to a billing dispute.** Exporting a case
keeps working after you cancel, after a payment fails, and while an account is
suspended. This is a deliberate property of the service, verified by test, and
we will not remove it.

On termination:

1. For **90 days**, your data stays as it is and export keeps working. A home
   that cancels in a bad month, or by mistake, has not lost its families' files.
2. At the end of those 90 days we delete it from the live service. Encrypted
   backups containing it age out within a further **30 days**.
3. On written request inside the 90 days we will delete sooner, or give you a
   full export first. Ask at `[PRIVACY CONTACT]`.
4. We keep what we are obliged to keep for our own tax and accounting records:
   invoices, and the fact that your account existed. That holds no case data.

---

## 10. Audit

On reasonable notice and no more than once a year — or after a breach
affecting you — we will answer your or your insurer's written questions about
these measures, and provide the access log in Section 4.

We do not currently hold SOC 2 or ISO 27001 certification and will not imply
otherwise. If you need one, say so before signing; it is a real cost and a real
timeline and not something we will claim we are "working toward" to get past
this clause.

---

## 11. Colorado Privacy Act

The CPA applies to a controller processing the personal data of 100,000+
Colorado consumers a year, or 25,000+ where it derives revenue from selling
data. We sell no data, and at present scale neither of us is likely to meet the
thresholds. For your families' data we are a processor rather than a controller
regardless, and Sections 3 through 9 constitute the processor terms the CPA
requires.

That is a reason to be careful, not relaxed. This service holds social security
numbers, causes of death, and photographs of the dead. Where consent is needed
it is collected as real opt-in — the aftercare enrollment starts as *pending*,
sends nothing at all until the family agrees, shows them the actual dates
before they do, and offers a decline of equal visual weight, because the CPA is
explicit that broad terms-of-service acceptance and deceptively designed pages
are not consent. We honor universal opt-out signals.

---

## 12. Liability

Our liability under this document is subject to the limits in the
[Terms of Service](./TERMS.md), except that those limits do not apply to our
obligations under Sections 3, 4, and 5, where `[GOVERNING LAW]` does not permit
them to be limited.

---

## Schedule 1 — What is processed, and what leaves

### Categories of data

| Category | Examples | Sensitive |
| --- | --- | --- |
| The deceased | Name, dates of birth and death, place of birth, parents' names, marital status, occupation, veteran status, residence | Yes |
| Vital statistics | The full data set a death certificate requires, including **social security number** and cause-of-death information | **Yes** |
| Photographs | Images the family uploads, commonly including images of the deceased | **Yes** |
| The family | Names, relationships, phone numbers, email addresses | Yes |
| What the family writes | Obituary drafts, messages to the home, hymn and reading choices, memories, eulogies, life stories | Yes |
| Arrangements | Service date and place, timeline, belongings and their chain of custody | No |
| Your staff | Names, work email addresses, job titles, sign-in and session records | No |
| Billing | Your billing contact, subscription state, and a count of funerals | No |

### Categories of data subject

Deceased people; their next of kin and family members; your staff.

### Sub-processors

| Sub-processor | Purpose | What it receives | Optional |
| --- | --- | --- | --- |
| `[HOSTING PROVIDER]` (`[REGION]`) | Runs the application and the database | Everything above, encrypted at rest as described | No |
| `[BACKUP LOCATION]` | Off-host encrypted backups | Whole-file encrypted backups only | No |
| Stripe, Inc. (US) | Your subscription and per-funeral billing | Your billing contact; and, per funeral, our own internal case number, the date, and the figure `1`. The case number is sent as a deduplication key so that a job running twice cannot bill you twice for the same death. **No name, no case content, and no family data, ever.** | No |
| `[SMTP PROVIDER]` | Sending email | Recipient address and message body: password resets, staff invitations, address confirmations, trial notices, aftercare check-ins, and intake alerts | Yes — without it, mail is written to the log instead of sent |
| Twilio Inc. (US) | Sending the family their link by text | The recipient's phone number, the link, and your home's name | Yes — without it, your director is handed the link to send themselves |
| Google LLC (US) | Vendor lookup, only if you supply a key | Search terms and a ZIP code. **No family details.** | Yes — without it, the vendor directory is hand-entered |

There is no analytics provider, no error-reporting provider, no session
recording, no advertising network, and no customer-data platform. The service
does not phone home.

---

## Schedule 2 — Technical and organizational measures

Each of these is in force today. None is aspirational; where something is not
yet in place it is absent from this list rather than described in the future
tense.

**Separation between funeral homes.** Every record carries the identifier of
the home it belongs to, and every staff query filters on it first — taken from
the signed-in user's own database row, never from anything in the request, so a
home's identifier arriving in a URL or a request body is not what gets
filtered on. This is covered by tests that assert one home cannot reach
another's cases, that a family link reaches exactly one case, and that one
family member cannot delete another's photograph. Those tests fail the build.

**Encryption at rest.** Uploaded files and social security numbers are
encrypted with AES-256-GCM before they are written. Backups are encrypted as
whole files with the same key. The key is supplied through the application's
environment and is never stored in the database; the application refuses to
start without it.

**Encryption in transit.** TLS on every connection. The staff session cookie
is marked `Secure` and `HttpOnly` with `SameSite=Lax`, and the server logs a
specific warning if it is ever issued over plain HTTP.

**Staff authentication.** Passwords are hashed with scrypt at OWASP's
parameters, with per-password salts, and the parameters are recorded in the
stored hash so they can be raised later without invalidating existing
passwords. Sessions are stored as a SHA-256 digest and expire after 30 days. A
password reset ends every other session for that account.

**Family access.** A family reaches one case with a link, and holds no account
and no password — a registration form is where a next of kin three days
bereaved is lost. Only the SHA-256 digest of the link is stored, so the working
value exists in exactly one text message. No family route accepts a case
identifier, so there is nothing for a recipient of a forwarded message to
tamper with. Links expire 90 days from issue and can be revoked in one click,
which is immediate and absolute.

**Least privilege at our end.** As Section 4. Two independent conditions, an
access list that defaults to empty, every cross-tenant read logged before data
is returned, and grants and revocations logged with the actor.

**Rate limiting.** The public-facing form carries per-address and per-home
hourly ceilings counted in the database rather than in process memory, so they
survive a restart.

**Input handling.** Uploads are checked by content rather than by file
extension; a text file renamed `.jpg` is refused. Request bodies and archive
sizes are bounded before anything is streamed.

**Embedded photograph metadata.** Every photograph is stripped of its EXIF,
XMP and IPTC metadata on receipt, which removes any location the camera
recorded and the device it was taken on. An upright JPEG has those segments
removed without being re-encoded, so its image data is stored exactly as sent;
a photograph that must be rotated, resized or converted is re-encoded, which
discards the same metadata. The photo pack and the case export therefore carry
no location data from the camera. Colour profiles are kept.

**Backups.** Taken on a schedule, encrypted, and verified by a scheduled drill
that restores into a scratch database and compares the row counts — because a
backup nobody has restored is a hope rather than a backup. Retained 30 days.

**Recoverability.** Restoration from an encrypted backup is tested, including
that an encrypted photograph returns byte-for-byte identical and an encrypted
social security number decrypts afterward.

**Data portability.** Any case exports as a folder of plain text files and
full-size photographs that opens without this software, and continues to work
after cancellation.

**Erasure.** Erasing a case destroys the encrypted bytes rather than removing a
reference to them, and requires the deceased's name to be typed out rather than
a button to be clicked. What remains is a record that it happened, holding no
name.

**Change control.** All changes go through review. The build runs type checking,
the full test suite against a real database, and the tenant-isolation tests
named above; it fails on any of them, and on any drift between the published API
contract and the code generated from it.
