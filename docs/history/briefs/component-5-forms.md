# Component 5 — Forms, policies and documents

**Branch:** `claude/component-5-forms` → PR into `claude/app-capability-check-mvfn8x`
**Depends on:** Component 1
**Colorado:** read Section 5 of `COLORADO.md` **first — it is the spec**

## The 72-hour clock

Colorado replaced its five-day death certificate window (SB 23-020). A death
certificate must now be filed through the state's **Electronic Death
Registration System within 72 hours of assuming custody**, and before final
disposition. The certifying physician has 72 hours from the EDRS request.

The vital-statistics feature that already exists is, in Colorado, a 72-hour
clock. Build the forms around that: what the certificate needs, gathered first,
in the order the certificate wants it, with the fields only the family can
answer flagged as the ones that block everything.

**We do not integrate with EDRS and we file nothing.** We help the director
arrive at EDRS with every field already answered. The UI must say so plainly so
that nobody ever believes we filed it for them.

## What you own

- `lib/db/src/schema/forms.ts`, `lib/db/src/schema/policies.ts`
- `artifacts/api-server/src/routes/forms.ts`
- `lib/api-spec/paths/forms.yaml`

## Build

**Home-authored forms.** A home uploads or builds its own forms, sets which
access level may complete each, and assigns them to a case. The family fills
them in; completion is visible to both sides.

**Authorization documents are their own type**, not a generic form. They record
who authorised, **which statutory tier they claimed** under C.R.S. 15-19-106,
who at the home verified it, and when. Append-only. Where the tier requires a
**majority** — adult children, parents, siblings — each consenting person is
recorded separately. One signature is not a majority.

**Policies.** The home's own documents: price disclosures, privacy notice,
terms. Versioned, with a record of what a family was shown and when.

**Print and save.** Everything completed is printable and savable off the page
by the family, with no account. Documents about your own mother should not be
hostage to a vendor's uptime.

## Constraints

- **We never ship a legal form we invented.** No cremation authorization, no
  disposition authorization, nothing. Homes upload their own, reviewed by their
  own counsel, and we fill and route them. A national SaaS shipping its own
  authorization form hands every home a liability.
- A form requiring the `authorizing` level cannot be completed by anyone else.
  That gate is Component 1's — use it, do not reimplement it.
- **Arrive filled.** A form that asks for a date of birth the case already
  knows is a defect. Pre-fill everything derivable; the user's job is to
  correct, not to type.
- Nothing is auto-deleted, ever. Retention is the home's legal call.

## Done when

A home can upload a form and assign it, a family can complete it on a phone and
print the result, an authorization records its statutory tier and its verifier,
a majority-tier authorization records each person separately, and a
lower-level contact is refused an authorizing form by the API and not merely by
the UI.
