import type { ChapterGroup } from "./types";

/**
 * When the death was public, or criminal, or both.
 *
 * This is the page for the parents whose worst day was also a news item, or a
 * case number. It is separate from the main guides because most of it does not
 * apply to most bereaved parents — and because the parents it does apply to
 * are usually searching for it specifically, at two in the morning, after
 * reading a comment section they should not have read.
 */

export const publicOrCriminalIntro =
  "If your child's death was reported, filmed, commented on, or is now a criminal case, you are grieving in a way most people never have to — with an audience, and on somebody else's timetable. This is what to expect, and what you are entitled to.";

export const publicOrCriminalGroups: ChapterGroup[] = [
  {
    heading: "The press, and the internet",
    chapters: [
      {
        id: "reporters",
        title: "Reporters",
        summary:
          "What they can and cannot do, what to say, and how to get one photograph used instead of another.",
        body: [
          {
            kind: "p",
            text: "They may ring, knock, message you on Facebook, or approach relatives and your child's friends. Some will be decent about it. Some will not.",
          },
          { kind: "heading", text: "What you should know first" },
          {
            kind: "list",
            items: [
              "You are under no obligation to speak to any journalist, ever. There is no penalty and no consequence.",
              "'No comment' invites a follow-up. 'We're not talking to the press. Please don't contact us again.' works better, and you can say it and close the door.",
              "Nothing is off the record unless you agreed to that before you said it. Assume anything you say can be printed.",
              "They may publish without you. They can use publicly posted photographs, public records, and court documents. Refusing to speak does not stop a story — it only stops your voice being in it.",
            ],
          },
          { kind: "heading", text: "If you do want to speak" },
          {
            kind: "list",
            items: [
              "Appoint one person who is not you. A relative, a family friend, a lawyer. Every request goes to them.",
              "Give them the photograph you want used. If you do not, they will take one from social media, and it will be whichever one they found first. This is the single most effective thing you can do, and it takes five minutes.",
              "Write a short statement — three or four sentences about who your child was — and give the same one to everybody.",
              "Ask for what you want: their name spelled correctly, a specific detail included, a specific detail left out. Many outlets will accommodate it if asked before publication.",
              "If a victim advocate is assigned to your case, they will handle press for you. Use them.",
            ],
          },
          {
            kind: "warn",
            text: "Lock your social media down today, and ask close family to do the same. Journalists, and worse, take photographs of your other children from open profiles.",
          },
        ],
      },
      {
        id: "comments",
        title: "The comments",
        summary:
          "Strangers writing about your child underneath the news article, and why you will read them anyway.",
        body: [
          {
            kind: "p",
            text: "Underneath every news story is a comment section, and in it people will say things about your dead child that you will not be able to unread. That he had it coming. That where were the parents. That it is what happens to those people. Some of them will be from your own town.",
          },
          {
            kind: "p",
            text: "You will be told not to read them. You will read them. Almost every parent does, at least once, usually at three in the morning, and often repeatedly — searching for the cruel one the way a tongue finds a broken tooth.",
          },
          { kind: "heading", text: "What actually helps" },
          {
            kind: "list",
            items: [
              "Give the job to one person. A sibling or a friend reads everything, tells you if there is anything you genuinely need to know, and never shows you the rest. This works far better than promising yourself you will not look.",
              "Have them handle reporting and blocking. Most platforms will remove content targeting a deceased person's family, and outlets will close comments on a story if a family asks.",
              "Block the whole thing at the source: news site blockers, muted keywords, muting your child's name on social platforms. Removing the ability to look beats relying on willpower at 3am.",
              "Do not reply. Not once. The parents who engaged almost all describe it as the worst decision they made that year.",
              "Ask friends to stop sending you links, including supportive ones. They do not realise what arrives with them.",
            ],
          },
          {
            kind: "p",
            text: "The people writing those comments have a paragraph of information and a lifetime of needing to believe this could not happen to them. Deciding your child deserved it is how they stay safe from the fact that a child can simply die. It is about them. It is genuinely, entirely about them.",
          },
        ],
      },
      {
        id: "stigma",
        title: "Overdose, suicide, and the questions people ask",
        summary:
          "Grieving a death other people think they are allowed to have opinions about.",
        body: [
          {
            kind: "p",
            text: "There is a particular loneliness in losing a child in a way people think says something. Casseroles arrive for some deaths and not others. People go quiet. Somebody asks a question that would be unthinkable about a car accident.",
          },
          {
            kind: "p",
            text: "It is called disenfranchised grief — grief that a community does not fully grant. It is not in your head, and it is one of the strongest predictors of a bereaved parent being left isolated.",
          },
          { kind: "heading", text: "The questions, and answers you can borrow" },
          {
            kind: "list",
            items: [
              "'Was it drugs?' — 'He died of an overdose, yes.' Or: 'I'm not going into the details.' Both are complete.",
              "'Did you know he was using?' — 'That's not something I'm going to talk about.'",
              "'Did she leave a note?' — 'I'm not discussing that.' You never owe anyone this. Ever.",
              "'Were there signs?' — 'I've been through it with the people who need to know.'",
              "'What could have been done?' — 'Nothing that we hadn't already tried.'",
            ],
          },
          {
            kind: "p",
            text: "None of these need to be delivered kindly, and you do not need to soften the moment afterwards.",
          },
          { kind: "heading", text: "A few things worth holding on to" },
          {
            kind: "list",
            items: [
              "Addiction is a disease and overdose is a cause of death. Your child did not choose to die, whatever anyone implies.",
              "Suicide is what happens when unbearable pain outlasts the ability to bear it. It is not a choice made about you, and it is not a message about your parenting.",
              "You are allowed to be angry with them, and to love them completely, in the same hour.",
              "There are groups for exactly this — GRASP for overdose loss, survivor-of-suicide-loss groups almost everywhere. Being in a room where nobody's face changes when you say how they died is worth more than a year of explaining yourself.",
            ],
          },
          {
            kind: "note",
            text: "The people who go quiet are mostly not judging you. They are terrified of saying the wrong thing about a death they think is delicate. Some of them come back if you make it possible to.",
          },
        ],
      },
    ],
  },
  {
    heading: "The case",
    chapters: [
      {
        id: "advocates",
        title: "Victim advocates and who is actually on your side",
        summary:
          "A free service most families are never told exists, and what each of these people is for.",
        body: [
          {
            kind: "p",
            text: "If your child's death is a criminal case, several people will be involved with you, and their roles are very different. Families work this out slowly and painfully; it is worth having up front.",
          },
          {
            kind: "list",
            items: [
              "The victim advocate — usually attached to the prosecutor's office or the police department, free, and the person whose job is you. They explain the process, tell you when hearings are, sit with you in court, help with compensation paperwork, and deal with the press. Ask for one by name if nobody has offered.",
              "The prosecutor — represents the state, not you. They will usually keep you informed and take your view seriously, but their client is not your family, and they can make decisions you hate.",
              "The detective — investigates. Get a name and a direct number, and expect long silences that are not about you.",
              "The medical examiner's office — the cause of death, and the report.",
              "A civil attorney — yours, and only yours. The one person in the list who works for you. See the chapter on wrongful death.",
            ],
          },
          { kind: "heading", text: "Your rights in the case" },
          {
            kind: "law",
            state: "United States — federal and every state",
            text: "Every US state has victims' rights laws, and there is a federal Crime Victims' Rights Act for federal cases. They commonly include the right to be notified of hearings, to be present at them, to be heard at sentencing, to be told about a release or an escape, and to restitution. The specific rights and how you invoke them vary by state, and in many places you must formally register with the prosecutor's office to receive notifications. Ask the victim advocate to register you, and confirm it happened.",
          },
        ],
      },
      {
        id: "compensation",
        title: "Victim compensation",
        summary:
          "A state fund that pays funeral costs and counselling, with a deadline nobody tells you about.",
        body: [
          {
            kind: "p",
            text: "Every US state runs a crime victim compensation programme. For families of homicide victims it will typically pay several thousand dollars towards funeral and burial costs, and — the part families most often miss — ongoing grief counselling for the parents and the surviving siblings.",
          },
          {
            kind: "list",
            items: [
              "It is not means-tested in most states, and it is not a loan.",
              "It is the payer of last resort: it covers what insurance and other sources did not.",
              "Applications usually require the crime to have been reported promptly and the family to cooperate with the investigation.",
              "Some states reduce or deny awards where the victim is found to have contributed to the events. If that happens, ask about appealing it — families do win these.",
            ],
          },
          {
            kind: "law",
            state: "Varies by state",
            text: "Deadlines are real and are commonly one to two years from the death, sometimes less, with extensions available for good cause. Award caps, what is covered, and the appeal process all differ by state. Your victim advocate files these routinely and knows your state's rules — this is the single most useful thing to ask them for.",
          },
          {
            kind: "note",
            text: "Apply even if you think you will not qualify, and apply before the funeral bills are settled. Keep every receipt, including travel to court.",
          },
        ],
      },
      {
        id: "wrongful-death",
        title: "Wrongful death, and whether to sue",
        summary:
          "A separate civil case with its own clock, and what it costs you to run one.",
        body: [
          {
            kind: "p",
            text: "The criminal case is the state punishing someone. A wrongful death claim is your family's own civil case for the loss, and the two are independent — you can bring one where there was no crime at all, where nobody was charged, or where someone was charged and acquitted. The standard of proof is lower.",
          },
          {
            kind: "list",
            items: [
              "It is not only about killings. Car crashes, defective products, unsafe premises, medical negligence, workplace deaths, and institutional failures are the bulk of these cases.",
              "Most wrongful death lawyers work on contingency — no fee unless there is a recovery, then a percentage. Initial consultations are almost always free.",
              "Who may bring the claim and who receives anything is set by statute and is often not simply 'the parents' — it can run through the estate, and it can be complicated by divorce or by an adult child's spouse.",
            ],
          },
          {
            kind: "law",
            state: "Varies by state",
            text: "Every state sets a statute of limitations for wrongful death — commonly around two years from the date of death, but shorter in some states and much shorter where a government body is the defendant, where a formal notice of claim can be required within months. If there is any possibility of a claim, speak to a lawyer early, even if you are nowhere near ready to decide.",
          },
          { kind: "heading", text: "What it costs you" },
          {
            kind: "p",
            text: "Not money, usually. Time and exposure. A civil case can run for years, will involve being deposed about your child and your family, may involve the defence arguing about what your child's life was worth in dollars, and will keep the whole thing open long after you might otherwise have had some quiet. Some parents need it — for the answers, for the accountability, for the change it forces. Some find it took another three years off them. Both outcomes are real, and a good lawyer will tell you honestly which one you are signing up for.",
          },
        ],
      },
      {
        id: "the-trial",
        title: "The trial, years later",
        summary:
          "Waiting, plea deals, being in the room, the victim impact statement, and afterwards.",
        body: [
          {
            kind: "p",
            text: "It will take longer than anyone tells you. Two, three, five years is ordinary. Hearings are set and adjourned repeatedly, and each date is a fresh injury — you brace for it, take the day off, and it moves.",
          },
          { kind: "heading", text: "Plea deals" },
          {
            kind: "p",
            text: "Most cases end in a plea rather than a trial. You may be consulted; you do not have a veto. Families often experience this as the system deciding their child was worth a negotiation. It is worth saying in advance that a plea also means a certain outcome, no acquittal, and no trial to sit through — which some families are grateful for afterwards, even when it felt like a betrayal at the time.",
          },
          { kind: "heading", text: "Being in the room" },
          {
            kind: "list",
            items: [
              "You will likely have the right to attend. You do not have to. You can attend some days and not others.",
              "You will see photographs and hear evidence, sometimes with no warning. Ask the prosecutor in advance which days those will be, and step out. Nobody will hold it against you.",
              "The defendant's family will be there too, often a few feet away, and they are usually also destroyed. That is a strange and hard thing.",
              "Take someone. Never go alone.",
              "The defence's job is to undermine the case, and sometimes that means undermining your child. It is a role, not a truth.",
            ],
          },
          { kind: "heading", text: "The victim impact statement" },
          {
            kind: "list",
            items: [
              "In most jurisdictions you have the right to give one at sentencing — written, read aloud, or read for you by someone else.",
              "Write it about who your child was, not about the defendant. Those are the ones that land, and the ones parents are glad of years later.",
              "There are usually limits on what you may say — often no comment on the sentence itself, and no new allegations. Your advocate will check it beforehand.",
              "It is one of very few moments where your child is spoken about, on the record, as a person. Many parents say it was the only part of the process that was theirs.",
            ],
          },
          { kind: "heading", text: "Afterwards" },
          {
            kind: "p",
            text: "Parents describe the day after sentencing as one of the worst. For years the case has been the thing carrying you — a purpose, a fight, a date to get to. Then it ends, and there is a verdict, and your child is still dead, and there is nothing to do next.",
          },
          {
            kind: "p",
            text: "Whatever the sentence is, it will not be equal to what happened. Ten years, thirty years, life — none of them are your child. Families who expected the verdict to close something almost always describe the grief simply becoming visible again underneath it, having been there the whole time.",
          },
          {
            kind: "note",
            text: "Plan something for the week after sentencing. Somewhere to be, someone to be with, and a therapist you already know. That week catches people completely off guard.",
          },
        ],
      },
    ],
  },
];
