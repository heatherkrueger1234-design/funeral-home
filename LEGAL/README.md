# The legal documents, and what is still missing from them

Three drafts live in this folder:

| File | Who signs or reads it | What it does |
| --- | --- | --- |
| [`TERMS.md`](./TERMS.md) | The funeral home | The commercial agreement: what they get, what they owe, what happens when it ends. |
| [`DPA.md`](./DPA.md) | The funeral home, and their insurer | The data-processing agreement. The document an insurer asks for. |
| [`PRIVACY.md`](./PRIVACY.md) | Anyone — it goes on the website | What is collected, why, and who it reaches. |

## Read this first

**These are drafts, not advice, and none of them has been reviewed by a
lawyer.** They were written against the code rather than from a template,
which makes their factual claims checkable — every one is annotated below with
the file that makes it true. That is the part a template cannot give you and
the part a lawyer will not write for you.

What it is not is a substitute for that review. Funeral services are regulated
per state, the documents contract on behalf of a company whose name and state
of incorporation are still blank, and a promise in a signed DPA is a promise
whether or not anyone checked it was achievable. **Do not put these in front of
a paying customer until a lawyer licensed in Colorado has been through them.**

## What a lawyer has to fill in

Every one of these is `[BRACKETED]` in the drafts, so they are greppable:

```sh
# Every placeholder, and nothing else. The second filter drops ordinary
# markdown link labels such as [DPA](./DPA.md), which are not placeholders.
grep -rn "\[[A-Z][A-Z_ ]*\]" LEGAL/*.md | grep -v "](\."
```

| Placeholder | What it needs |
| --- | --- |
| `[LEGAL ENTITY]` | The company name, and whether it is an LLC or a corporation. |
| `[STATE OF INCORPORATION]` | Governs the entity. |
| `[GOVERNING LAW]` | Which state's law governs these contracts, and where disputes are heard. Colorado is the obvious answer and is not automatically the right one. |
| `[REGISTERED ADDRESS]` | For notices. A PO box is usually not enough. |
| `[PRIVACY CONTACT]` | The address a data request arrives at. It must be monitored by a person. |
| `[HOSTING PROVIDER]` and `[REGION]` | Named in the DPA's sub-processor list. Cannot be filled in until something is actually deployed. |
| `[BACKUP LOCATION]` | Where the off-host copy lives. Also a sub-processor. |
| `[SMTP PROVIDER]` | Whoever ends up sending the mail. Also a sub-processor. |
| `[LOG RETENTION]` | How long server logs are kept. Pick a number once there is somewhere to keep them. |
| `[EFFECTIVE DATE]` | The day these go live. |

## Decisions the business has to make, not the lawyer

These are already written into the drafts at what I judged to be a defensible
number. They are commitments, so change them on purpose rather than by
accident:

| Decision | Drafted as | Why that number |
| --- | --- | --- |
| Breach notification to the home | Without undue delay, and **within 72 hours** of becoming aware | The GDPR/CPA convention. Anything longer reads badly to an insurer; anything shorter is hard to honor while still knowing what you are telling them. |
| Notice before adding a sub-processor | **30 days**, with a right to object | Standard. It is also the window that makes the list above maintainable. |
| Data kept after a home cancels | **90 days**, then deleted | Long enough that a home which cancels by mistake, or in the middle of a bad month, does not lose its families' files. Short enough not to be a warehouse of other people's data. |
| Backup retention | **30 days** (`BACKUP_RETAIN_DAYS`) | Already the code's default. It is also the honest answer to "when is an erased case really gone". |
| Automatic deletion of case data | **Never** | Not a gap. Retention is set by state law and the home's insurer, and a product that purged at 36 months would destroy records a home must keep. See `RETENTION.md`. |
| Uptime commitment | **None offered** | Deliberate. There is no second API instance, no managed database with point-in-time recovery, and no monitoring that pages a human. Promising 99.9% before any of that exists would be a term you would breach in month one. Revisit when the infrastructure earns it. |
| Signing a HIPAA BAA | **Declined**, with the reason stated | A funeral home is not a HIPAA covered entity, so there is no covered relationship to flow down to us. Signing one anyway would assert a legal relationship that does not exist. Worth confirming with the lawyer, because homes will ask. |

## What is true today, and is cited in the drafts

