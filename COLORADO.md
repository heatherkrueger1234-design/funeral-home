# Colorado: the law this product is built against

Holding Today is being built for Colorado funeral homes first. Colorado is not
a typical state to build this in — it spent decades as the only state in the
country that did not license funeral directors at all, and then, after the
Return to Nature and Sunset Mesa scandals, rewrote the whole regime in 2024.
Every home you sell to is living through that transition right now.

So the compliance posture here is not defensive paperwork. It is the product.
A director choosing software in Colorado in 2026 is choosing who helps them
survive licensure, and that is the most useful thing this app can be.

## Read this before you use any of it

**This is verified research, not legal advice, and nobody here is a lawyer.**
Every statutory cite below was checked against a primary or near-primary source
in September 2026, and the sources are listed at the bottom. That is enough to
build against. It is not enough to launch against.

Before a real family or a real dollar touches this product, a Colorado funeral
law attorney reviews: the storefront pricing UI, anything that records an
authorization, and the data-processing agreement with the homes. Those three,
specifically. Budget for it — it is a small cost against the thing it protects.

Where something below is uncertain, it says so. Do not quietly resolve an
uncertainty by picking the convenient reading.

## The one-paragraph version

Colorado now licenses funeral practitioners (deadline **1 January 2027**) and
registers establishments and crematories with DORA. Death certificates must be
filed through the state's electronic system within **72 hours** of taking
custody. Who may authorise anything is set by a **statutory priority order**,
not by who turns up first. Selling prices is governed by the **FTC Funeral
Rule**. Taking money before a death is a **licensed insurance activity** and we
are not doing it.

---

# Section 1 — Identity, roles and levels
### For Component 1

**This section is the reason the access levels exist.** Do not invent a
permission model and then justify it. The statute already wrote one.

## Who may decide: C.R.S. 15-19-106

Colorado sets a priority order for the **right of final disposition** — who
controls what happens to the body. In order:

1. The decedent, through a valid written declaration
2. An appointed personal representative or special administrator
3. The surviving spouse, if not legally separated
4. A designated beneficiary agreement holder
5. A majority of the surviving adult children
6. A majority of the surviving parents or legal guardians
7. A majority of the surviving adult siblings
8. Any person willing to assume legal and financial responsibility

Two features of this matter to us:

- **Some tiers require a majority, not a single person.** "A majority of the
  surviving adult children" is not "the daughter who answered the phone".
- **Disputes go to the probate court**, and a third party is not liable for
  refusing to act until it receives a court order or reasonable confirmation
  that the dispute is resolved. Refusing to proceed is the safe posture, and
  the software must make refusing easy rather than awkward.

## What this means for the build

The family access levels map onto this. Three levels, named for what they mean:

| Level | Who | May |
| --- | --- | --- |
| `authorizing` | The person with the right of final disposition | Everything below, plus anything the home records as an authorization |
| `arranging` | Family the authorizing person or the director has brought in | Upload, write, fill forms, message, see the timeline |
| `viewing` | Extended family and friends given a link | See and contribute photographs; read what is shared |

Rules that are not negotiable:

- **The software never determines who holds the right of disposition.** A
  funeral director does, from documents, and records it. We store *their*
  determination with who recorded it and when. An app that computed this from
  a relationship dropdown would be wrong in exactly the cases that end up in
  court.
- `authorizing` is set by staff only. Never self-selected, never inferred from
  `relationship`.
- The case carries a flag for **disposition disputed**. When set, the portal
  stops offering authorizing actions and says, plainly, that the home is
  waiting on confirmation. This is a feature, not an error state.
- Every authorizing action is written to an append-only audit record: who,
  what, when, from where. This is the evidence that protects the home.

## Passwords

The texted link stays the front door — that decision was right and the
reasoning in `lib/db/src/schema/family-contacts.ts` still holds. A password is
what a family member sets **after** they are through it, not a wall in front
of a bereaved person at the door.

- Optional for `viewing`, offered to `arranging`, **required for
  `authorizing`** before any authorizing action is recorded.
- The director can set an initial password and hand it over in person or on
  the phone, and can reset one. That is the workflow Heather described and it
  is also the right one: it keeps the "no signup form" promise while giving
  the sensitive tier a real credential.
- Reuse the existing scrypt helpers in `artifacts/api-server/src/lib/auth.ts`.
  Do not write a second password implementation.

---

# Section 2 — Licensure, registration and what we are
### For Component 2 (platform admin console)

## The deadline that is three months away

