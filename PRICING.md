# What we charge, who we charge, and the one we turned down

Written against what is in the code. The numbers live in one file,
`lib/db/src/price-book.ts`: the marketing site shows them, the Stripe setup
script creates them, and the tests below check the arithmetic. Invoices
still come from Stripe; this code never bills anybody.

## The price

| | |
| --- | --- |
| Per location | **$169 a month** |
| Per funeral served | **$7**, counted once, at-need only |
| Annual | **$1,690 a location a year**: twelve months for the price of ten |
| Activation or setup fee | **None** |
| Aftercare, texts and email to families | **Included**, not add-ons |
| Free trial | **30 days from registering, no card.** Subscribing during it keeps the days that are left; the card is first charged when they end |
| Families | **Never charged, for anything, ever** |

A home with ten funerals a month pays $169 + $70 = **$239**. A rural home
with two pays $183. A group pays per location on one invoice.

## Why it costs us what it does

Per home, per month, at 10 homes each serving 10 funerals a month
(`monthlyCostDollars` in `price-book.ts`; `scripts/src/lib/stripe-plan.test.ts`
checks these figures):

| Line | Cost | Basis |
| --- | --- | --- |
| SMS | $5.00 | ~45 segments a funeral (link, reminders, aftercare) at ~$0.011 including carrier fees (Twilio US pricing) |
| 10DLC | $4.00 | Campaign monthly fee and a number, plus the one-off brand registration and vetting spread over two years (Twilio A2P 10DLC fees) |
| Email | $1.00 | ~65 messages a funeral at ~$1.50 per thousand (Postmark) |
| Photo storage | $4.00 | ~$0.40 a funeral, encrypted, with backups |
| Hosting share | $15.00 | ~$150 a month of platform, split across ten homes |
| Support | $25.00 | Time spent answering a home, per month |
| Onboarding | $6.00 | ~$150 of setup help, spread over two years |
| Stripe | $8.90 | Stripe Billing 0.7% plus card 2.9% + 30¢ on $239 |
| **Total** | **$68.90** | against **$239** of revenue: **71% gross margin** |

For comparison, aftercare on its own is sold at about $150 a month (Tukios);
this is the whole arrangement, aftercare included, for $169 plus $7 a funeral.

Margin by home size and fleet size (funerals a month across the top):

| Homes in fleet | 1/mo | 3/mo | 5/mo | 10/mo | 20/mo | 40/mo |
| --- | --- | --- | --- | --- | --- | --- |
| 5 | 59% | 60% | 62% | 65% | 69% | 73% |
| 10 | 67% | 68% | 69% | 71% | 74% | 76% |
| 16 | 70% | 71% | 72% | 74% | 75% | 78% |
| 25 | 72% | 73% | 74% | 75% | 77% | 78% |
| 50 | 74% | 75% | 75% | 76% | 78% | 79% |
| 100 | 75% | 75% | 76% | 77% | 78% | 79% |

Honestly stated: at ten homes the typical home clears 70%, but a home doing
five funerals a month or fewer sits at 67–69%, because the fixed hosting
share is the biggest line. From about **sixteen homes**, every size of home
clears 70%, even one doing a single funeral a month. Support is the number
most likely to be wrong; it is modelled flat per home.

## How funerals are counted

Volume pays more. That is how this category prices, and more to the point it
is what lets a rural home with nine funerals a year afford the base rate at
all.

Three decisions inside it are worth knowing before you quote anybody:

**A pre-need file is not a funeral.** Somebody writing down what they want at
their own funeral is not work done, and a home charged for every pre-need
enquiry will very sensibly stop recording them — which breaks the feature
that wins the *next* generation of that family's business. Pre-need files are
counted on the day they convert to at-need, and not before.

**Trial cases are counted and waived.** Not skipped. `billable_cases` carries
a `waived_reason`, so "we handled four funerals and you billed us for one" is
a question with an answer rather than an absence a customer has to take on
trust. The director can see the running count in their own console, labelled
in as many words as *a count of funerals, not a bill*.

**A case is billed once, ever.** Enforced by a unique index rather than by the
code that writes it, and again by an idempotency key on the Stripe meter
event. A home billed twice for burying the same person will not accept that it
was a rounding error, and they will be right not to.

Counting is local and instant; reporting to Stripe is a separate scheduled job
(`.github/workflows/usage.yml` → `POST /api/tasks/usage`). Nothing calls Stripe
while a director is opening a case. A funeral home at eight in the morning with
a family on the way in must never be waiting on `api.stripe.com`, and must
never be refused by it.

## Aftercare is in the price

It used to be sketched as an add-on. It is included now: it is the feature
that produces the repeat family, and a home should not have to decide
whether grieving families deserve a check-in. Leave
`STRIPE_PRICE_ID_AFTERCARE` **unset**; `hasAddOn` then treats aftercare as
part of every paying plan (`lib/db/src/schema/plans.ts`).

One guardrail is not negotiable and is not configurable:

> A family already enrolled keeps receiving their check-ins — thirty, sixty,
> ninety days and the anniversary — even if the home drops the add-on, lets
> the subscription lapse, or leaves entirely.

Somebody promised that family, in the home's name, that they would hear from
them on the anniversary of their mother's death. A billing event on our side
is not a reason to break it. The entitlement gates *enrolling somebody new*
and nothing else; `runAftercare` never asks who is paying.

## Groups

