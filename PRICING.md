# What we charge, who we charge, and the one we turned down

Written against what is in the code, not against what a pricing deck would
like to be true. Where something is built but never run against real Stripe,
it says so.

## The shape

| Line | Who pays | Where the number lives |
| --- | --- | --- |
| Base subscription, per location | The funeral home | Stripe (`STRIPE_PRICE_ID`) |
| Per funeral served | The funeral home | Stripe, metered (`STRIPE_PRICE_ID_CASE`) |
| Grief aftercare | The funeral home | Stripe (`STRIPE_PRICE_ID_AFTERCARE`) |
| Group contract | The group, one invoice | Stripe, against the group's customer |
| The obituary, the slideshow and the memory book | **Nobody. Free to the family, for ever.** | — |

**No price appears anywhere in this repository.** Not the base rate, not the
per-case rate. The application stores a count of funerals and a set of
entitlement keys; Stripe turns those into money. A second source of truth for
money is always the wrong one, and it is the one with the friendlier user
interface, so it is the one the customer believes.

## Per-case pricing

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

## Aftercare as a line item

It is the right thing to sell separately: it is the feature that produces the
repeat family, and it costs the home nothing in staff hours, which is a very
easy thing to put a number on in a room.

It is **included in the trial regardless**, deliberately. A director who never
watches a thirty-day check-in go out in their own name has not been shown the
thing they would be buying.

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

This is the part a pricing document usually leaves out.

1. **Create the prices in Stripe.** Base, the metered per-case price and its
   meter, and the aftercare add-on. Set all five environment variables. With
   `STRIPE_PRICE_ID_CASE` and `STRIPE_CASE_METER_EVENT` empty the product sells
   a flat subscription and the usage job skips every run — a supported
   configuration, not a half-finished one.
2. **Set `STRIPE_PRICE_ID_AFTERCARE` before taking anybody off trial.** While
   it is unset, no subscription can carry the entitlement, so aftercare works
   during trials and stops at conversion. If aftercare is meant to be in the
   base price, leave it blank *on purpose* and remove the gate.
3. **Schedule `POST /api/tasks/usage`.** `usage.yml` does it, or the host's own
   scheduler. Until something triggers it, every home is invoiced for a flat
   subscription and nothing says so.
4. **Run one real billing cycle in Stripe test mode**, end to end, including a
   metered invoice. Per `LAUNCH.md`, Stripe has never taken a real payment
   here. A live charge is not tested by a test suite.
5. **Decide the numbers.** They are not in this repository and they are not
   going to be.