Senate Bill 24-173, signed 24 May 2024, requires licensure of **mortuary
science practitioners, funeral directors, embalmers, cremationists and natural
reductionists by 1 January 2027**. House Bill 24-1335, signed the same day,
continued the Mortuary Science Code and strengthened inspections. DORA ran
rulemaking through late 2024.

Provisional licences run three years from issue; full licences issued now run
to 30 November 2027.

**Today is September 2026.** Every Colorado home you talk to has roughly three
months and an unfinished pile of licensure paperwork. Treat that as the single
most useful thing you can know about your customer this year.

## Establishments and crematories register separately

Under C.R.S. 12-135-110 every **funeral establishment** registers with DORA,
giving its location, its appointed designee, the date it began business, and a
list of services provided at each location. Adding a service means an **amended
registration within thirty days**. Crematories register under 12-135-303. DORA
inspects both periodically, and registration status and discipline are publicly
verifiable online.

At renewal, establishments must attest whether they sell preneed contracts, and
DORA shares that with the Insurance Commissioner under a memorandum of
understanding. The two regulators talk to each other. Assume anything
inconsistent gets noticed.

## What to build

In the admin console, per home: registration number, registered services,
designee, renewal date, and licence expiries for its practitioners — with the
amended-registration 30-day rule and the 1 January 2027 deadline surfaced as
plain reminders, not red alarms.

This is genuinely useful to a director and it costs us almost nothing. It is
also the most honest possible sales demo in Colorado this year.

## What we are, legally

**We are not a funeral provider.** We do not handle remains, do not arrange
funerals, and do not sell funeral goods to consumers. We are a software vendor.
Nothing in this product may hold itself out otherwise, and no copy anywhere may
suggest we arrange, direct or advise on a funeral.

For the families' data we are a **processor** acting for the home, which is the
controller. That has to be true in the contract and in the code: homes can
export and erase their own data, we do not use family data for our own
purposes, and the data-processing agreement says so.

---

# Section 3 — Selling goods: the FTC Funeral Rule
### For Component 3 (storefront, catalogue and the statement)

The Funeral Rule is federal and binds the **funeral provider** — the home, not
us. Our obligation is to build a storefront a home can use *without breaking
it*. A pricing UI that makes compliance awkward is a defect.

## What the home must be able to produce

- A **General Price List (GPL)** — itemised services, caskets and other goods,
  given to a consumer **before they are shown caskets**.
- A **Casket Price List (CPL)**.
- An **Outer Burial Container Price List (OBCPL)**.
- A **Statement of Funeral Goods and Services Selected** — the itemised
  total, given at the end of the arrangement.

## Therefore, in the build

- **Itemised prices are mandatory.** Every item carries its own price. Packages
  may exist *in addition*, never instead.
- **Never force bundling.** A family must be able to decline any item and see
  the price change. A storefront that only sells packages would hand every home
  that used it a Funeral Rule violation.
- **The price list is printable**, from the catalogue, in GPL / CPL / OBCPL
  shape. The print studio already renders print-ready HTML — reuse it.
- **Caskets are shown only after the GPL is available.** Sequence the UI so a
  director cannot skip it.
- The Statement of Funeral Goods and Services Selected is generated from what
  the family actually selected. That document is Component 4's, but the data
  is yours — model it so the statement can be produced without guessing.

## Third-party caskets and urns — the rule that protects the offshoot

A funeral provider **may not refuse to handle** a casket or urn the family
bought elsewhere, and **may not charge a handling fee or surcharge** for it.

Two consequences:

1. The storefront must let a family record "we are bringing our own", with no
   fee field available on that path. Do not build a field somebody will
   eventually fill in.
2. This is the federal rule that makes a separate direct-to-consumer urn
   business legitimate. Third-party sellers are not funeral providers and do not
   carry the Rule's disclosure obligations.

**But that business stays outside this app.** Merchandise margin is how funeral
homes survive; a vendor whose software competes with the director's own
selection room does not get installed twice. In here, the home sells the home's
goods and keeps the margin. Heather's own instinct — "outside homes" — is the
correct architecture and this document is where it gets written down.

---

# Section 4 — Money, and why almost none of it is ours
### For Component 3 (it now carries the statement too)

## Do not build pre-need prepayment. This is not a close call.

Under **C.R.S. Title 10, Article 15**, a preneed funeral contract is any
written agreement for future funeral services for a named beneficiary. Selling
one in Colorado requires:

- A **licence from the Colorado Division of Insurance**, renewed annually
- A **$500** initial filing fee
- Demonstrated **net worth of at least $100,000**, or a **$100,000 bond**
- A Certificate of Good Standing from the Secretary of State
- **85% of all funds received** placed in trust — or the contract funded by
  insurance instead

