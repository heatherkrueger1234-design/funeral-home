# Terms of Service

`[LEGAL ENTITY]` ("**we**", "**us**") and the funeral home that opens an
account ("**you**", "**the Home**").

Effective `[EFFECTIVE DATE]`.

> **Draft.** Not reviewed by counsel. See [`README.md`](./README.md) for what
> is unfilled and what the business still has to decide.

---

## 1. What this is, and what it is not

We provide software that a funeral home uses to collect photographs, obituary
details, and arrangement information from a bereaved family, to hold one
conversation with them, and to send grief check-ins afterward in the home's
name.

**We are not a funeral provider.** We do not handle remains. We do not arrange,
direct, or advise on a funeral. We do not sell funeral goods or services to
consumers. We are a software vendor and nothing in this service, or in anything
we publish, should be read as holding ourselves out otherwise.

Three things this service deliberately does not contain, because each is your
regulated responsibility and not ours:

- **No price list, no invoice, and no contract.** The FTC Funeral Rule governs
  how *you* disclose prices — the General Price List, the Casket Price List,
  itemization, and the prohibition on package-only pricing. Those obligations
  are yours, the disclosures are yours to make, and we hold no record of any
  transaction. You may keep a staff-only price sheet in the service as a crib
  sheet for a kitchen table; it is not a General Price List, no family-facing
  or public page can reach it, and that boundary is enforced by a test that
  fails the build if it is ever crossed.
- **No pre-need prepayment.** Taking money for a funeral that has not happened
  is a licensed activity, regulated separately in every state — in Colorado
  requiring a Division of Insurance license, bonding or net worth, and funds in
  trust. We do not build it, take it, hold it, or facilitate it. You may record
  that a plan exists; money never enters this service.
- **No venue booking.** You may offer a family a choice of service times and
  the family may pick one, which sets the date. **An offer is not a booking.**
  This service does not know whether the church or the cemetery is free, and
  only times you have already confirmed by telephone belong in the list.

## 2. We take no money from families

No processing, no funds held, no card details, and no percentage of what you
sell. A family that owes you money is linked out to your own payment page.

The only money in this arrangement is what you pay us.

## 3. Your account

You need one account per person who uses the service. Sharing a sign-in
defeats the record of who did what, which is the thing that answers a question
later.

You are responsible for your staff's use of the service, for keeping their
passwords to themselves, and for removing someone who leaves. Deactivating a
member of staff is immediate and is something you do yourself.

We ask you to confirm the email address you register with. Until someone at
your home does, the request form on your public page stays switched off — that
page is the one thing a stranger can reach, and it should belong to a home we
have heard from. **Confirmation gates nothing else.** Signing in, opening a
case, texting a family, printing an order of service, and exporting all work
unconfirmed, because being locked out of Thursday's funeral by a confirmation
email in a spam folder would be a worse product than the one this protects
against.

## 4. What you are responsible for

- **That you may collect what you collect.** You are the controller of your
  families' data. Whether you have the right to gather it, and to say who may
  authorize what, is your call under the law that applies to you — in Colorado,
  a statutory order of priority rather than whoever answered the phone.
- **Retention.** Nothing here is deleted on a timer, ever. Deciding how long to
  keep a case, and erasing it when that time comes, is yours. See
  [`RETENTION.md`](../RETENTION.md).
- **What you send.** The aftercare check-ins go out over your name and say what
  you wrote.
- **Getting the licensure right.** The service can record your Colorado
  registration, your appointed designee, and each practitioner's standing and
  expiry, and will show you plainly where a deadline falls. It is a notepad,
  not a compliance guarantee. We do not file anything and we do not register
  anybody.
- **The death certificate.** We help you arrive at the state's electronic
  system with the fields already answered. **We do not integrate with it and we
  file nothing.** Filing within the statutory window is yours.

## 5. What we are responsible for

- Running the service with the care and the measures set out in the
  [Data Processing Agreement](./DPA.md), which is part of these terms.
- Not touching your families' data beyond what you have asked us to do with it.
- Telling you within 72 hours if something goes wrong with it.
- Keeping your export working, including after you cancel.

### 5.1 No uptime commitment, and why we are saying so

We do not offer a service level agreement or an uptime credit. We would rather
say that than print a number we cannot yet stand behind: there is presently one
application instance and one database.

We will tell you before a planned interruption and will work to restore an
unplanned one promptly. If that is not enough for your home, say so before you
sign rather than after.

## 6. Money

