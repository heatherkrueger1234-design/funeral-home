# Component 4 — Payments and orders

**Branch:** `claude/component-4-payments` → PR into `claude/app-capability-check-mvfn8x`
**Depends on:** Components 1 and 3
**Colorado:** read Section 4 of `COLORADO.md` **before writing a line**

## Start here: what you are not building

**Pre-need prepayment. Not in any form.** This is not a close call and not a
scope negotiation.

Under C.R.S. Title 10, Article 15, selling a preneed funeral contract in
Colorado requires a **Division of Insurance licence**, a **$500 filing fee**,
**$100,000 of net worth or a $100,000 bond**, and **85% of all funds received
placed in trust** — or the contract funded by insurance instead. Those are the
only two lawful funding methods. Neither is a Stripe account.

So: a `pre_need` case has **no payment path**. No deposit field, no "reserve
this", no stored card, no "pay later" that takes money now. The plan is
recorded; the money is not taken. If a home sells preneed they do it under
their own DOI licence outside this software, and we record only that a contract
exists elsewhere.

If you think you have found a way around this, you have found the thing that
loses Heather her business. Raise it, do not build it.

## What you are building

At-need payment. Paying for a funeral that has happened or is happening this
week is ordinary commerce.

- `lib/db/src/schema/orders.ts`
- `artifacts/api-server/src/lib/payments.ts`
- `artifacts/api-server/src/routes/orders.ts`
- `lib/api-spec/paths/orders.yaml`

**Stripe Connect, home as merchant of record.** The money is the home's and
never sits with us — that keeps us out of money transmission and out of the
home's refund and tax problems. Note the existing Stripe integration in
`lib/billing.ts` is us charging the *home* for the subscription. Yours is a
family paying the *home*. Keep them clearly separate; do not overload one.

**The Statement of Funeral Goods and Services Selected** is the legal document
at the point of sale. Generate it from what the family actually selected,
itemised, store it, let both sides print it. Reuse the print pipeline.

**Payment link.** The director sends a family a link to pay for their own
selections. One case, one link, same posture as the family link: it names
exactly what it is for and reaches nothing else.

## Constraints

- **Colorado Consumer Protection Act.** No fee appears after a total is shown.
  No pre-ticked add-ons. No scarcity or countdown, ever. The first number the
  family sees is the number they pay.
- Refunds and disputes route to the home. We do not adjudicate, hold funds, or
  net anything out.
- Store no card data. Ever. Stripe holds it.
- Failure states are gentle and specific. A declined card on a funeral invoice
  is a mortifying moment for someone already at their worst — say what happened
  and what to do, never "Transaction failed".

## Done when

A family can pay itemised selections, the home receives the money directly, the
Statement prints correctly, a `pre_need` case offers no payment path anywhere in
the UI or the API, and there is a test that proves that last one.
