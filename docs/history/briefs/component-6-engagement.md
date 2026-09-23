# Component 6 — Engagement, dates and the aftercare handoff

**Branch:** `claude/component-6-engagement` → PR into `claude/app-capability-check-mvfn8x`
**Depends on:** Component 1
**Colorado:** read Section 6 of `COLORADO.md` before you start

## What you own

- `lib/db/src/schema/engagement.ts`
- `artifacts/api-server/src/routes/engagement.ts`
- `lib/api-spec/paths/engagement.yaml`
- The existing `artifacts/api-server/src/routes/aftercare.ts`

## Build

**Engagement, computed once, here.** Link sent versus opened, who is actually
contributing, photographs added, forms completed, storefront activity, aftercare
enrolled / consented / declined / unsubscribed. The director console shows it
per case; Component 2 aggregates it per home. **You own the computation; they
render it.** Nobody else writes counting code.

Two audiences, two different questions. A director asks "did that text land,
and is this family stuck?" A platform admin asks "are these homes getting value
from the thing they pay for?" Answer both; do not build one dashboard that
half-answers each.

**Colorado deadline defaults in the standard schedule:**

- Death certificate filed — **72 hours from taking custody**, before disposition
- Medical certification — **72 hours from the EDRS request**
- Embalming or refrigeration — **required past 24 hours** from death
- Disposition permit and cremation authorization — before cremation

**Family-selectable dates.** Where a home offers a choice — a viewing slot, a
graveside time — the family picks from what the home made available rather than
typing a date and hoping. The home defines the options; the family chooses.

**The aftercare handoff.** After the service, the case quiets down: the working
surfaces recede and what is left is what the family wants to keep — the
photographs, the obituary, the order of service — plus the check-ins. This is
the "switches to holding today" idea from the original notes, built **inside
this product**. It is not a handoff to another application and must not become
one; see `Remember-Me/README.md` for why that separation is load-bearing.

## Constraints — the important half

- **No red. No countdowns. No urgency styling in the family portal.** A widow
  does not need a timer on her mother's obituary. Deadlines are stated once, in
  words, calmly. The director console may be more direct; it is still not red.
- **Never gamified.** No streaks, no completion score, no badges. A progress
  indicator may show *what is left*, never *how well they are doing*.
- **TCPA is real and has statutory damages per message.** Record consent with
  timestamp and source before any SMS. Honour STOP immediately and permanently
  across every message type. Identify the sender.
- The existing aftercare model already does the careful version — `pending`
  until the family says yes, consent re-checked at send time, `unsubscribedAt`
  final, deliveries claimed with a conditional update so two triggers cannot
  double-send. **Do not weaken any of that.** Extend the same pattern to
  anything new that sends.
- Engagement metrics are for helping a family and proving value to a home.
  They are not for scoring grief. Nothing you build ranks families.

## Done when

A director can see whether a link was opened and who is stuck, Component 2 has
per-home aggregates to render, the Colorado deadlines apply themselves to a new
case with a service date, a family can pick from offered slots, the post-service
view shows what the family keeps, and no new sending path can fire without
recorded consent.