There are exactly two lawful funding methods: trust-funded and
insurance-funded. There is no third one involving a Stripe account.

**So:** pre-need cases record the plan and take no money. There is no payment
path on a `pre_need` case, no deposit field, no "reserve this". If a home wants
to sell a preneed contract they do it under their own DOI licence, through
their own trustee or insurer, outside this software, and we record only that it
exists.

If this ever changes it changes because a Colorado insurance attorney said so
in writing, not because it looked easy.

## We do not take money, which removes most of this section

The product processes no payments, holds no funds and stores no card details.
A family that owes a funeral home money is sent to **the home's own payment
page**, at the home's own processor, under the home's own merchant account.

That is a deliberate architecture and it is what keeps this section short:

- No funds routed on a home's behalf, so no money-transmission question in any
  state we sell into.
- No card data in the system, so no PCI scope.
- No chargebacks, refunds or disputes to adjudicate — they stay with the home,
  where the relationship and the bookkeeping already are.
- No connected-account onboarding, which is the identity-verification wall that
  would otherwise stand between a home and its first day of use.

The only money in this system is **us charging the home its monthly
subscription**, in `artifacts/api-server/src/lib/billing.ts`. That surface is
not extended to families.

What we do produce is the **Statement of Funeral Goods and Services Selected** —
the itemised document the FTC Funeral Rule requires a provider to give at the
end of an arrangement — generated from what the family actually selected, and
printable by both sides.

Nothing in the interface may imply we received or confirmed a payment. We do
not know. A director marks a statement settled from the home's own books, and
that mark is a note about their records, never a receipt from us.

## The Colorado Consumer Protection Act

C.R.S. 6-1-101 et seq. Deceptive trade practice exposure attaches to how prices
are presented. Practical rules: no fee appears after a total is shown, no
pre-ticked add-ons, no countdown or scarcity pressure of any kind, and the
number the family sees first is the number they pay.

That is also just how you should treat someone whose mother died on Tuesday.

---

# Section 5 — The paperwork that is on a clock
### For Component 5 (forms, policies and documents)

## 72 hours

Following SB 23-020, a **certificate of death must be filed with the State
Registrar within 72 hours of assuming custody** of the body, and **before final
disposition**. The old five-day window is gone. The certifying physician must
complete the medical certification within **72 hours** of receiving the EDRS
request.

Death must be reported through the **state Electronic Death Registration System
(EDRS)**; electronic submission by a funeral director, coroner, physician,
registrar or health facility satisfies the signature and filing requirements.

**This is the most important number in the product.** The vital-statistics
collection feature that already exists is, in Colorado, a 72-hour clock. Build
the forms around that: what the certificate needs, gathered first, in the order
the certificate wants it, with the things only the family knows flagged as
blocking.

We do **not** integrate with EDRS and do not file anything. We help the
director arrive at EDRS with every field already answered. Say that plainly in
the UI so nobody believes we filed it for them.

## Before a cremation

Colorado imposes **no universal mandatory waiting period**. Timing is driven by
authorisation and permits. Required before cremation:

1. An **Authorization for Final Disposition**, from the county vital records
   office or the coroner
2. A **Cremation Authorization Form**, signed by the person with the legal
   right to control disposition (Section 1)

Separately: if burial or cremation occurs **more than 24 hours after death**,
**embalming or refrigeration is required**.

A crematory may not cremate without a statement naming the authorising person
and documentation that the authorisation complies with Title 15, Article 19.

## Therefore, in the build

- Authorization documents are a distinct type, not a generic "form". They
  record: who authorised, which statutory tier they claimed, who at the home
  verified it, and when. Append-only.
- A form requiring `authorizing` level cannot be completed by anyone else. The
  gate is Component 1's; use it, do not re-implement it.
- Where a tier needs a **majority** — adult children, parents, siblings — the
  form records each consenting person separately. One signature for "a majority
  of the surviving adult children" is not a majority.
- **We never generate a legal form we invented.** Homes upload their own
  authorization forms, reviewed by their own counsel, and we fill and route
  them. A national SaaS shipping its own cremation authorization would be
  handing every home a liability.
- Everything completed is printable and savable by the family, off the page,
  without an account. Documents about your own mother should not be hostage to
  a vendor's uptime.

---

# Section 6 — Contacting people, and their data
### For Component 6 (engagement, dates, aftercare)

## Deadline defaults for Colorado

The standard schedule should ship with Colorado's real clock in it:

- Death certificate filing — **72 hours from taking custody**, before
  disposition
- Medical certification — **72 hours from the EDRS request**
- Embalming or refrigeration — **required past 24 hours** from death
- Disposition permit and cremation authorization — **before cremation**

