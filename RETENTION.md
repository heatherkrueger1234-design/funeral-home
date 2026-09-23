# What we keep, where it is, and how to get rid of it

Written for the person at a funeral home who has to answer a family, an
insurer, or a state board. It describes what this software actually does — not
what a policy page would like to imply — so where the honest answer is "that is
your decision, not ours", it says so.

## The short version

| Question | Answer |
| --- | --- |
| Where does our data live? | In one PostgreSQL database, on infrastructure **you** chose. This is not a hosted service holding your files. |
| Who else can read it? | Nobody. There is no analytics pipeline, no third-party logging of case content, and no shared tenancy in the database. |
| Do you delete our cases automatically? | **No.** Nothing on a case is ever deleted on a timer. See below — this is deliberate. |
| Can we get everything out? | Yes. `Export` on any case, and it keeps working after you cancel. |
| Can we erase a case for good? | Yes. It is permanent and it takes the photographs with it. |
| What about backups? | They are yours, and an erased case stays in them until they age out. |

## We do not auto-delete case data, on purpose

It would be easy to add a "purge after N years" setting and it would look
responsible. It would also be wrong.

Funeral homes are required to retain records, and for how long is set by state
law and by the home's own insurer — it varies, and it is not something a
national piece of software can decide from Denver. A product that quietly
deleted a case at 36 months because that seemed a sensible default would be
destroying records a home is legally obliged to hold.

So the position is: **nothing about a case expires.** It stays until somebody
at the home decides otherwise and says so, by erasing it.

What the home should do is decide its own retention period, write it down, and
use the erase function to apply it. If that becomes a chore worth automating,
it should be automated with the home's rule, not ours.

## What does expire, automatically

Credentials and working state, none of which is case content:

| Thing | Lifetime | Why |
| --- | --- | --- |
| Staff sessions | 30 days, then purged | A signed-in browser left on a shared office computer. |
| Password reset links | 60 minutes, single use | Standard, and short on purpose. |
| Family links | 90 days from issue, extended while a memory book is open | Long enough for the arrangement and the aftermath, short enough that a forwarded text stops working eventually. Re-issuing is one click and kills the old one. See the note below on the extension. |
| The case message thread | Locks 14 days after the service | Not deleted — locked. The thread stays readable forever; what stops is new messages, which is the promise that this tool ends the endless thread. |
| Intake requests | Kept until reviewed, then kept | They are a record of somebody asking. Declining one does not erase it. |
| Memory books, life stories, eulogies and memories | Never expire | They are case content and follow the case. Closing a book stops new entries; it deletes nothing and hides nothing. |

### Why a family link can outlive its 90 days

A link normally lasts 90 days from issue. When a case has an **open memory
book** and the family has **consented to the aftercare check-ins**, each
check-in that goes out pushes that contact's expiry back out to 90 days from
that moment.

The reason is arithmetic: the check-ins run to the first anniversary, and a
link issued during the arrangement would be dead well before it. Without the
extension the book quietly stops accepting anything from the family somewhere
around the third message — a collection feature that works right up until the
year it was built for.

What the extension deliberately does not do:

- It does not mint a new token. The link in the text message the family
  already has is the one they will actually click, and it keeps working.
- It does not touch a **revoked** link. Revocation stays absolute; a director
  who kills a link has killed it.
- It does not apply to a family who never consented, or to a case whose book
  is closed or was never opened.

If you want a family's access to end sooner than that, revoke the link or
close the book. Both are one click and both take effect immediately.

## Erasing a case

`Erase this case` on the case, or `POST /api/cases/:id/delete`.

Only the home's **owner** can do it. Erasing is how a home applies its own
retention rule, and that rule is the home's legal obligation, not any one
employee's; it sits with the person who also holds billing and who works here.
A director or member of staff sees the section with the reason and is refused
by the server. If a family asks them, they export the case and take it to the
owner.

It requires the deceased's name typed out, not a confirmation button. That is
because this destroys the only copy of a family's photographs of their mother
that exists anywhere outside your backups, and an "OK" button is something a
tired person dismisses without reading.

When it completes, the following are gone from the database: the case, every
photograph and the encrypted bytes behind them, the obituary draft, the service
selections, the belongings and their chain of custody, the vital statistics
including the encrypted social security number, the message thread, the
timeline, the family's contact details and their link, any aftercare
enrolment and its scheduled check-ins, and **the memory book — the life
story, the eulogies, the record of the day, and every memory written in
it**.

The memory book is worth naming separately because it is the one thing here
that other people wrote. A cousin's paragraph about the caravan at
Mablethorpe, a chapter somebody added about the house on Cedar Street, a
eulogy a son read at the service: all destroyed along with everything else,
at the request of whoever asked, and no copy is kept.

**What survives is a tombstone**: the former case number, who erased it, when,
and the reason they typed. It holds no name — "delete everything about my
mother" must not quietly leave her name in a table forever. The tombstone
exists so that a home can later prove it did what it was asked, because a
deletion that leaves no trace at all is indistinguishable from data loss.

### Erasure and backups: say this plainly

Erasing a case removes it from the live database immediately. It does **not**
reach into backups already taken. A case erased today remains in yesterday's
dump until that dump ages out of your retention window (`BACKUP_RETAIN_DAYS`,
30 by default).

This is normal, it is what every system with backups does, and a family asking
for erasure deserves to be told it rather than given an unqualified "it's
gone". The honest sentence is: *"It is deleted from our system now, and it will
be gone from our backups within thirty days."*

If a stronger promise is needed, the backup retention window is the dial to
turn, and turning it down costs you recovery time on the day you need it.

## Encryption

Every uploaded file and every social security number is encrypted with
AES-256-GCM before it is written, using a key held in the application's
environment and never in the database.

Backups are encrypted too, as a whole file, with the same key. A dump is
mostly plaintext SQL otherwise — names, addresses, vital statistics, message
bodies — since only the columns above are ciphertext on their own. A stolen
or misplaced backup is worth nothing without the key, not just the two
columns that would otherwise stand out inside it.

The corollary is the one thing a home must get right: **lose the key and the
photographs, and the backups, are lost.** Not recoverable by us, not
recoverable by anyone. Keep a copy somewhere that is neither the application
host nor the backup.

## What leaves the building

| Goes out | When | Carrying |
| --- | --- | --- |
| SMS (Twilio) | A director sends a family link | The link, and the home's name |
| Email (your SMTP) | Password resets, staff invites, aftercare check-ins, intake notifications | As above; aftercare carries the message the home wrote |
| Stripe | Subscription only | Your billing details. No case data, ever |
| Google Places | Only if you set a key, only when a vendor search runs | The search terms and a ZIP code. No family details |

Case content — photographs, obituaries, messages, vital statistics — is sent to
none of them.

The case export is the one deliberate exception, and you are the one who
triggers it. Once a zip is on somebody's laptop it is outside all of this.

## What this software does not do

- It does not retain a copy of anything after you delete it, other than in your
  own backups.
- It does not phone home. There is no telemetry.
- It does not train anything on your families' data.
- It does not publish anything. Nothing here is public: an obituary written in
  the portal goes to the home, not to a website.
- It does not hold prices, invoices or contracts, so it is not a record of any
  transaction — for FTC Funeral Rule purposes, the disclosures and the price
  list remain entirely yours.

## If a family asks you to delete everything

1. Export the case first if you have any retention obligation that survives the
   request. You cannot un-erase.
2. Erase the case.
3. Tell them plainly: deleted from the live system now, gone from backups
   within your backup window.
4. The tombstone is your record that you did it.