Each security claim in `DPA.md` Schedule 2 points at the thing that makes it
true. Spot-check them; a claim that quietly stops being true is worse than one
that was never made.

| Claim | Where it lives |
| --- | --- |
| Uploads and social security numbers encrypted with AES-256-GCM before they are written | `lib/db/src/crypto.ts`; verified at rest — stored bytes carry 29 bytes of version, IV and GCM tag and are not the plaintext file |
| The encryption key is never in the database | `lib/db/src/crypto.ts` reads it from the environment; the server refuses to start without it |
| Every table carries `funeralHomeId`, and staff queries filter on the signed-in user's own row rather than on anything in the request | `artifacts/api-server/src/middleware/require-auth.ts`; `test/tenant-isolation.test.ts` |
| A family link reaches exactly one case, and no family route takes a case id | `artifacts/api-server/src/routes/family.ts`; `middleware/require-family.ts` |
| Only the SHA-256 of a family link is stored | `artifacts/api-server/src/lib/family-link.ts` |
| Passwords are hashed with scrypt at OWASP parameters | `artifacts/api-server/src/lib/auth.ts` |
| Every access we make across a tenant boundary is logged before the data is returned | `artifacts/api-server/src/routes/admin.ts`; `platform_audit` |
| We can grant and revoke our own staff's access to that console, and both are logged | `lib/db/src/schema/platform.ts`; `lib/platform-auth.ts` |
| No analytics, no telemetry, and no training on customer data | Nothing in the codebase sends anything anywhere except the four services in Schedule 1 |
| Case content reaches none of those four services | `RETENTION.md`, "What leaves the building" |
| A case exports as a folder that opens without this software, and keeps working after cancellation | `artifacts/api-server/src/routes/export.ts` |
| Erasure destroys the encrypted bytes, not just the reference | `routes/export.ts` case delete; verified — `uploads` is empty afterwards |
| Social security numbers are excluded from exports | `routes/export.ts` |
| Aftercare sends nothing until the family consents, and a decline is final | `lib/db/src/schema/aftercare.ts`; `test/aftercare-loop.test.ts` |
| Every check-in carries the home's postal address and a working unsubscribe | `lib/mailer/src/aftercare.ts`; `test/aftercare-sender.test.ts` ("the foot of a check-in") |

## Three things to fix in the product because of these drafts

1. **`RETENTION.md` says the data lives "on infrastructure you chose" and tells
   the home to keep a copy of the encryption key.** That was true of a
   self-hosted product and is not true of this one. The platform admin console
   reads across tenants, Stripe meters funerals per home, and homes get trial
   reminders by email — that is a hosted service, and it means **we** hold the
   key and **we** carry the consequence of losing it. `DPA.md` is written for
   the hosted model. `RETENTION.md` needs correcting to match, or it will be
   read against us.

2. **Photograph metadata is not stripped from ordinary uploads.** Found while
   trying to verify a claim I had already written into Schedule 2, which is the
   argument for checking them: an image over 3000 pixels on its long edge is
   re-encoded and loses its EXIF, and **anything smaller is stored exactly as
   sent** — GPS coordinates included. Verified by putting a marked EXIF block
   through `normaliseImage`: it survives at 800×600 and is gone at 4000×3000.
   That metadata then travels in the photo pack a director emails to a print
   shop and in the case export. The drafts now disclose it instead of claiming
   otherwise, in both `DPA.md` Schedule 2 and the family-facing part of
   `PRIVACY.md`.

   The fix is a product decision rather than an obvious one, which is why it is
   not already made. Re-encoding everything would strip it and cost one
   generation of JPEG recompression on every photograph — against a codebase
   that deliberately keeps the original bytes and stores the portrait crop as
   instructions for exactly that reason. The narrower option is to strip the
   EXIF segments out of the JPEG losslessly where the orientation tag says the
   pixels are already upright, and re-encode only the ones that need rotating.
   That preserves the stated value and covers the common case, and it is more
   code. Worth deciding before a home sends a photo pack to a print shop.

3. **A home cannot see the access log about itself.** `platform_audit` records
   every time we look across the tenant boundary, which is the single most
   persuasive thing in the DPA — and today only the platform console can read
   it. The DPA therefore promises the log "on request", which is true but
   weaker than it needs to be. A read-only endpoint scoped to the requesting
   home's own rows would let the clause say "visible to you, whenever you
   like", and that is a different sentence in a sales conversation.