Stated calmly, once, in words. Re-read the craft standard in `TEAM-SPLIT.md`
before you render any of these: **no red, no countdowns, no urgency styling in
the family portal.** A widow does not need a timer. The director does need to
know where they stand, and that belongs in the console.

## Texting and emailing families

The whole product rests on a texted link, which puts **TCPA** squarely in
scope — federal, with statutory damages per message, and enforced by a real
plaintiffs' bar.

- Record consent, with timestamp and source, before any SMS.
- Honour STOP immediately and permanently, across every message type.
- Identify the sender in the message.
- The aftercare enrolment model already does the careful version of this:
  `pending` until the family actually says yes, consent re-checked at send
  time, `unsubscribedAt` final. **Do not weaken that.** Extend the same pattern
  to anything new that sends.

Email check-ins are marketing-adjacent and carry **CAN-SPAM** duties:
identification, a physical address, and a working unsubscribe.

## Colorado Privacy Act

C.R.S. 6-1-1301 et seq. It applies to a controller that processes the personal
data of **100,000+ Colorado consumers a year**, or **25,000+ where the
controller derives revenue from selling data**. There is no revenue threshold.

**Two things follow, and the second is the one that matters:**

1. At pilot scale we are almost certainly under the thresholds, and for the
   families' data we are a **processor** for the home rather than the
   controller regardless.
2. **That is not a reason to build it loosely.** This product holds social
   security numbers, causes of death and photographs of the dead. Health-adjacent
   and biometric-adjacent data is *sensitive data* under the CPA and requires
   freely given, specific, informed, unambiguous **opt-in consent** — and the
   CPA is explicit that broad terms-of-service acceptance, hovering, or
   deceptively designed pages are **not** consent.

So build to the standard now, while it is cheap: real opt-in, granular, no dark
patterns, honour universal opt-out signals, and a data-protection assessment on
anything high-risk. Retrofitting consent onto a live product holding SSNs is a
project nobody enjoys.

Existing choices that already do the right thing and must not be traded away:
uploads encrypted with AES-256-GCM at rest, SSNs encrypted and never read back,
only the SHA-256 of a link token stored, and no automatic deletion ever —
because Colorado retention is the home's legal call, not our default.

---

## Sources

Checked September 2026.

- [C.R.S. 15-19-106, Right of final disposition](https://law.justia.com/codes/colorado/title-15/human-bodies-after-death/article-19/part-1/section-15-19-106/)
- [Cremation laws in Colorado: waiting periods, permits, authorization, next-of-kin order](https://funeral.com/blogs/the-journal/cremation-laws-in-colorado-2026-waiting-periods-permits-cremation-authorization-next-of-kin-order)
- [Colorado mandates licensure for mortuary science professionals by 2027](https://citizenportal.ai/articles/3745034/Colorado/Colorado-mandates-licensure-for-mortuary-science-professionals-by-2027)
- [DORA Office of Funeral and Mortuary Science Services](https://dpo.colorado.gov/index.php/FuneralCrematory)
- [C.R.S. 12-135-110, Registration required](https://law.justia.com/codes/colorado/title-12/business-professions-and-occupations/article-135/part-1/section-12-135-110/)
- [C.R.S. 12-135-501, Licenses required](https://law.justia.com/codes/colorado/title-12/business-professions-and-occupations/article-135/part-5/section-12-135-501/)
- [Colorado Division of Insurance, preneed funeral contracts](https://doi.colorado.gov/insurance-products/other-products/pre-need-funeral-contracts)
- [Application instructions for preneed contract sellers (DOI)](https://doi.colorado.gov/sites/doi/files/documents/Application%20Instructions%20for%20Preneed%20Contract%20Sellers.pdf)
- [C.R.S. 10-15-105, Preneed contract requirements](https://law.justia.com/codes/colorado/title-10/preneed-funeral-contracts/article-15/section-10-15-105/)
- [C.R.S. 25-2-110, Certificates of death](https://law.justia.com/codes/colorado/title-25/vital-statistics/article-2/section-25-2-110/)
- [SB 23-020, Timely Certified Death Certificates](https://leg.colorado.gov/bills/sb23-020)
- [Colorado Electronic Death Registration (Coroners Association)](https://coloradocoronersassociation.colorado.gov/useful-information/electronic-death-registration-edr)
- [FTC, Complying with the Funeral Rule](https://www.ftc.gov/business-guidance/resources/complying-funeral-rule)
- [Colorado Privacy Act (Colorado Attorney General)](https://coag.gov/resources/colorado-privacy-act/)
- [HB 24-1335 bill text](http://leg.colorado.gov/bill_files/42527/download)
