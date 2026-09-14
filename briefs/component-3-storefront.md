# Component 3 — Storefront and catalogue

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

**Director side.** Build the catalogue: categories (caskets, urns, keepsakes,
outer burial containers, flowers, stationery), items with photographs,
descriptions, itemised prices, availability. Import from a spreadsheet, because
that is what the home already has. Ships **empty** — we do not invent a
home's merchandise, for the same reason the vendor directory and hymn library
ship empty.

**Family side.** Browse gently. This is someone choosing an urn for their
mother, not shopping. No cart badge, no "customers also bought", no urgency, no
star ratings. Large photographs, clear prices, easy comparison, and the ability
to sit with it and come back. Selections save as a draft the director can see
and talk them through on the phone.

## Constraints

- **The home's goods, the home's margin.** We never sell our own merchandise
  through a home's portal. Merchandise is how funeral homes survive, and a
  vendor competing with the selection room does not get installed twice.
- Payment is **Component 4**. Build the selection, not the transaction. Model
  the data so the Statement of Funeral Goods and Services Selected can be
  generated from it without guessing.
- `pre_need` cases may browse and record a plan. They may **not** pay — see
  Section 4 of `COLORADO.md`.

## Done when

A director can load a catalogue, a family can browse and select on a phone, the
GPL/CPL/OBCPL print correctly, declining any item changes the total, and a
family can record bringing their own urn with no fee anywhere in sight.
