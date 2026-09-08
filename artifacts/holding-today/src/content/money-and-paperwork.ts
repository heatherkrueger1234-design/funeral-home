import type { ChapterGroup } from "./types";

/**
 * Money and paperwork after.
 *
 * The administrative aftermath, which arrives in week three when the shock is
 * wearing off and nobody is bringing food any more. Almost all of it can be
 * delayed; the few things that cannot are marked. The organising principle is
 * that a parent should be able to open this page, find the one letter they are
 * holding, and know what to do with it.
 */

export const moneyIntro =
  "Nobody warns you that grief comes with an inbox. Bills for treatment that did not work, a tax return with a decision in it, a phone contract, a lease, a bank that wants a certified copy of something. Most of it can wait longer than the letters suggest. Here is what each thing is, and which few of them are actually urgent.";

export const moneyGroups: ChapterGroup[] = [
  {
    heading: "Start here",
    chapters: [
      {
        id: "death-certificates",
        title: "Death certificates, and how many to order",
        summary:
          "The one piece of paperwork that unlocks everything else. Order more than you think.",
        body: [
          {
            kind: "p",
            text: "Almost every organisation below will want a certified copy — not a photocopy — and many will keep it. Ordering them one at a time, weeks apart, is a slow form of torture.",
          },
          {
            kind: "list",
            items: [
              "Order ten to fifteen certified copies at the outset. The funeral home usually does this for you and the per-copy cost is small compared with reordering.",
              "Some organisations accept a photocopy or a scan. Ask before you send an original, and never send your last one.",
              "If the cause of death is pending an investigation, the first certificate may say 'pending'. Most organisations accept it; a few will need the amended one later, so plan to reorder a couple once it is finalised.",
              "You will still be finding things that need one two years from now. Keep a few.",
            ],
          },
          {
            kind: "note",
            text: "Keep one folder with the certificates, the funeral invoice, and any letters of administration in it. It saves you re-finding the same three documents on the worst day of every month.",
          },
        ],
      },
      {
        id: "what-can-wait",
        title: "What is urgent, and what is not",
        summary:
          "Almost nothing on this page needs doing this month. These few things do.",
        body: [
          { kind: "heading", text: "Genuinely time-sensitive" },
          {
            kind: "list",
            items: [
              "Keeping their phone line paid, if you want the voicemail greeting. Numbers get reassigned.",
              "Getting into their accounts and devices, or writing down where they are, before anything locks or auto-deletes.",
              "Any life insurance claim with a filing deadline, and employer benefits, which often have short windows.",
              "Victim compensation, if it applies — one to two years, and sometimes less.",
              "Cancelling a subscription that renews annually at a large amount.",
            ],
          },
          { kind: "heading", text: "Can wait months" },
          {
            kind: "list",
            items: [
              "Nearly every bill in your child's name. A debt does not become yours because someone died, and creditors can wait.",
              "Social media accounts.",
              "The car, unless it is being repossessed or accruing storage fees.",
              "Their belongings, their room, their clothes.",
              "Anything an organisation is being aggressive about. Aggression is a collections tactic, not a deadline.",
            ],
          },
          {
            kind: "warn",
            text: "Do not pay anything out of your own money in the first month because someone on a phone made it sound urgent. Almost none of it is, and money paid on a debt that was never yours is very hard to get back.",
          },
        ],
      },
    ],
  },
  {
    heading: "The bills",
    chapters: [
      {
        id: "medical-bills",
        title: "The medical bills that keep coming",
        summary:
          "Being invoiced for the treatment that did not save them, and how to actually dispute it.",
        body: [
          {
            kind: "p",
            text: "They arrive for months. The ambulance. The emergency department. A separate bill from a doctor you never met who read a scan. Some of them arrive addressed to your child.",
          },
          { kind: "heading", text: "Who actually owes this" },
          {
            kind: "list",
            items: [
              "For an adult child, the debt belongs to their estate, not to you — unless you signed as a guarantor, or you live in a state with a filial responsibility law that is actually enforced, which is rare in practice.",
              "For a minor child, parents are generally responsible for medical bills.",
              "Saying 'I'll take care of it' on a phone call can be treated as assuming the debt. Do not say it. 'Send it to the estate' is the sentence.",
              "If there is no estate and no assets, there is frequently nothing to collect, and the bill quietly ends there.",
            ],
          },
          { kind: "heading", text: "Disputing them, which is worth doing" },
          {
            kind: "list",
            items: [
              "Ask for an itemised bill in writing. Not a summary — the line-by-line. A large proportion of hospital bills contain errors, and duplicate charges are common.",
              "Check it against your insurer's explanation of benefits. Bill first, EOB second: the gap between them is the argument.",
              "Appeal every denial. Insurers deny routinely and a significant share of appeals succeed. Denials in an emergency admission are especially worth challenging.",
              "Ask for financial assistance or charity care by name. Non-profit hospitals are required to have a written financial assistance policy, and many will write off the balance entirely for a bereaved family — but almost never unless asked.",
              "Ask for the self-pay or cash rate, which is often a fraction of the billed amount.",
              "Say the words: 'This was for my son, who died.' Hospital billing offices have discretion and use it more than people expect.",
              "Get every agreement in writing before paying anything.",
            ],
          },
          {
            kind: "warn",
            text: "If a bill goes to collections, the debt still belongs to whoever owed it originally. Collectors may not tell you that you are personally liable when you are not — that is a specific, prohibited practice under federal law. Ask for written validation of the debt and stop talking to them on the phone.",
          },
        ],
      },
      {
        id: "their-debts",
        title: "Their debts",
        summary:
          "Student loans, credit cards, and what a creditor may not tell you.",
        body: [
          {
            kind: "p",
            text: "Debts belong to the estate. If the estate has nothing, most of them end. You do not inherit your child's debt by being their parent.",
          },
          {
            kind: "list",
            items: [
              "Federal student loans are discharged on death, and a parent's federal PLUS loan taken out for that child is discharged too. Send a death certificate to the servicer.",
              "Private student loans vary. Many now include death discharge; older ones may not, and a cosigner can remain liable. Read the promissory note, and ask for a discharge even if it does not obviously apply — lenders grant it more often than the paperwork implies.",
              "Credit cards in your child's name alone die with the estate. An authorised user is not liable; a joint account holder is.",
              "A car loan or lease follows the car — see below.",
              "Notify the three credit bureaus and ask for a deceased alert. It prevents accounts being opened in their name, which does happen.",
            ],
          },
          {
            kind: "warn",
            text: "Collectors will call parents and imply a moral obligation. Under the federal Fair Debt Collection Practices Act they may not misrepresent who is liable, and you can tell them in writing to stop contacting you. That letter works, and it is a paragraph long.",
          },
        ],
      },
      {
        id: "lease-car-phone",
        title: "Their lease, their car, and their phone",
        summary:
          "The three that have running costs, and the one you should keep paying on purpose.",
        body: [
          { kind: "heading", text: "The phone — keep it" },
          {
            kind: "p",
            text: "Keep the line active. It is usually a few dollars a month on your own plan, and it keeps their voicemail greeting alive in their voice, and it stops the number being reassigned to a stranger. Parents ring it for years. This is the one bill worth continuing to pay deliberately.",
          },
          {
            kind: "list",
            items: [
              "Before anything else, save the voicemail greeting and every message off the phone. Carriers delete these on their own schedule.",
              "Ask the carrier to transfer the number to your account rather than closing it. Closing it is usually irreversible.",
              "Do not factory reset the handset. Ever. Even a locked phone can often be recovered later; a wiped one cannot.",
            ],
          },
          { kind: "heading", text: "The lease" },
          {
            kind: "list",
            items: [
              "Many residential leases end or can be terminated on a tenant's death, often with a notice period and a death certificate. Some states require landlords to allow it.",
              "You are not personally liable unless you cosigned or guaranteed it — check before paying anything.",
              "Ask for extra time to clear the flat. Most landlords will give it if asked. Ask in writing.",
              "Take photographs of the whole place before you clear it, including how they left things. Parents want this later.",
            ],
          },
          { kind: "heading", text: "The car" },
          {
            kind: "list",
            items: [
              "Keep it insured until it is transferred or sold. An uninsured car sitting on a driveway is a real liability.",
              "If there is a loan, tell the lender promptly — some loans carry credit life insurance that pays the balance off, and nobody mentions it unless asked.",
              "Transferring the title usually needs the estate, and the process differs by state — the DMV will tell you what they need for a deceased owner.",
              "There is no hurry to sell it. Parents who sold a car quickly for practical reasons often regret it. Storage is cheap by comparison.",
            ],
          },
        ],
      },
    ],
  },
  {
    heading: "Money coming in, and the tax year",
    chapters: [
      {
        id: "life-insurance",
        title: "Life insurance and benefits nobody mentions",
        summary:
          "The policies that exist without anyone knowing, and how to find them.",
        body: [
          {
            kind: "p",
            text: "There is more of this than families expect, and much of it is never claimed because nobody knew it existed.",
          },
          {
            kind: "list",
            items: [
              "A policy your child held, or one you took out on them.",
              "Employer life insurance, if they worked — commonly a multiple of salary, and often with accidental death cover on top. Ring their HR department.",
              "A rider on your own policy covering dependent children, which many policies include for a small amount and most people have forgotten.",
              "Accidental death cover attached to a credit card, a bank account, a union membership, or a car insurance policy.",
              "Student accident cover through a school or university.",
              "Credit life insurance on a car loan or mortgage, which pays the loan off.",
              "For a death by crime, victim compensation — see the page on public or criminal deaths.",
              "Your state's unclaimed property database, and the NAIC life policy locator, both of which are free and worth an hour.",
            ],
          },
          { kind: "heading", text: "Claiming" },
          {
            kind: "list",
            items: [
              "Claims typically need a certified death certificate and a claim form. Most pay within weeks.",
              "Life insurance proceeds to a named beneficiary are generally not subject to federal income tax, though interest paid on top of them can be. Check with an accountant before assuming.",
              "If an insurer offers a 'retained asset account' rather than a cheque, you can ask for the lump sum instead. Take the cheque.",
              "Do not make any decision about the money for a year. Put it somewhere boring. Grief and a sudden lump sum is how people lose it.",
            ],
          },
          {
            kind: "warn",
            text: "Be careful of anyone who approaches you about investing it, including someone you know. Bereaved parents with an insurance payout are a specifically targeted group.",
          },
        ],
      },
      {
        id: "taxes",
        title: "Taxes, the estate, and if there was no will",
        summary:
          "Claiming them for the year they died, how much later than you think you can file, the final return, and probate when there is nothing to probate.",
        body: [
          { kind: "heading", text: "Claiming them" },
          {
            kind: "p",
            text: "For US federal tax, a child who was alive for any part of the year and otherwise qualified can generally still be claimed as a dependent for that entire tax year. A child who dies in March is claimable for that year. This surprises parents, who often assume they cannot, and it is worth several thousand dollars.",
          },
          {
            kind: "list",
            items: [
              "A baby who was born alive and died the same year can generally be claimed, even without an SSN — the IRS has a specific procedure for it. A stillbirth cannot, which is a cruelty many parents encounter without warning.",
              "This is the year to use an accountant rather than software. One appointment, and they will find things you will not.",
            ],
          },
          { kind: "heading", text: "You can do this later than you think" },
          {
            kind: "p",
            text: "If your child died anywhere near tax season, somebody has probably already told you the date. Almost none of it is as fixed as it sounds, and the single most useful fact is this: there is no penalty for filing late when you are owed a refund. A young person's final return usually is a refund, because withholding was calculated for a full year of work they did not finish. If a refund is owed, the deadline is effectively three years away.",
          },
          {
            kind: "list",
            items: [
              "Form 4868 gives an automatic six-month extension to file. No reason required, nobody reads it, and it is not a flag. It buys you until roughly mid-October.",
              "An extension to file is not an extension to pay. If money is owed, interest runs from the original date regardless. But the late-filing penalty is ten times the late-payment penalty, so filing something — even an estimate — is always better than filing nothing.",
              "The IRS abates penalties for reasonable cause, and death or serious illness in the immediate family is named as one. This is a phone call, or Form 843, after the fact. Say plainly what happened and when.",
              "First-Time Abate will remove penalties outright if the last three years were clean, and it does not require a reason at all. Ask for it by name.",
              "State deadlines and their own extension forms are separate. A federal extension does not always carry across.",
            ],
          },
          {
            kind: "note",
            text: "If you do nothing at all this year, the realistic consequence for most families is interest on money that was probably not owed anyway. That is a survivable outcome. Put it down.",
          },
          { kind: "heading", text: "Their final return" },
          {
            kind: "list",
            items: [
              "If your child had income, a final return is generally due for the year of death, on the ordinary deadline.",
              "It very often produces a refund rather than a bill, because withholding was calculated for a full year of work.",
              "Claiming a refund on behalf of a deceased person usually needs Form 1310, unless you are a surviving spouse filing jointly or a court-appointed representative attaching the court document.",
              "Write 'DECEASED', their name and the date of death across the top of the return. That is genuinely the instruction.",
            ],
          },
          {
            kind: "note",
            text: "Two returns you have almost certainly heard of and probably do not need. An estate income tax return is only required if the estate itself earns six hundred dollars or more after the death — most do not earn anything. A federal estate tax return applies only to estates worth many millions. Neither is likely to be your problem, and no one tells parents that.",
          },
          { kind: "heading", text: "If there was no will" },
          {
            kind: "p",
            text: "Most young people do not have one. That is normal and it is not a disaster.",
          },
          {
            kind: "list",
            items: [
              "Without a will, state intestacy law decides who inherits — commonly a spouse first, then children, then parents. For an unmarried adult child with no children, that is usually the parents.",
              "Most states have a small-estate process: a sworn affidavit instead of full probate, when the estate is under a threshold. It is much faster and cheaper, and for most young people's estates it is the right route. Ask the county probate court.",
              "Anything with a named beneficiary — life insurance, a retirement account — passes outside the will entirely, and outside probate.",
              "If the estate has no assets, you may not need to open anything at all. Creditors can be told there is no estate.",
            ],
          },
          {
            kind: "law",
            state: "Varies by state",
            text: "Intestacy rules, small-estate thresholds, and the forms involved are set state by state and the differences are significant. The county probate court clerk will tell you which process applies and hand you the form; that call is free and is usually all the help you need.",
          },
        ],
      },
      {
        id: "leave-from-work",
        title: "Time off work, and how little of it there is",
        summary:
          "Three days of bereavement leave, FMLA that does not cover grief, and none at all if you work for yourself.",
        body: [
          {
            kind: "p",
            text: "This is the part that shocks people most, and it is worth knowing plainly rather than discovering it in an HR email.",
          },
          {
            kind: "law",
            state: "United States (federal)",
            text: "There is no federal right to paid bereavement leave. Typical employer policies give three to five days for the death of a child. The federal FMLA provides up to twelve weeks of unpaid, job-protected leave — but it covers caring for a seriously ill family member, not grieving one who has died. A bereaved parent does not qualify under FMLA for the grief itself.",
          },
          {
            kind: "p",
            text: "In practice there are routes around it, and they are worth asking about explicitly:",
          },
          {
            kind: "list",
            items: [
              "FMLA can cover your own serious health condition. Depression or PTSD following your child's death, documented by a doctor, is a serious health condition — this is how many bereaved parents get real time off, and most are never told.",
              "Short-term disability, through work or privately, may cover a mental health leave with a doctor's certification.",
              "Some states and a growing number of cities have their own bereavement leave laws, some specifically for the death of a child, and a few states' paid family leave programmes are broader than FMLA. Check your state — the difference can be weeks.",
              "Accrued sick leave, annual leave, and unpaid leave by agreement. Many managers will grant far more than the policy if asked directly.",
              "Ask for a phased return — half days, or three days a week for a month. This is granted more often than it is offered.",
            ],
          },
          { kind: "heading", text: "If you work for yourself" },
          {
            kind: "p",
            text: "There is nothing. No policy, no leave, no cover, and income that stops the day you do. It is one of the least acknowledged parts of this.",
          },
          {
            kind: "list",
            items: [
              "Tell clients something short and final: 'I've had a death in my family and I'm not working until [date]. I'll be in touch.' Most people are decent about it, and the ones who are not have told you something useful.",
              "If somebody can cover the work, let them, even at a loss. Losing a client is cheaper than what pushing through this costs.",
              "Set an auto-reply and stop opening the inbox. It will still be there.",
              "This is the situation crowdfunding is actually for — not the funeral, but the three months of no income afterwards. Let someone else set it up.",
            ],
          },
        ],
      },
    ],
  },
  {
    heading: "Their accounts",
    chapters: [
      {
        id: "social-media",
        title: "Their social media",
        summary:
          "Memorialising, deleting, and getting the photographs out first.",
        body: [
          {
            kind: "warn",
            text: "Before anything else: get the photographs and messages out. Memorialising or deleting an account can permanently remove your access to what is inside it. Download the archive first, then decide. There is no undo on this one.",
          },
          {
            kind: "list",
            items: [
              "Facebook and Instagram can memorialise an account, which freezes it, adds 'Remembering', and stops birthday notifications going out to everyone who knew them. A legacy contact — if your child set one — can pin a post and manage tributes, but cannot read their messages.",
              "Accounts can also be deleted with proof of death and proof of relationship. This is permanent.",
              "Google's Inactive Account Manager, if your child set it up, may release their account contents to a nominated person. Without it, Google has a request process, and it is slow and often unsuccessful.",
              "Apple accounts have a Legacy Contact feature, and without one an Apple ID and its photo library is very difficult to get into — a court order is sometimes required.",
              "Other platforms vary widely. Search '[platform] deceased user' for the actual form.",
            ],
          },
          {
            kind: "p",
            text: "There is no right answer about whether to memorialise, delete, or leave it. Some parents post on their child's page for years. Some cannot bear the page existing. Some leave it exactly as it was and never open it. You can also just do nothing for a year, which is a legitimate choice and the easiest one to reverse.",
          },
          {
            kind: "note",
            text: "Screenshot the comments people left after they died. Platforms change, accounts vanish, and those messages are often the only record of what their friends thought of them.",
          },
        ],
      },
      {
        id: "subscriptions",
        title: "Subscriptions and the small recurring things",
        summary:
          "The charges that keep going out, and the reminders that keep arriving.",
        body: [
          {
            kind: "p",
            text: "Small charges keep coming out of an account for years, and worse, the services keep addressing them. A birthday email. A photo memory. A fitness app congratulating them. Each one lands like a slap.",
          },
          {
            kind: "list",
            items: [
              "Go through the last three months of their bank statement rather than trying to remember. Everything recurring is on it.",
              "Cancel the annual ones first — they are the expensive surprises.",
              "Keep anything that holds their data until you have downloaded it: cloud storage, photo services, game accounts with years in them, music playlists they made.",
              "Turn off marketing and notifications on any account you keep open, especially photo apps that surface memories.",
              "Their email account is the map of all of it, if you can get into it. Search for 'receipt', 'subscription' and 'renewal'.",
              "Register with the Deceased Do Not Contact list to reduce direct mail. It does not catch everything, but it helps.",
            ],
          },
          {
            kind: "warn",
            text: "Post keeps arriving for years — insurance offers, university mailings, birthday cards from companies. Ask someone else to open the post for a while. It is a small job that spares you a specific and repeated wound.",
          },
        ],
      },
    ],
  },
];
