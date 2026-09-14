# Component 3 — Storefront, catalogue and the statement

**Branch:** `claude/component-3-storefront` → PR into `claude/app-capability-check-mvfn8x`
**Depends on:** Component 1
**Colorado:** read Section 3 of `COLORADO.md` **first — it shapes this component**

## The problem

The home has nothing to show a family. No catalogue, no merchandise, no prices.

## The one thing to understand before you design anything

The **FTC Funeral Rule** binds the funeral home, not us. Our job is to build a
storefront a home can use *without breaking it*. A pricing UI that makes
compliance awkward is a defect, not a trade-off.

That means, concretely:

- **Itemised prices are mandatory.** Every item carries its own price.
- **Packages may exist in addition, never instead.** A family must be able to
  decline any single item and watch the price change. A package-only storefront
  would hand every home that used it a Funeral Rule violation.
- The catalogue must **print as a General Price List, Casket Price List and
  Outer Burial Container Price List**. The print studio already renders
  print-ready HTML at real trade sizes — reuse `lib/print-render.ts`.
- **Caskets are shown only once the GPL is available.** Sequence the UI so a
  director cannot skip that.
- A family must be able to record **"we are bringing our own"** with no fee
  field on that path. A provider may not refuse a third-party casket or urn and
  may not surcharge for one. Do not build a field somebody will later fill in.

## What you own

- `lib/db/src/schema/catalogue.ts`, `lib/db/src/schema/storefront.ts`
- `artifacts/api-server/src/routes/catalogue.ts`
- `lib/api-spec/paths/catalogue.yaml`
- Catalogue management in the director console; the browsing surface in the
  family portal

## Build

**Director side.** Build the *tooling*, not the catalogue.

Every home loads its own merchandise, at its own prices, under its own
category names. **We supply none of it and we set no prices.** Not a starter
catalogue, not suggested pricing, not a "typical" markup, not a default urn.
Ship it completely empty, exactly as the vendor directory and the hymn library
ship empty, and for a stronger reason: a home's merchandise and what it charges
for it are the home's business, its margin and its Funeral Rule disclosure.

So what you build is: categories the home names itself, items with
photographs, descriptions, itemised prices and availability — all entered by
the home. Import from a spreadsheet, because that is what the home already has
sitting in a file, and typing two hundred caskets in by hand is how a director
decides this software is not worth it.

The only thing we know about a price is which number to print and which number
to charge. We never suggest one, never mark one up, and never take a cut of
one.

**Family side.** Browse gently. This is someone choosing an urn for their
mother, not shopping. No cart badge, no "customers also bought", no urgency, no
star ratings. Large photographs, clear prices, easy comparison, and the ability
to sit with it and come back. Selections save as a draft the director can see
and talk them through on the phone.

## Constraints

- **The home's goods, the home's prices, the home's margin.** We never sell our
  own merchandise through a home's portal and never take a percentage of what
  the home sells. We are paid for the software, monthly, and that is the whole
  relationship. Merchandise is how funeral homes survive, and a vendor that
  competes with the selection room — or clips it — does not get installed
  twice.
- **The money is never ours.** See "The statement, and the handoff" below.
- `pre_need` cases may browse and record a plan. They may **not** pay — see
  Section 4 of `COLORADO.md`.

## The statement, and the handoff to the home

Folded in from what was a separate component, because it comes straight out of
the catalogue and splitting it would have put a seam through one flow.

**We take no money. At all.** No payment processing, no funds held, no card
data, no Stripe Connect, no merchant of record, no percentage of what a home
sells. A family that owes the home money is **linked out to the home's own
payment page**, at the home's own processor, under the home's own merchant
account.

Homes have taken money for a century. We are not an improvement on that; we
would be another thing to reconcile. Linking out also removes money
transmission questions, PCI scope, chargebacks, and the identity-verification
wall that connected-account onboarding would otherwise put between a home and
its first day of use.

The one existing Stripe integration, in `artifacts/api-server/src/lib/billing.ts`,
is **us charging the home its monthly subscription**. That is the only money in
this system. Do not extend it to families and do not add a second Stripe
surface.

Build three things:

1. **The selection record** — what the family chose, at the home's prices, as
   line items. Draft while they decide; confirmed when the director says so.
2. **The Statement of Funeral Goods and Services Selected** — the itemised
   document the Funeral Rule requires a provider to give at the end of an
   arrangement. Generated from the actual selections, stored against the case,
   printable and savable by both sides through `lib/print-render.ts`. This is
   the legal artifact of the whole component. Get it right before anything
   prettier.
3. **The handoff** — the home stores its own payment page URL in settings. The
   family sees their itemised total and a link that says plainly where it goes,
   alongside the home's other ways of taking payment in the home's own words,
   because plenty of families will ring up or post a check.

**Say only what is true.** Nothing may imply we processed, received or
confirmed a payment. We do not know. A director marks a statement settled from
the home's own books, and that mark is a note about their records, never a
receipt from us.

No card fields and no bank fields, anywhere. Do not add one "for convenience".
The payment link must be visibly the home's, with the destination shown — a
link about money sent to a grieving family is exactly what a scammer imitates,
so it has to be boring, expected and obviously theirs. If it is missing, tell
the family to ring the home and give the number rather than showing an error.

**And no pre-need prepayment, by anyone, ever.** Under C.R.S. Title 10 Article
15 a Colorado preneed contract requires a Division of Insurance licence, a $500
filing fee, $100,000 of net worth or bond, and 85% of funds in trust — or
insurance funding instead. A `pre_need` case has no payment path and no payment
link. The plan is recorded; the money is not discussed.

## Done when

A director can load a catalogue from a spreadsheet, a family can browse and
select on a phone, the GPL/CPL/OBCPL print correctly, declining any item
changes the total, a family can record bringing their own urn with no fee
anywhere in sight, and a confirmed selection produces a correct itemised
Statement that prints.

Plus two tests that are about what must *not* exist: a `pre_need` case offers
no payment path in the UI **or** the API, and no code path in this component
moves money.