**What you pay** is in your Order. Billing runs through Stripe; prices, cards,
invoices, tax, and receipts live there, because a second source of truth for
money is always the wrong one.

**The trial** runs 30 days from the day you register. We will tell you a week
before it ends, the day before, and on the day.

**What a lapsed subscription stops** is one thing: opening a *new* case.
Everything else keeps working, deliberately and without exception.

- A family part-way through uploading photographs of their mother does not lose
  access because you changed billing plans.
- A director is not locked out of Thursday's funeral because a card expired. An
  expired card is an administrative problem; Stripe chases the payment.
- Aftercare check-ins a family has already consented to still go out.
- **Export keeps working.** Always.

Only cancellation stops new cases. We may suspend an account for non-payment
after written notice, and suspension has the same narrow effect: no new cases,
nothing else.

**Refunds.** If you cancel mid-term we do not refund the remainder unless we
have materially failed to provide the service, in which case we will refund pro
rata. If we raise the price we will give you 60 days' notice and you may
cancel before it takes effect.

## 7. Your data is yours

You own everything you and your families put into this service. We claim no
license to it beyond what running the service requires, and none at all to use
it for anything else — see Sections 1 and 3 of the
[DPA](./DPA.md), which say so as prohibitions.

Any case exports as a folder that opens without this software, and that keeps
working after you cancel. **We will not hold your data to get a bill paid.**

On termination your data stays available for 90 days and is then deleted.

## 8. What we own

The software. You get a non-exclusive, non-transferable right to use it while
your account is open. You may not resell it, sublicense it, copy it, or use it
to build a competing service.

Your name and logo stay yours; we use them in the service to make the family
experience look like it came from your home, which is the point. We will not
use your name as a customer reference publicly without asking you first.

## 9. Things we ask you not to do

Do not use the service to hold data about living people beyond what an
arrangement needs. Do not use it as a general document store, a wills vault, or
a place for medical directives — it is deliberately not built for any of them,
and your insurer's question about what your vendor's software stores should
have a boring answer.

Do not attempt to reach another funeral home's data, probe the service for
vulnerabilities without asking us first, or use it to send anything unlawful.

If you find a security problem, tell us at `[PRIVACY CONTACT]` and we will
thank you.

## 10. Liability

**What we do not limit.** Nothing here limits our liability for fraud, willful
misconduct, gross negligence, or anything else `[GOVERNING LAW]` does not
permit to be limited. Our obligations under Sections 3, 4, and 5 of the DPA —
what we will not do with your families' data, who at our company can see it,
and how it is secured — are not subject to the cap below.

**What we do limit.** Otherwise, and to the extent the law allows, our total
liability is capped at what you paid us in the 12 months before the claim.
Neither of us is liable to the other for indirect or consequential loss, or for
lost profits.

**The service is provided as it is.** We disclaim implied warranties of
merchantability and fitness for a particular purpose, to the extent permitted.

**What that does not excuse.** It is not a license to lose your data, and it
does not reduce the DPA's obligations to a best effort.

## 11. Changes to these terms

We may change them with **30 days' written notice** to the address on your
account. If a change is materially adverse to you, you may terminate within
those 30 days and receive a pro rata refund of anything prepaid.

We will not change Section 7 — that your data is yours and that export keeps
working — to your detriment. If we ever want to, treat it as a sign to leave.

## 12. Ending it

**You** may cancel at any time, from the service or in writing. It takes effect
at the end of the current billing period.

**We** may terminate for a material breach you have not cured within 30 days of
written notice, or immediately for the things in Section 9 that put another
home's data at risk. We will not terminate an account mid-arrangement without
giving you a reasonable opportunity to export, except where continuing would
itself be unlawful.

Sections 7, 8, 10, and the DPA's Section 9 survive.

## 13. The rest

**Governing law** is `[GOVERNING LAW]`, and the courts there have exclusive
jurisdiction.

**Notices** go to `[REGISTERED ADDRESS]` and to the email address on your
account. Email counts.

**Assignment.** Neither of us may assign these terms without the other's
consent, except to a successor in a merger or a sale of substantially all
assets — and if we are the ones acquired, the DPA's Section 3 binds whoever
acquires us. Your families' data is not an asset that changes character on a
change of ownership.

**Entire agreement.** These terms, your Order, and the DPA are the whole of it.
Where they conflict: your Order first, then the DPA on data handling, then
these terms.

**Severability.** If a clause is unenforceable, the rest stands.