`home_groups`: one Stripe customer, one subscription, one invoice, forty
locations. Base subscription at quantity-per-location, per-case metered across
the whole estate. This is the only way a rollup buys anything — selling them
one seat at a time is forty conversations to close the revenue of one.

Managed from the platform console (`/api/admin/groups`), not from any home's
own settings, because a group contract is negotiated by a person at this end
with a person who owns forty funeral homes.

Three things it deliberately does **not** do:

- **No shared branding.** The obvious feature is the group's logo flowing down
  into every location's family portal. It is exactly wrong: rollups buy local
  names *because* a family in that town has trusted that name for eighty
  years, and taking it off the page the bereaved family actually sees destroys
  the asset they paid for.
- **No cross-location visibility.** Membership is a billing relationship.
  Every query still filters on `funeralHomeId` read off the signed-in user's
  own row, and there is no group session that could widen it. Group-level
  reporting is a real thing they will ask for, and it is the same cross-tenant
  read the platform console does — audit log and all — so it gets built
  deliberately when somebody asks, and not by quietly loosening the one
  predicate the whole security model rests on.
- **No branch self-service billing.** A location inside a group cannot start
  its own checkout or open Stripe's portal. One branch must not be able to
  cancel the contract covering the other thirty-nine.

Moving a location *out* of a group gives it a fourteen-day grace period on a
real dated trial rather than cutting it off. A branch sold to an independent
owner on Tuesday has funerals on Wednesday.

## The one we turned down: charging the family for the obituary and slideshow

The proposal is a second revenue line off a case we already serve: the
software has written the obituary and assembled the slideshow, the family is
right there, and they would pay for a keepsake. It converts. Every argument
for it is a real argument.

It is not built, and it should not be:

1. **It puts us back in the money business we deliberately left.** The product
   processes no payments, holds no funds and stores no card details.
   `COLORADO.md` Section 4 lists what that buys: no money-transmission question
   in any state we sell into, no PCI scope, no chargebacks or refunds to
   adjudicate, and no connected-account identity wall between a home and its
   first day of use. A family-facing charge re-imports all four in order to
   sell a PDF.
2. **It is the home's Funeral Rule problem, and we would be creating it.** The
   charge appears inside the home's own branded portal, for something attached
   to a funeral, without appearing on the home's General Price List or on the
   Statement of Funeral Goods and Services Selected. The Funeral Rule binds the
   *provider*. We would be manufacturing a compliance exposure and handing it
   to the customer, in fifty states at once.
3. **C.R.S. 6-1-101.** No fee appears after a total is shown; the number the
   family sees first is the number they pay. A keepsake upsell during an
   arrangement is the practice that section describes.
4. **It is a toll, not an upsell.** The slideshow is assembled out of
   photographs the family uploaded of their own mother. Charging them to get it
   back is not a product. And the complaint goes to the director whose name is
   at the top of the page — not to us — which makes the careful version also
   the commercially correct one, exactly as it was for aftercare consent.

The memory book built over the aftercare year is the same answer and the
sharpest version of the question, because it is the most sellable thing this
product makes: a bound keepsake, finished on the anniversary, with the
family's own words in it. It is free to them, it prints from the same
renderer the funeral home uses with no watermark and no missing page, and it
keeps printing after the home has cancelled.

So the obituary, the photograph pack and the memory book are free to the
family for ever, including after the home has cancelled, been suspended, or
left.
`no-family-charges.test.ts` fails the build if that stops being true: it
asserts that the family and public routers never so much as import the billing
code, and that a family whose funeral home has been cancelled *and* suspended
can still read their obituary and download their photographs.

If a home wants to charge for a keepsake it already can, the correct way: as a
line on its own price list, on its own statement, through its own processor.
That is its sale to make, with its own disclosures attached.

## Before you charge a single home

1. **Create the prices.** `pnpm --filter @workspace/scripts run stripe-setup`
   prints the plan; with `STRIPE_SECRET_KEY` and `STRIPE_CASE_METER_ID` set,
   `-- --apply` creates the monthly and annual location prices and the two
   metered funeral prices by lookup key (re-running finds rather than
   duplicates) and prints the `STRIPE_PRICE_ID*` lines to paste into the
   environment. Until then, every subscribe button starts the 30-day no-card
   trial and nothing else changes.
2. **Leave `STRIPE_PRICE_ID_AFTERCARE` unset**, so aftercare stays included.
3. **Schedule `POST /api/tasks/usage`** (`usage.yml`), or funerals are never
   reported and every home is invoiced the flat rate only.
4. **Point Stripe at the webhook, and set three things in its dashboard.**
   The endpoint is `https://<api host>/api/billing/webhook`, sending
   `customer.subscription.created`, `.updated` and `.deleted`; its signing
   secret is `STRIPE_WEBHOOK_SECRET`. Then, under Billing:
   - **The reminder email before a free trial ends: on.** A home that
     subscribes during its trial hears about the end of it from Stripe, with
     the amount, rather than from us (`lib/trial-reminders.ts` leaves it out).
   - **Customer portal cancellations: at the end of the billing period.** A
     home that cancels during its trial then keeps the days it has left.
   - **When every retry of a failed payment has failed: cancel the
     subscription.** Stripe's "unpaid" keeps a home opening cases, as
     "past due" does, so "mark as unpaid" or "leave past due" would let a
     home that has stopped paying carry on indefinitely.
5. **Run one real billing cycle in Stripe test mode**, monthly and annual,
   including a metered invoice, a subscription started during a trial, and
   one cancelled. Stripe has never taken a real payment here.
