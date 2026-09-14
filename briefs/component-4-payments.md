# Component 4 — The statement, and handing off to the home

**Branch:** `claude/component-4-payments` → PR into `claude/app-capability-check-mvfn8x`
**Depends on:** Components 1 and 3
**Colorado:** read Section 4 of `COLORADO.md` before writing a line

## Read this first: we do not take money. At all.

This product processes no payments, holds no funds, stores no card details and
takes no percentage of anything a home sells. There is no Stripe Connect here,
no merchant of record question, no split, no escrow, no "on behalf of".

What we do is: record what the family selected, produce the itemised statement,
and **link the family out to the funeral home's own payment page** — the one
the home already has, at the home's own processor, under the home's own
merchant account.

This is the correct architecture and it is worth understanding why, because
almost every instinct in software pushes the other way:

- **Homes already take money.** Cards, checks, insurance assignments, payment
  plans. They have a processor and a bookkeeper and a way of doing it. We are
  not an improvement on that; we are a new thing to reconcile.
- **Every dollar that touches us is a regulator.** Holding or routing funds on
  a home's behalf raises money transmission questions in every state we sell
  into. Linking out raises none.
- **Connect onboarding is where homes quit.** Standing up a connected account
  means identity verification, bank details and underwriting before the home
  can take a cent. That is a wall in front of a product whose whole pitch is
  that it is easier than what they do now.
- **Refunds, chargebacks and disputes stay the home's**, which is where they
  belong and where the relationship with the family already is.

The single existing Stripe integration, in `artifacts/api-server/src/lib/billing.ts`,
is **us charging the home its monthly subscription**. That is the only money in
this system. Do not extend it, do not reuse its patterns for families, and do
not add a second Stripe surface.

## And no pre-need prepayment, by anyone, ever

Separately from the above: nothing in this product may take, hold or arrange
payment for a funeral that has not happened.

Under C.R.S. Title 10, Article 15, selling a preneed funeral contract in
Colorado requires a **Division of Insurance licence**, a **$500 filing fee**,
**$100,000 of net worth or a $100,000 bond**, and **85% of all funds received
placed in trust** — or the contract funded by insurance instead. Those are the
only two lawful funding methods.

A `pre_need` case therefore has no payment path and no payment link. Not a
deposit field, not a "reserve this", not a link out. The plan is recorded; the
money is not discussed. If a home sells preneed contracts they do so under
their own DOI licence, through their own trustee or insurer, entirely outside
this software.

If you find what looks like a clean way around any of this, you have found the
thing that costs the business its standing. Raise it. Do not build it.

## What you actually own

- `lib/db/src/schema/orders.ts` — what a family selected, and its statement
- `artifacts/api-server/src/routes/orders.ts`
- `lib/api-spec/paths/orders.yaml`

No `payments.ts`. There is nothing to put in it.

## Build

**The selection record.** What the family chose, at the prices the home set, as
line items. Draft while they are deciding; confirmed when the director says so.
Component 3 owns the catalogue and the browsing; you own what comes out of it.

**The Statement of Funeral Goods and Services Selected.** The itemised document
the FTC Funeral Rule requires a provider to give at the end of an arrangement.
Generated from the actual selections, stored against the case, printable and
savable by both sides. Reuse the print pipeline in `lib/print-render.ts` — it
already produces print-ready HTML at real sizes.

This document is the real deliverable of this component. Get it right.

**The handoff.** The home stores its own payment page URL in settings. When a
statement is ready, the family sees their itemised total and a link that says
plainly where it goes — the home's name, the home's site. Alongside it, the
other ways the home takes payment, in the home's own words, because plenty of
families will ring up or post a check.

**Say what is true.** The UI must never imply we processed, received or
confirmed a payment. We do not know whether they paid. The director marks a
statement settled when the home's own books say so, and that mark is a note
about the home's records, not a receipt from us.

## Constraints

- **Colorado Consumer Protection Act.** No fee appears after a total is shown.
  No pre-ticked add-ons. No scarcity, urgency or countdown, ever. The first
  number the family sees is the number on the statement.
- Itemised always. Packages only ever in addition to itemised prices, never
  instead — same Funeral Rule reasoning as Component 3.
- **No card data, no bank details, no payment credentials** enter this system.
  There is no field for them. Do not add one "for convenience".
- The payment link is the home's, validated as a URL on the home's own domain
  where we can tell, and shown with the destination visible. A link about money,
  sent to a grieving family, is exactly what a scammer would imitate — so it
  must be boring, expected, and obviously the home's.
- Failure copy is gentle. If the link is missing or wrong, the family is told
  to ring the home, with the number, not shown an error.

## Done when

A confirmed selection produces a correct itemised Statement that prints, the
family sees their total and a clearly-labelled link to the home's own payment
page, a `pre_need` case offers no payment path in the UI **or** the API, and
there is no code path anywhere in this component that moves money — with tests
for the last two.
