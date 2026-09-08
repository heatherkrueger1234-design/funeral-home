import type { ChapterGroup } from "./types";

/**
 * The page a bereaved parent sends to everybody else.
 *
 * Written to be read by someone who is not grieving the child — a friend, a
 * colleague, a mother-in-law — and who is frightened of getting it wrong. It
 * is deliberately addressed to them rather than about them, because a parent
 * forwarding this link is already doing something exhausting and should not
 * also have to soften it.
 *
 * Kept blunt on purpose. Every parent-facing page on this site is gentle; this
 * one has a different job.
 */

export const familyFriendsIntro =
  "Someone you care about has lost their child, and you are afraid of saying the wrong thing. This page is what bereaved parents say helps and what does not. It was almost certainly sent to you by them, which means they want you close — they just do not have it in them to explain this part.";

export const familyFriendsGroups: ChapterGroup[] = [
  {
    heading: "Start with this",
    chapters: [
      {
        id: "the-one-thing",
        title: "If you read nothing else",
        summary: "Six things that cover most of it.",
        body: [
          {
            kind: "list",
            items: [
              "Say the child's name. Out loud, often, forever. This is the single thing bereaved parents ask for most, and the thing they get least.",
              "Show up. Badly, awkwardly, saying the wrong thing — it is worth infinitely more than staying away because you did not know what to say.",
              "Do a specific thing rather than offering to do anything. 'I'm bringing dinner Thursday, I'll leave it on the step' beats 'let me know if you need anything', which is an offer that quietly puts the work on them.",
              "Do not try to make it better. You cannot. Sitting with someone in it is the whole job.",
              "Keep going after the first month. Everyone is there for two weeks. Almost nobody is there in month four, which is when it gets worse.",
              "Never begin a sentence with 'at least'.",
            ],
          },
          {
            kind: "note",
            text: "You will get something wrong. That is fine and it is recoverable. The only unrecoverable mistake is disappearing.",
          },
        ],
      },
    ],
  },
  {
    heading: "What to say",
    chapters: [
      {
        id: "what-to-say",
        title: "What to say",
        summary: "Sentences that actually work, including when you have no idea what to say.",
        body: [
          {
            kind: "p",
            text: "There is no sentence that helps. Stop looking for it — its absence is not your failure. What works is short, honest, and not trying to fix anything.",
          },
          {
            kind: "list",
            items: [
              "'I'm so sorry. I don't have any words.' Honest, and better than a rehearsed line.",
              "'I've been thinking about him.' — better still, use their name. Using the name is the point.",
              "'I remember when he…' — a specific memory of the child. This is the most treasured thing you can offer. Parents are terrified their child will be forgotten, and you have just proved they were not.",
              "'Do you want to talk about him, or do you want a distraction? Either is fine.'",
              "'You don't have to reply to this.' Especially in a text. It removes the obligation.",
              "'I'm still here.' In month six. In year two.",
              "'That's awful. I'm so angry for you.' Anger alongside them is often more welcome than sympathy.",
              "Nothing at all. Sitting with them. Being in the room. This is genuinely enough.",
            ],
          },
          {
            kind: "p",
            text: "If you are texting and agonising over it: send the imperfect one. An awkward message received is worth more than a perfect one you never sent, and 'I've started this message ten times and I don't know how to say it' is itself a good message.",
          },
        ],
      },
      {
        id: "what-not-to-say",
        title: "What not to say",
        summary:
          "The well-meant sentences that do real damage, and why each one lands the way it does.",
        body: [
          {
            kind: "p",
            text: "Almost everything on this list is said out of kindness. That is exactly why it is worth reading — none of these sound harmful until you see what the parent hears.",
          },
          {
            kind: "list",
            items: [
              "'At least you have other children.' Children are not interchangeable. It says the loss is partially covered.",
              "'At least you can have another.' The same, worse.",
              "'At least they're not suffering.' They would rather have them here.",
              "'Everything happens for a reason.' Then name the reason a child died. Nobody can.",
              "'God needed another angel.' This tells a mother God took her child deliberately.",
              "'He's in a better place.' The better place was here.",
              "'I know how you feel — I lost my mother / my dog.' You do not. Losing a parent is a real grief and it is not this.",
              "'You need to be strong for the other kids.' They are being strong for everyone, constantly, and it is destroying them.",
              "'It's been a year, are you doing better?' Year two is usually worse.",
              "'You should think about getting rid of his things.' Not your call, not on any timetable.",
              "'Time heals.' It does not. It changes the shape.",
              "'Let me know if you need anything.' Not harmful, just useless — see the next chapter.",
              "'How did it happen?' Curiosity dressed as concern. If they want you to know, they will tell you.",
            ],
          },
          {
            kind: "p",
            text: "If you have already said one of these — most people have — you do not need to make a production of apologising. 'I said something clumsy and I've thought about it since. I'm sorry.' Then stay.",
          },
          {
            kind: "warn",
            text: "Never ask about the cause of death, and never ask about a note. Not once, however gently. If the death was an overdose or a suicide, they are being asked constantly by people who think they are entitled to know, and every single one of those people thinks they are the exception.",
          },
        ],
      },
    ],
  },
  {
    heading: "What to do",
    chapters: [
      {
        id: "what-helps",
        title: "What actually helps",
        summary:
          "Concrete things, the first month and the eleven after it.",
        body: [
          { kind: "heading", text: "Do, don't offer" },
          {
            kind: "p",
            text: "'Let me know if you need anything' requires a grieving parent to identify a need, decide you meant it, and then ask. Almost none of them ever will. Say what you are doing and give them only the option to decline.",
          },
          {
            kind: "list",
            items: [
              "'I'm dropping food at six. I won't come in.' Paper plates, disposable containers, nothing to return.",
              "'I'm taking the kids Saturday from ten till four.'",
              "'I'm coming Sunday to mow the lawn / do the laundry / do the dishes.'",
              "Bring the boring things: loo roll, dog food, milk, stamps, painkillers, washing powder.",
              "Sit in the room while they do nothing. No conversation required.",
              "Drive them. To the funeral home, the lawyer, the doctor. Do not let them drive in the first weeks.",
              "Take a job permanently: be the person who answers 'how are they doing' so they do not have to.",
              "Give money if you can, quietly, with no note about what it is for. Funerals are expensive and income often stops.",
            ],
          },
          { kind: "heading", text: "After everyone else has gone" },
          {
            kind: "p",
            text: "This is where you become the person who mattered. The support collapses at about three weeks, exactly when the shock wears off.",
          },
          {
            kind: "list",
            items: [
              "Put their child's birthday and the date they died in your calendar, permanently, with a reminder a few days before. Message on both. Every year. Nobody does this and it means everything.",
              "Text on ordinary days with no question in it: 'Thinking of you. No need to reply.'",
              "Keep inviting them. They will say no for a year. Being invited and declining is entirely different from not being invited.",
              "Say the child's name in normal conversation, indefinitely. Not as a special sad moment — just as a person who existed.",
              "Remember the second Christmas, and the second anniversary. The first one gets flowers; the second gets silence.",
              "Ask 'how are you today' rather than 'how are you'. It is answerable.",
            ],
          },
        ],
      },
      {
        id: "what-to-expect-from-them",
        title: "What to expect from them",
        summary:
          "Why they might be angry with you, cancel everything, or seem fine — and what to do about it.",
        body: [
          {
            kind: "list",
            items: [
              "They may be angry, and some of it may land on you for no reason. It is not about you. Do not take the bait and do not withdraw.",
              "They will cancel. Often, and at the last minute. Keep inviting anyway.",
              "They may seem completely fine, and then fall apart three months later. The early competence is shock, not recovery.",
              "They will repeat themselves — the same story, the same details, many times. Let them. That is how it gets processed.",
              "They may not be able to be around your children, or your pregnancy, for a long time. This is not jealousy or resentment. Do not stop telling them your news, but tell them privately and give them room to not come.",
              "They may go quiet for months and reappear. Do not read it as a verdict on the friendship.",
              "They may want to talk about the death itself, in detail. If you can hold that without flinching, you are giving them something almost nobody else will.",
            ],
          },
          {
            kind: "p",
            text: "And watch for the things that need more than a friend: talk of not wanting to be here, drinking that is climbing, not eating for days, not getting out of bed for weeks. You do not have to fix any of it. Say what you have noticed, plainly and without alarm, and stay in the room.",
          },
          {
            kind: "note",
            text: "If they say they want to die — take it seriously, do not panic, do not leave them alone, and ask them directly whether they have thought about how. In the US you can call or text 988 together, and you can call it yourself for advice about someone you are worried about.",
          },
        ],
      },
      {
        id: "if-you-live-with-it",
        title: "If it is your family too",
        summary:
          "For grandparents, siblings, and partners — grieving the child and the parent at once.",
        body: [
          {
            kind: "p",
            text: "If the child was your grandchild, your niece, your brother — you have lost them too, and you are also watching your own child or sibling be destroyed. That is two griefs at once, and yours is frequently treated as though it does not count.",
          },
          {
            kind: "list",
            items: [
              "It does count. You are allowed to be devastated and you should not have to hide it entirely.",
              "But do not make them hold yours. Find somewhere else for it — a friend, a therapist, a grandparents' bereavement group. These exist because this is a known and specific position.",
              "Grandparents in particular describe watching their child suffer as worse than their own grief. Say that to somebody. Do not say it to them.",
              "Surviving siblings are usually the most overlooked people in the house. Ask them how they are, separately, and keep asking.",
              "If you are the partner, you are grieving in the same house on a different schedule. Assume you are both doing it wrong from the other's point of view and neither of you is. Get a third person in the room early.",
            ],
          },
          {
            kind: "note",
            text: "One practical thing you can do that nobody else can: write down everything you remember about that child, now, while it is fresh. Small things. What they said at four years old. Their parents will want it in ten years more than they can imagine today.",
          },
        ],
      },
    ],
  },
];
