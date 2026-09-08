import type { ChapterGroup } from "./types";

/**
 * What to expect — the grief itself, rather than the paperwork.
 *
 * The organising idea is that almost everything a bereaved parent panics about
 * being wrong with them is not wrong with them. The chapters are written to
 * name the specific thing before explaining it, because a parent scanning this
 * page at 4am is looking for the sentence that describes what is happening to
 * them right now, and generalities about the stages of grief are not it.
 *
 * Nothing here is anybody's personal account. The chapters describe what
 * bereaved parents report in general, so that a reader recognises themselves
 * in them without a stranger's grief being on the page.
 */

export const healingIntro =
  "Almost nothing you are about to read here is a symptom. It is what losing a child does, and it is what it does to nearly everyone. This is the page for the things you have been afraid to say out loud in case somebody decided you were not coping.";

export const healingGroups: ChapterGroup[] = [
  {
    heading: "What is happening to you",
    chapters: [
      {
        id: "what-to-expect",
        relationships: ["child"],
        title: "What to expect",
        summary:
          "There is no order to this and no timeline, and the five stages were never a rulebook.",
        body: [
          {
            kind: "p",
            text: "Grief after losing a child does not follow a path. You may feel shock, numbness, rage, guilt, bottomless sadness and, occasionally, an unexpected peace — sometimes all inside one hour. All of it is normal. All of it is yours.",
          },
          {
            kind: "p",
            text: "The five stages were a description of dying people coming to terms with their own deaths. They were never a schedule for the bereaved, and they were never a queue you move along. You can go years functioning and then come apart at a birthday. You can laugh at something and feel like a traitor. You can be fine at nine in the morning and unable to stand up at two.",
          },
          {
            kind: "p",
            text: "The one thing people get right is that it changes shape. Not smaller — most parents say it never gets smaller. But the gaps between the worst of it slowly widen, and you get slightly better at seeing it coming.",
          },
          {
            kind: "note",
            text: "You are carrying the heaviest thing a person can carry. Whatever you are managing today is enough.",
          },
        ],
      },
      {
        id: "doesnt-feel-real",
        title: "It doesn't feel real — and then the day it does",
        summary:
          "The strange calm of the first weeks, and why the collapse comes when everyone thinks you are through the worst.",
        body: [
          {
            kind: "p",
            text: "In the first days you may function terrifyingly well. You make decisions. You ring people. You choose a casket. You stand at the service and thank everyone for coming, and people say, quietly, how strong you are being.",
          },
          {
            kind: "p",
            text: "You are not being strong. You are in shock, and shock is an anaesthetic. Your mind is releasing the truth to you in pieces, at the rate you can survive, because the whole of it at once would be unsurvivable.",
          },
          {
            kind: "p",
            text: "Then it wears off. Usually somewhere between three weeks and three months — after the casseroles stop, after everyone has gone home, after the phone has gone quiet and the world has helpfully decided you are through the worst of it. That is when it lands. Parents describe an ordinary Tuesday, standing in a kitchen, and the knowledge arriving all at once, physically, like being hit.",
          },
          {
            kind: "p",
            text: "This is the single most common thing bereaved parents are unprepared for: that month two and month four are worse than week one, and that by then everybody else has stopped checking.",
          },
          {
            kind: "note",
            text: "If you are in the numb part now: it is not that you are not sad enough. It is not coming yet. Let people help you while they are still offering, even if you cannot feel that you need it.",
          },
        ],
      },
      {
        id: "dissociation",
        title: "Feeling detached, foggy, or outside your own life",
        summary:
          "Watching yourself from a distance, losing days, feeling nothing when you think you should feel everything.",
        body: [
          {
            kind: "p",
            text: "Many bereaved parents describe watching their own life from outside it. Moving through fog. Going through the motions with nobody home behind their eyes. This is dissociation, and it is one of the most common responses to overwhelming loss.",
          },
          {
            kind: "list",
            items: [
              "Nothing feels real, including things that are obviously real.",
              "You watch yourself from a few feet away.",
              "You cannot remember conversations, or whole days.",
              "You feel numb precisely when you think you ought to feel the most.",
              "You arrive somewhere with no memory of the drive.",
            ],
          },
          {
            kind: "p",
            text: "It is not weakness and it is not indifference. It is a nervous system rationing what it lets through. The fog lifts on its own timeline, usually gradually, usually later than you want.",
          },
          {
            kind: "warn",
            text: "Do not drive long distances in this state if you can avoid it, and do not sign anything financially significant. Both are decisions the fog is very bad at.",
          },
        ],
      },
      {
        id: "replaying",
        title: "Replaying it, and needing to know exactly what happened",
        summary:
          "The loop of their last day, the search for the moment you missed, and why you want details other people find unbearable.",
        body: [
          {
            kind: "p",
            text: "You will replay it. Their last day, the last conversation, the last time you saw their face, the moment you found out. You will look for the sign you missed and rewrite it a hundred ways where you got there in time.",
          },
          {
            kind: "p",
            text: "This is your mind trying to make sense of something with no sense in it. It is doing what it does with any unfinished problem: running it again. That it cannot be solved is exactly why it will not stop.",
          },
          {
            kind: "p",
            text: "You may also need details that horrify other people. To see the body. To read the report. To stand in the place it happened. To ask the paramedic whether they said anything. This is normal and it is not morbid. For many parents, the real thing — however terrible — is more bearable than the version their imagination builds in the gaps.",
          },
          {
            kind: "p",
            text: "Where it becomes a problem is when the replaying is intrusive rather than chosen — when the images arrive on their own, in flashes, and you cannot put them down. That is a trauma response rather than grief, and it is specifically treatable. See the chapter on your body and your mind.",
          },
        ],
      },
      {
        id: "sudden-or-expected",
        title: "Sudden, or expected",
        summary:
          "The two roads into this, why neither is the easier one, and the particular guilt each one carries.",
        body: [
          {
            kind: "p",
            text: "People will tell a parent whose child died suddenly that at least there was no suffering. They will tell a parent whose child died slowly that at least they had time to prepare. Both sentences are said by people who have not done either.",
          },
          { kind: "heading", text: "If it was sudden" },
          {
            kind: "list",
            items: [
              "There was no goodbye, and the last thing you said to them is now permanent — and it may have been about the dishes.",
              "The last ordinary moment is unbearable in retrospect because you did not know to look at it.",
              "Trauma sits on top of the grief: the phone call, the door, the room. Sudden loss carries a much higher rate of PTSD, and that part is treatable separately from the grief.",
              "Everyone else was living a normal life five minutes before too, so nobody around you has caught up either.",
            ],
          },
          { kind: "heading", text: "If it was expected" },
          {
            kind: "list",
            items: [
              "You grieved before they died, and then were told that meant you had a head start. You did not. Anticipatory grief is not deducted from the total.",
              "You may have wished, at some point near the end, for it to be over. Nearly every parent in this position does, and nearly every one of them is quietly destroyed by it afterwards. Wanting your child's suffering to end is not wanting your child to die.",
              "You may be relieved, and then horrified at your own relief. Relief is about the vigil ending. It is not about them.",
              "You had years of appointments and machines and being the one who knew the medication schedule — and then, in a day, no role at all.",
            ],
          },
          {
            kind: "note",
            text: "There is no version of this that was the good one. If someone offers you the at-least sentence, they are trying to find something to say, and they have failed at it. That is all it means.",
          },
        ],
      },
    ],
  },
  {
    heading: "Your body, and your mind",
    chapters: [
      {
        id: "the-body",
        relationships: ["child"],
        title: "Sleep, fog, forgetting, drinking, and what grief does to your body",
        summary:
          "Insomnia, losing words, the weight, the drinking that starts reasonably, and the PTSD that is treatable.",
        body: [
          {
            kind: "p",
            text: "Grief is not only an emotion. It is a physical event, and it runs your body down in ways that get mistaken for you falling apart as a person.",
          },
          { kind: "heading", text: "Sleep" },
          {
            kind: "p",
            text: "Almost every bereaved parent's sleep breaks. Falling asleep is when the thoughts arrive with nothing to drown them; waking at three or four in the morning is nearly universal; and there is the particular cruelty of the first two seconds on waking, before you remember, every single morning.",
          },
          {
            kind: "list",
            items: [
              "Something on in the room — a podcast, an audiobook, the television low — helps more than silence, because silence is where the replaying happens.",
              "Sleeping somewhere else for a while is allowed. So is sleeping in their bed.",
              "Short-term sleep medication from a doctor is a reasonable thing to ask for and not a failure. Say plainly: my child died and I have not slept in nine days.",
            ],
          },
          { kind: "heading", text: "The fog" },
          {
            kind: "p",
            text: "You will lose words mid-sentence. Forget appointments, and names, and whether you ate. Read the same paragraph four times. Put the milk in the cupboard. Grief measurably impairs concentration and working memory — this is documented, it is not you failing. It lifts, slowly, over months. Write everything down in the meantime and do not trust yourself to remember anything.",
          },
          { kind: "heading", text: "PTSD, which is a separate thing" },
          {
            kind: "p",
            text: "If you saw them — the scene, the body, the resuscitation — or if you got the call, you may have trauma on top of grief. It looks different from grief:",
          },
          {
            kind: "list",
            items: [
              "Images that arrive uninvited and will not be put down.",
              "Flashbacks: not remembering it, but being back in it.",
              "Jumping out of your skin at a phone ringing or a knock.",
              "Avoiding a road, a hospital, a room, an entire town.",
              "Being permanently braced, as though the next call is already coming.",
            ],
          },
          {
            kind: "p",
            text: "This matters because grief has no cure and PTSD substantially does. Trauma-focused therapy — EMDR, trauma-focused CBT, prolonged exposure — has good evidence behind it, and treating the trauma does not take your grief away or make you love them less. It takes the worst images off a loop so you can grieve the child instead of reliving the day. Parents who get this treatment often say it gave them back the ability to remember their child alive.",
          },
          { kind: "heading", text: "Drinking, and everything else that helps at first" },
          {
            kind: "p",
            text: "It starts entirely reasonably. A drink to get to sleep. Then two, because one stopped working. Alcohol genuinely does switch it off for a couple of hours, which is exactly the problem — the thing that works is the thing that gets worse, and it wrecks the sleep it was bought for.",
          },
          {
            kind: "list",
            items: [
              "The honest test is not how much. It is whether you can get through an evening without it, and whether you have started hiding the amount.",
              "It also suspends the grief rather than moving it. Parents who drank through the first two years often describe arriving at year three at the beginning.",
              "Nobody will confront you about it. You are a bereaved parent and everyone has decided you have earned it. That means you are the only one who is going to notice.",
            ],
          },
          { kind: "heading", text: "Eating, and the weight" },
          {
            kind: "p",
            text: "Some parents cannot eat and lose a frightening amount quickly. Some eat constantly for the few minutes of comfort. Both happen, and neither is worth fighting in the first year. Aim only at not fainting: something with protein, water, and an actual meal a day even if you have no interest in it.",
          },
          { kind: "heading", text: "Medication" },
          {
            kind: "p",
            text: "Antidepressants do not treat grief and will not make you miss them less. What they can do is lift the floor when grief has tipped into depression — when you cannot get out of bed at all, for weeks, and not because of sorrow but because of a flatness with nothing in it. That is a real distinction and a good doctor will make it with you. Taking something is not medicating away your child.",
          },
          {
            kind: "note",
            text: "Get a physical this year. Grief raises blood pressure and drops the immune system, and bereaved parents skip their own appointments for years.",
          },
        ],
      },
      {
        id: "dreams",
        title: "Dreaming about them",
        summary:
          "The dreams where they are alive, the ones where you lose them again, and not dreaming at all.",
        body: [
          {
            kind: "p",
            text: "Dreams of a dead child come in a few recognisable kinds, and parents are often frightened by all of them.",
          },
          {
            kind: "list",
            items: [
              "The ordinary ones. They are simply there, at the table, in the car, and nothing is wrong. These are the ones that undo you on waking, because for a few seconds it was true.",
              "The visitation ones. Vivid, calm, more real than a dream, and often a single clear message — that they are all right. Many parents hold these as genuinely them. Whether or not you believe that, they are one of the few unambiguously good things in the first years.",
              "The searching ones. You have lost them in a building, or they are somewhere you cannot reach, or you are trying to warn them and cannot make a sound. These are exhausting and they are extremely common. Your mind is doing the same thing it does awake.",
              "The nightmares. Replays of the scene, or worse versions. If these dominate, that is the trauma response again, and it is treatable.",
            ],
          },
          { kind: "heading", text: "If you never dream about them" },
          {
            kind: "p",
            text: "Some parents wait years, and are wounded by it — as though even their own sleep is withholding their child. Not dreaming of someone means nothing about your bond, and it is often just that grief has wrecked the deep sleep dreams come out of. It very often starts once the sleep repairs.",
          },
          {
            kind: "note",
            text: "Write them down the moment you wake, before you move. Dreams go within a minute or two and parents grieve the ones they lost.",
          },
        ],
      },
      {
        id: "not-wanting-to-be-here",
        title: "Thoughts of not wanting to be here",
        summary:
          "Wanting to be where they are, the difference between that and a plan, and what to do tonight.",
        body: [
          {
            kind: "warn",
            text: "If you are in danger right now, stop reading and call or text 988 (US, 24/7), or text HOME to 741741. Outside the US, findahelpline.com lists your country's line. You do not have to be certain. You do not have to know what to say.",
          },
          {
            kind: "p",
            text: "Most bereaved parents have some version of this thought, and almost none of them say it out loud, because they are afraid of what happens if they do. So it needs saying plainly: wanting to not exist, after your child has died, is one of the most common things in bereaved parenthood. It does not mean you are mentally ill and it does not mean you are going to act.",
          },
          {
            kind: "p",
            text: "It usually arrives in one of these shapes, and they are not the same:",
          },
          {
            kind: "list",
            items: [
              "Wanting to be wherever they are. Less about dying than about going to them. Almost universal.",
              "Not wanting to be here. Wanting to stop, to sleep and not wake, to have the weight of the next forty years taken off you. Also very common.",
              "Not caring whether you live. Driving too fast, not taking the medication, a kind of passive drift. Easy to miss in yourself.",
              "Actually thinking about how. A method. A time. Working out who would find you. This one is different in kind, not degree.",
            ],
          },
          {
            kind: "p",
            text: "That last one is the line. Not because the others do not matter, but because once there is a method and a plan, the thing has stopped being pain and started being a risk, and it needs someone else in it with you tonight.",
          },
          { kind: "heading", text: "What to do with it tonight" },
          {
            kind: "list",
            items: [
              "Tell one person. Out loud, in words. A partner, a friend, your doctor, a stranger on 988. The saying of it is itself protective, and telling someone does not automatically start anything — most of these calls are a conversation and nothing more.",
              "Put distance between you and the means. Give the pills or the gun to somebody else to hold for a while. Almost every survived crisis is survived because the method was not to hand in the fifteen minutes it mattered.",
              "Do not be alone tonight. Somebody's sofa. Somebody in the next room.",
              "Decide only about tonight. Not about the rest of your life without them, which is not a decision that can be made this evening anyway.",
            ],
          },
          {
            kind: "p",
            text: "You are not being disloyal by staying. Parents describe it as a debt — that surviving is somehow a betrayal, that they should have gone instead. But the version of your child you carry lives in you, and there is no one else who holds them the way you do.",
          },
          {
            kind: "p",
            text: "If there are other children, they have already lost a sibling. They cannot lose you as well, and that is not a guilt trip — it is the plainest fact available.",
          },
          {
            kind: "note",
            text: "988 is not only for the last minute. It is for a Tuesday evening when you cannot be alone with it. That is what the people answering are there for, and they will not be shocked by anything you tell them.",
          },
        ],
      },
      {
        id: "professional-help",
        title: "When to get help, and what actually helps",
        summary:
          "The signs worth acting on, and the difference between a grief counsellor, a trauma therapist and a support group.",
        body: [
          {
            kind: "p",
            text: "Grief is not an illness and does not need curing. But it sits next to several things that do respond to treatment, and being able to tell them apart is worth a great deal.",
          },
          { kind: "heading", text: "Worth acting on" },
          {
            kind: "list",
            items: [
              "You are having thoughts of ending your life, and especially if there is a method in them.",
              "You cannot function at all — not sorrow, but a flat inability to get up — for weeks at a stretch.",
              "You are drinking or using to get through, and the amount is climbing.",
              "You cannot care for yourself or your other children.",
              "The images will not stop arriving on their own.",
              "Years in, and it is unchanged in intensity — still entirely organised around the loss, unable to hold anything else.",
            ],
          },
          { kind: "heading", text: "What the different things are for" },
          {
            kind: "list",
            items: [
              "A grief counsellor or bereavement therapist: for the grief itself. Ask specifically whether they have worked with bereaved parents. It is a different thing from other loss and a general therapist may be out of their depth — some will say so honestly, which is a good sign.",
              "A trauma therapist (EMDR, trauma-focused CBT): for the images, the flashbacks, the scene. Different work, different training, and often the one that changes the most.",
              "A psychiatrist: for medication, when the depression sitting on top of the grief has its own weight.",
              "A bereaved-parent support group: for being in a room where nobody flinches and nobody says at least. The Compassionate Friends runs these across the US and there is no cost. It does a thing no therapist can do — it puts you with people who already know.",
              "Nothing, for now. Plenty of parents are not ready in year one and are ready in year three. That is allowed.",
            ],
          },
          {
            kind: "note",
            text: "If the first therapist is wrong, that is information about the therapist, not about therapy. Parents commonly try two or three. Leaving one that is not working is not giving up.",
          },
        ],
      },
    ],
  },
  {
    heading: "Everyone else",
    chapters: [
      {
        id: "being-the-pillar",
        title: "Being the pillar",
        summary:
          "Holding everyone else up while you are the one who has actually collapsed.",
        body: [
          {
            kind: "p",
            text: "Somebody has to ring the relatives. Somebody has to sit with the grandmother who is inconsolable, and manage the friend who cries so hard you end up comforting them, and answer the question about the flowers, and reassure the other children that everything will be all right.",
          },
          {
            kind: "p",
            text: "It is almost always the parent. The person at the exact centre of the loss becomes the one running it, because they are the only one who knows the answers and because being useful is the only thing keeping them upright.",
          },
          {
            kind: "p",
            text: "And it works, for a while. Then everybody goes home having been held together by you, and reports to each other how well you are doing, and you are left in a quiet house having never once been the one who was held.",
          },
          { kind: "heading", text: "Things that help" },
          {
            kind: "list",
            items: [
              "Hand one job to one person, permanently. A sibling or a friend becomes the phone — every 'how is she doing' goes to them, not you. This alone gives back hours.",
              "You are allowed to not take a call. You are allowed to not answer the door. Grief does not come with a duty of hospitality.",
              "Find the one place you are not the pillar. A therapist, a support group, one friend who does not need you to be all right. It cannot be your partner, who is drowning in the same water.",
              "'I can't hold this for you today' is a whole sentence. Say it to the relative who keeps ringing you to cry.",
              "Let someone see you fall apart. The people around you have half-convinced themselves you are fine, and some of them will only understand if they see it.",
            ],
          },
          {
            kind: "note",
            text: "Being strong in public is not lying. But if the only version of you anyone ever sees is the managing one, no one will ever come and help — because from outside, it will keep looking like you have it.",
          },
        ],
      },
      {
        id: "siblings",
        relationships: ["child"],
        title: "Their brothers and sisters",
        summary:
          "The younger one with the same face, the questions they ask, and the grief that gets overlooked because you are the parent.",
        body: [
          {
            kind: "p",
            text: "They lost a sibling and, for a while, they lost their parents too — because their parents are underwater. Bereaved siblings are the most consistently overlooked people in the house, and mostly they know it. They keep quiet because they can see you can't take any more.",
          },
          { kind: "heading", text: "The one who looks exactly like them" },
          {
            kind: "p",
            text: "If a younger sibling has the same face, you will get hit at the kitchen table. A turn of the head at the right angle and it is them for half a second. That is a knife, and it also means that child is being looked at, all day, by a parent who is looking for someone else.",
          },
          {
            kind: "p",
            text: "They will feel it, even young. They will start to wonder whether they are loved for themselves or as a reminder — and there is no way to hide the flinch, so it is better to name it. 'You look so much like him and sometimes that catches me. It's not about you. I love your face because it's yours.'",
          },
          {
            kind: "p",
            text: "The one who is going to pass their sibling's age is carrying something else again: turning sixteen when their brother never did, becoming the older one, living out the years their sibling did not get. That comes years later and it comes hard.",
          },
          { kind: "heading", text: "The questions" },
          {
            kind: "p",
            text: "Small children ask factually and repeatedly, and often at the worst moments. Where is he. Is he cold. Will you die. Will I die. Whose fault was it. Can we get another one.",
          },
          {
            kind: "list",
            items: [
              "Answer plainly and truthfully at their level. Use 'died', not 'lost' or 'gone to sleep' — soft words frighten children more, because a child who thinks sleep is dangerous will not sleep.",
              "Repetition is how children process. The same question forty times is normal, not distress.",
              "'I don't know' is a real answer. So is 'I can't talk about that bit today, ask me again.'",
              "Answer the specific question and stop. Children ask small questions and adults answer with everything.",
            ],
          },
          { kind: "heading", text: "How their grief looks" },
          {
            kind: "list",
            items: [
              "Nothing like yours. Children grieve in bursts — devastated, then out on a bike twenty minutes later. That is not callousness, it is a child's capacity.",
              "Regression in younger ones: bedwetting, clinginess, baby talk.",
              "Anger and school trouble in older ones, often instead of sadness.",
              "Seeming completely fine, which is the one to watch. Some siblings become impeccable, high-achieving, no trouble at all — because they have decided their job is to not add to it.",
              "Survivor guilt, and the belief that the wrong child died. Teenagers especially will think this and not say it.",
            ],
          },
          {
            kind: "list",
            items: [
              "Get them their own person to talk to, separate from yours. Peer groups for bereaved siblings exist and help enormously, because their friends have no idea.",
              "Tell the school. Ask for one named adult they can go to when they need to leave the room.",
              "Let them see you cry, and let them see you recover. That is the whole lesson: this is survivable.",
              "Say their sibling's name in ordinary conversation. Siblings often report that the dead child became unmentionable and it was the loneliest part.",
              "Find fifteen minutes that is theirs, that is not about their sibling.",
            ],
          },
          {
            kind: "note",
            text: "You will not do this well in the first year. Nobody does. Children forgive an enormous amount when they can tell they are still loved, and 'I got that wrong, I'm sorry' repairs almost all of it.",
          },
        ],
      },
      {
        id: "the-table",
        title: "The table",
        summary:
          "Setting their place or refusing to, the empty chair at Christmas, and both being right.",
        body: [
          {
            kind: "p",
            text: "It is a small thing that turns out not to be small. There is a chair. There is a number of places to lay. And somebody is about to ask, out loud, how many.",
          },
          {
            kind: "p",
            text: "Some families set the place. Their chair, their plate, sometimes a candle. It says: he is still one of us, we have not quietly reduced the count. Some families cannot bear it — an empty plate is not a presence, it is the absence made into an object, and sitting opposite it for an hour is unendurable.",
          },
          {
            kind: "p",
            text: "Both are right, and the only real problem is when two people in one house need opposite things and each reads the other's need as a verdict. Setting the place is not refusing to accept it. Not setting it is not moving on.",
          },
          {
            kind: "list",
            items: [
              "Say what you need out loud before the meal, not during it. 'I can't have the empty chair today' is much easier said at eleven in the morning.",
              "Take the leaf out of the table, or move to a different room, or go out. A table for four is less brutal than a table for five with a gap.",
              "Do something with their absence rather than only around it: their favourite food on the table, their music on, everyone says one thing about them before eating.",
              "Change it every year if you want. What you needed last Christmas is not a commitment.",
              "Let the other children have a say. Often they very much want the place set, and nobody asks them.",
            ],
          },
          {
            kind: "note",
            text: "The first of each thing is the worst — first Christmas, first birthday, first Thanksgiving. The dread beforehand is usually worse than the day. Make an exit plan in advance and let yourself use it.",
          },
        ],
      },
      {
        id: "going-quiet",
        title: "Going quiet",
        summary:
          "You stop saying their name because everyone looks tired of hearing it, and you still think of them fifty times a day.",
        body: [
          {
            kind: "p",
            text: "In the beginning everybody says their name. Then, somewhere in the first year, it starts to change. You mention them and there is a pause. A shift in the room. Somebody changes the subject kindly. You watch a friend brace when you begin a sentence with his name.",
          },
          {
            kind: "p",
            text: "So you stop. Not all at once — you just start editing. You leave him out of the story about the holiday. You say 'my son' instead of his name because his name makes it heavier. You answer 'fine' because the true answer costs everyone too much. And within a year or two you are living a life where the most important person in it is never mentioned, while you think about him fifty times a day.",
          },
          {
            kind: "p",
            text: "The reason it happens is worth knowing, because it is almost never what it looks like. People are not tired of him. They are afraid of hurting you. They have decided that if they say his name they might make you cry, and that this would be a harm rather than a relief. So they go quiet to protect you, and you go quiet to protect them, and between you the child disappears from the conversation while everyone privately thinks about him constantly.",
          },
          { kind: "heading", text: "Breaking it" },
          {
            kind: "list",
            items: [
              "Tell people directly: 'Please say his name. It doesn't upset me — the silence does.' Almost everyone is relieved to be told, because they have been guessing.",
              "Use their name yourself, in ordinary sentences, without a preamble. 'He used to do that.' Said lightly and often, it teaches the room that the name is allowed.",
              "Find the one or two people who can hear it. It does not need to be everybody.",
              "Say his name here, on this site, as often as you want. That is a large part of what this is for.",
              "If you cry, let it happen. It is not proof that mentioning him was a mistake.",
            ],
          },
          {
            kind: "p",
            text: "The fear underneath is that he is being erased — that in ten years nobody will say his name at all, and it will be as though he was never here. That fear is not irrational, and going quiet is how it happens. It is also the one part of this you can actually push back on.",
          },
        ],
      },
      {
        id: "strangers",
        title: "Strangers",
        summary:
          "The world carrying on around you, the kindness that lands and the rudeness that does not know what it just did.",
        body: [
          {
            kind: "p",
            text: "One of the strangest parts is going out into a world that has no idea. Everyone in the shop is having an ordinary day. Nobody looking at you knows that you buried your child, and there is no way to tell them and no reason to.",
          },
          {
            kind: "p",
            text: "So strangers become a lottery. A person who holds a door, or lets you go first, or simply says something ordinary and kind, can be the thing that gets you through an afternoon. And a person being briefly rude — impatient, dismissive, sharp about nothing — can take the legs out from under you on a day you have no reserve at all.",
          },
          {
            kind: "p",
            text: "Parents describe walking out of a hospital, or a funeral home, straight into an ordinary shop — people buying lottery tickets, talking about the weather, a clerk being briefly short with them about the change. And it flattens them completely, and the clerk has done nothing at all. There is no sign on you. That is the part nobody warns you about.",
          },
          {
            kind: "list",
            items: [
              "Some parents keep something in a pocket — a card, a photograph, his name written down — as a private anchor for the shop and the waiting room. It is not for showing anyone.",
              "Send someone else for a while. There is no medal for doing your own errands in month two.",
              "Online orders and delivery, unashamedly, for as long as you need.",
              "When a stranger is unkind, the fact that it took your legs is about where you are standing, not about how weak you are. It would take anyone's.",
            ],
          },
          {
            kind: "note",
            text: "Occasionally you will meet a stranger who says exactly the right thing, usually because they have been here too. Those meetings are worth more than most of the arranged kindness. You cannot make them happen; you can only be out in the world enough for one to find you.",
          },
        ],
      },
      {
        id: "ambushes",
        relationships: ["child"],
        title: "Ambushes",
        summary:
          "Kids his age in the aisle, his name called across a car park, a boy talking to his mother about nothing.",
        body: [
          {
            kind: "p",
            text: "Everyone warns you about the birthday and the anniversary. Nobody warns you that the dangerous days are the ordinary ones, and that the world is quietly full of things that will take you apart in a second with no warning at all.",
          },
          {
            kind: "list",
            items: [
              "A boy his age in the next aisle, the same build, the same walk. Your body reacts before your mind does.",
              "His name called out across a car park by a stranger calling their own child. You will turn round. You will turn round for years.",
              "A boy talking to his mother about absolutely nothing — what's for dinner, can he have the crisps — which is the thing you would give everything for and cannot have.",
              "The song. In a shop, in someone else's car, in an advert.",
              "A school bus at the time of day it used to matter. His friends, taller, at the shops. Their graduation. Their weddings, later.",
              "A form asking how many children. A hairdresser making conversation. A new colleague, on your first day back, asking a completely reasonable question.",
              "His name coming up as a suggested contact. A memory notification with his face on it, over breakfast.",
            ],
          },
          {
            kind: "p",
            text: "These do not fade in the way anniversaries do, because you cannot brace for them. What changes with time is not the ambush but the recovery: at first it takes the whole day, and eventually — years in — some of them take twenty minutes, and you can go back into the shop.",
          },
          { kind: "heading", text: "What actually helps" },
          {
            kind: "list",
            items: [
              "Leave. Abandon the trolley in the aisle. Sit in the car. Nobody is keeping score and you will never see those people again.",
              "Turn off photo memory notifications, or set them so his face is not sprung on you at breakfast. You can go and look at him on purpose instead, which is an entirely different experience from being ambushed by him.",
              "Have one person you can text three words to. Not a conversation — just being known about in that minute.",
              "Know that the first ten seconds are the worst, and that it does pass, and that standing still and breathing until it does is a complete and sufficient plan.",
            ],
          },
          {
            kind: "note",
            text: "You are not going backwards when this happens in year four. It is not a relapse. It is the price of him having existed, and it is one nearly every bereaved parent goes on paying.",
          },
        ],
      },
      {
        id: "how-many-children",
        relationships: ["child"],
        title: "“How many kids do you have?”",
        summary:
          "The most ordinary question there is, and the impossible choice inside it.",
        body: [
          {
            kind: "p",
            text: "It is asked at work, on aeroplanes, at the school gate, by hairdressers and taxi drivers and new neighbours. It is small talk. And every bereaved parent has to decide, in under a second, whether to include their dead child in the count.",
          },
          {
            kind: "p",
            text: "Say three and you have said something true and then have to live with what follows — how old, what do they do — and either lie your way through it or correct yourself into a very quiet moment. Say two and you have denied your child, and you will feel it for hours afterwards.",
          },
          {
            kind: "p",
            text: "There is no right answer. Most parents end up with several answers and choose by situation, and that is not cowardice — it is a reasonable way to survive a question that gets asked constantly.",
          },
          {
            kind: "heading",
            text: "Things parents actually say",
          },
          {
            kind: "list",
            items: [
              "'Three.' Full stop. If it goes further, it goes further. Some parents never subtract him from the number and accept the cost.",
              "'Three — my oldest died in 2023.' Direct, and it usually ends the small talk kindly.",
              "'Two here, and one I lost.' Softer, and it lets the other person choose whether to ask.",
              "'Two.' For the taxi driver you will never see again, when you have nothing left today. This is not a betrayal. It is a decision about a stranger, not about your son.",
              "Answer the question underneath instead: 'I've got a daughter at university.' True, and complete enough for small talk.",
            ],
          },
          {
            kind: "p",
            text: "The other half of it is what happens when you do say it: the person recoils, apologises repeatedly, and you end up managing their distress. Having a next sentence ready helps — 'It's all right, I'd rather say his name than leave him out' — because it gives them somewhere to go.",
          },
          {
            kind: "note",
            text: "If you answer 'two' one day and it eats at you, you have not erased him. You got through a conversation. He is still your child, and the count in your own head has not changed once.",
          },
        ],
      },
      {
        id: "relationships",
        title: "Friends, family, and being alone in a full room",
        summary:
          "The friends who vanish, the ones who surprise you, and why nobody can reach you in there.",
        body: [
          {
            kind: "p",
            text: "Some friendships will not survive this, and it is rarely the ones you would predict. People who have known you for twenty years will disappear. People you barely knew will turn up every week for a year.",
          },
          {
            kind: "p",
            text: "The ones who vanish are mostly not cold. They are frightened — of saying the wrong thing, of your pain, and often of the fact that you are proof this can happen to a family like theirs. Knowing why does not make it hurt less, and you are not obliged to be understanding about it.",
          },
          {
            kind: "p",
            text: "You can also be entirely alone in a room full of people who love you. Grief this size cannot be entered by anyone who has not been in it. That is not a failure of the people around you and it is not a failure of yours.",
          },
          {
            kind: "list",
            items: [
              "Be specific with the people who ask what they can do. 'Come Thursday and sit with me.' 'Take the children Saturday.' Most people want a job and cannot invent one.",
              "Let the ones who show up show up, even if they are not the ones you expected or wanted.",
              "Other bereaved parents are the exception to all of this — with them you do not have to explain anything. The Compassionate Friends, a local group, an online one at three in the morning.",
              "You are allowed to let a friendship go for now without ending it. Some come back in year three, awkward and apologetic, and some of those are worth taking back.",
            ],
          },
        ],
      },
      {
        id: "marriage-and-after",
        relationships: ["child"],
        title: "Your marriage, sex, and whether to have another baby",
        summary:
          "Grieving on different timelines, the myth about divorce, and pregnancy after loss.",
        body: [
          {
            kind: "p",
            text: "You will be told that most marriages end after a child dies. The figure that gets repeated is not supported by the research — the large studies of bereaved parents find far lower separation rates than the folklore, and many couples describe the relationship as ultimately closer. It is worth knowing, because parents brace for an inevitability that is not one.",
          },
          {
            kind: "p",
            text: "What is true is that it gets very hard, mostly because two people grieve at different speeds and in different languages, in the same house, at the same time.",
          },
          {
            kind: "list",
            items: [
              "One of you needs to talk about him constantly; the other cannot get through a day if they do. Both are grief, and each reads as an accusation to the other.",
              "One goes back to work quickly and is thought to be cold. One cannot get up and is thought to be sinking. Neither is a verdict on how much they loved him.",
              "You will be at your worst on different days, which is exhausting but is also the only reason the house keeps running.",
              "Blame — spoken or not — is the thing that actually breaks couples. If either of you is carrying it, get someone in the room with you. That one does not resolve on its own.",
            ],
          },
          { kind: "heading", text: "Sex" },
          {
            kind: "p",
            text: "It goes one of two ways and both are common. For one partner it is unthinkable for a long time — the body has nothing in it, and pleasure feels like a betrayal. For the other it can be the only route back to feeling human, or to being close to someone without having to speak. Neither of those is a moral position, and the collision between them is one of the loneliest parts of a grieving marriage. Say it out loud rather than letting it be a nightly refusal that means something worse each time.",
          },
          { kind: "heading", text: "Another baby" },
          {
            kind: "p",
            text: "Wanting another child is not replacing them, and people will imply that it is. Not wanting another is not a failure of hope. Both decisions get made under enormous pressure from people who have opinions and no standing.",
          },
          {
            kind: "list",
            items: [
              "There is no right interval. Some parents need it soon; some need years; some know immediately that they will not.",
              "Both partners have to actually want it. A baby conceived to fix one person's grief is a heavy thing to hand a child.",
              "A subsequent child is themselves, entirely, and will need to be seen that way for their whole life — not as the one who came after, and not as a consolation.",
            ],
          },
          { kind: "heading", text: "Pregnancy after loss" },
          {
            kind: "p",
            text: "If you do get pregnant, expect it to be frightening rather than joyful, especially if the child you lost was a baby. Parents describe nine months of held breath, counting kicks, unable to buy anything, unable to say the name out loud, and feeling guilty for not being happy.",
          },
          {
            kind: "list",
            items: [
              "Tell your midwife or obstetrician at the first appointment that you have lost a child. It changes the care you get and it should.",
              "Ask for extra scans or checks. Reassurance is a legitimate clinical need here, and most services will accommodate it.",
              "Pregnancy-after-loss support groups exist and are specifically different from general antenatal groups, where you will not fit.",
              "Grieving one child while carrying another is not disloyalty to either of them.",
            ],
          },
        ],
      },
    ],
  },
  {
    heading: "Faith, signs, and meaning",
    chapters: [
      {
        id: "signs",
        title: "Signs",
        summary:
          "Flickering lights, songs, feathers, mediums, and the argument nobody needs to have with a bereaved parent.",
        body: [
          {
            kind: "p",
            text: "Lights that flicker. A song that comes on at the exact moment. Feathers, coins, cardinals, moths. A smell of them in a room. A dream that did not feel like a dream. Their photograph falling off a shelf on their birthday. Almost every bereaved parent has something, and almost all of them have been careful about who they tell.",
          },
          {
            kind: "p",
            text: "There is nothing to argue about here. A parent who believes their child is reaching them is not confused, and does not need the alternative explanation offered to them — they have usually thought of it, and it is not the point. Believe what you believe. It is one of very few things in this that costs nothing and helps.",
          },
          {
            kind: "p",
            text: "It is also worth knowing that a household rarely agrees. Younger siblings often accept a sign completely and without effort — the lights flicker and that is simply him, said as plainly as you would say someone had come to the door. The parent is more often caught in between: half out of the chair before remembering, and then remembering.",
          },
          { kind: "heading", text: "Mediums" },
          {
            kind: "p",
            text: "Some parents go and find it profoundly helpful. Some come away worse. Two practical things, said without judgement: go with someone, and be careful of anyone who wants a lot of money, wants you to come back repeatedly, or has anything to say about your child being unsettled or needing something that costs. That last is a specific and well-documented way of exploiting bereaved parents, and it is worth knowing the shape of it.",
          },
          { kind: "heading", text: "Religion, and what comes after" },
          {
            kind: "p",
            text: "Faith goes both ways here and neither is a betrayal. Some parents' belief becomes the load-bearing thing. Some lose it entirely, and grieve that as a second loss. Some believe in reincarnation, or in nothing, or in something they could not name if asked, and quietly build a private idea of where their child is that belongs to nobody else.",
          },
          {
            kind: "note",
            text: "You do not owe anyone consistency. You can talk to them out loud in the car and not believe in an afterlife. You can believe on Tuesday and not on Wednesday. Nobody is marking it.",
          },
        ],
      },
      {
        id: "anger-at-god",
        title: "Anger at God, and the church that did or did not show up",
        summary:
          "Being furious at something you may not be sure you believe in, and what people say in the name of comfort.",
        body: [
          {
            kind: "p",
            text: "You may be more angry than you have ever been in your life, and it may be aimed at God — including if you are not sure there is one. That rage is old and it is well documented and there are entire books of scripture that consist of it. It is not a failure of faith; in most traditions it is a form of it.",
          },
          {
            kind: "p",
            text: "You may also be unable to walk into the building. Sitting in a service and being told this is part of a plan can be unendurable, and staying away is not a decision about God.",
          },
          { kind: "heading", text: "The sentences people use" },
          {
            kind: "p",
            text: "Some of what is said to bereaved parents by well-meaning religious people does real damage, and it helps to know in advance that it is bad theology as well as bad comfort:",
          },
          {
            kind: "list",
            items: [
              "'God needed another angel.' 'He needed him more than you did.' This tells a mother that God took her child on purpose. Most clergy would not defend it.",
              "'Everything happens for a reason.' If there is a reason for a child dying that a parent could be told, nobody has produced it.",
              "'God doesn't give you more than you can handle.' Said to somebody who is visibly not handling it.",
              "'He's in a better place.' The better place was here, with you.",
            ],
          },
          {
            kind: "p",
            text: "You do not have to accept any of it graciously, and you are allowed to say 'please don't' to a person who says it twice.",
          },
          { kind: "heading", text: "When the church does show up" },
          {
            kind: "p",
            text: "And sometimes it does, remarkably. Meals for two months. Someone mowing the lawn without asking. A pastor who sits down and says nothing at all, week after week. Parents who got that describe it as the thing that carried them. Parents whose congregation went silent after the funeral describe a second bereavement, and that one is rarely acknowledged out loud.",
          },
          {
            kind: "note",
            text: "If your church has gone quiet, one person there is probably desperate to say something and afraid to. It is not usually the leadership. It is worth telling one person what you need.",
          },
        ],
      },
      {
        id: "acceptance",
        title: "Acceptance without understanding",
        summary:
          "Living with a fact you will never make sense of, and why 'acceptance' is the wrong word for it.",
        body: [
          {
            kind: "p",
            text: "Acceptance is the last stage in the model, and for bereaved parents it is the one that causes the most damage — because it sounds like a destination where this is all right, and no parent will ever arrive there.",
          },
          {
            kind: "p",
            text: "What actually happens is smaller and stranger. You stop expecting them to walk in. You stop reaching for the phone. Your hands learn it before your mind does, and one day you notice you have been living around a fact you have never once agreed to.",
          },
          {
            kind: "p",
            text: "That is not acceptance in the sense of peace with it. It is closer to carrying: the weight stops being something you are fighting every second and becomes something you have simply picked up, and you can walk further with it than you could.",
          },
          {
            kind: "p",
            text: "The understanding does not come. Parents wait years for the moment it makes sense and it does not arrive, because there is no sense in it. A child dying before their parent is not a thing with a meaning behind it. You can build meaning afterwards — most parents do, in what they make of their life, or in what they do for other people — but that is meaning you made, not meaning that was there.",
          },
          {
            kind: "note",
            text: "You never have to be at peace with it. You are allowed to find it unacceptable for the rest of your life, and still get up, and still have a life. Those two things sit together more easily than they sound.",
          },
        ],
      },
    ],
  },
  {
    heading: "The long part",
    chapters: [
      {
        id: "guilt",
        title: "Guilt",
        summary:
          "The what-ifs, laughing, forgetting for an hour, the other children, and forgiving yourself for something you did not do.",
        body: [
          {
            kind: "p",
            text: "Guilt is nearly universal here and it is not proportional to anything. It attaches to whatever is nearest.",
          },
          {
            kind: "list",
            items: [
              "The what-ifs. If I had checked. If I had said no. If I had driven him. If I had noticed. This runs regardless of whether there was anything to notice — parents of children who died of illnesses nobody could have prevented run it just as hard.",
              "The last conversation, if it was ordinary, or short, or a row.",
              "Laughing. The first time you laugh properly, and then catch yourself, appalled.",
              "Realising you went a whole hour without thinking about them, and the panic that comes with it.",
              "The other children — that they got a shell of a parent for two years, and that you know it.",
              "Being relieved, if the end was long.",
              "Being alive at all, which is the one that runs underneath the rest.",
            ],
          },
          { kind: "heading", text: "What is worth saying about it" },
          {
            kind: "p",
            text: "Guilt is partly a bargain your mind makes. If it was your fault, then it was preventable, and the world is not a place where a child can simply be taken from you for no reason. Guilt is the price of keeping that belief. Feeling responsible is more bearable than being powerless, so the mind chooses it — even against the evidence.",
          },
          {
            kind: "p",
            text: "Which is why arguing with it does not work, and why 'there was nothing you could have done' bounces off. It is not an argument, it is a defence.",
          },
          {
            kind: "list",
            items: [
              "Say the specific thing out loud to one person. It survives on being unspeakable. Said out loud to a therapist or another bereaved parent, most of it gets noticeably smaller.",
              "Test it as a question: would you hold another parent responsible for this, knowing exactly what they knew at the time? You already know the answer for them.",
              "Laughing, forgetting, having a good day — these are not disloyalty. They are your mind surfacing to breathe. It does not mean you loved them less and they would not have wanted you dismantled.",
              "If there was something — a real thing, a mistake, a decision that mattered — it can be true that it happened, and true that you were a person doing your best with what you had. Both. Forgiveness is not the same as pretending.",
            ],
          },
          {
            kind: "note",
            text: "You would forgive them anything. Almost every parent would. It is worth noticing how much less you are willing to extend to yourself.",
          },
        ],
      },
      {
        id: "second-year",
        title: "The second year, going back to work, and the days you just can't",
        summary:
          "Why year two is often worse, what returning to work is actually like, and how to ask for help.",
        body: [
          { kind: "heading", text: "The second year" },
          {
            kind: "p",
            text: "A very large number of bereaved parents say the second year was harder than the first, and almost nobody is warned. The reasons are consistent:",
          },
          {
            kind: "list",
            items: [
              "Shock has fully worn off. Year one is survived partly on anaesthetic and year two is not.",
              "Everyone else has moved on, visibly. The calls stopped months ago. The first anniversary was marked; the second was not.",
              "You have done every first once — the first birthday, the first Christmas — and now face the fact that this is not a year to be got through but the rest of your life.",
              "People start expecting you to be better, and some say so.",
            ],
          },
          {
            kind: "p",
            text: "If you are in year two and feel like you are going backwards: this is the documented shape of it, not a relapse.",
          },
          { kind: "heading", text: "Going back to work" },
          {
            kind: "list",
            items: [
              "The first day is mostly logistics: who knows, who doesn't, and the person who has not heard asking how your weekend was.",
              "Ask one colleague to tell everyone before you arrive, so nobody has to be told by you.",
              "Have one sentence ready for the person who did not get the message. 'I lost my son in March. I'd rather not go into it here, but thank you.'",
              "Arrange somewhere to go for ten minutes — a car, a stairwell, an empty room.",
              "Go back part-time if it is at all possible. Full weeks are usually too much for the first month.",
              "Work is not automatically bad. A lot of parents find the hours of enforced ordinary thought are the only rest they get. That is allowed too.",
            ],
          },
          { kind: "heading", text: "The days you just can't" },
          {
            kind: "p",
            text: "They keep coming, years in, sometimes with a reason and sometimes none. Cancel the thing. Stay in bed. Feed the children cereal for dinner. A day surrendered on purpose is much cheaper than a week spent failing to push through one.",
          },
          { kind: "heading", text: "Asking for help" },
          {
            kind: "list",
            items: [
              "Be concrete. 'Can you take the kids Saturday morning' gets a yes; 'let me know if you need anything' has never once produced help.",
              "Keep a list on your phone of jobs to hand out — school run, groceries, the lawn, the paperwork nobody has touched. When someone offers, read one off it.",
              "Ask the same person more than once. People assume that because you have not asked again, you are fine.",
              "Accept help you do not strictly need, from people who need to be doing something. It is often for them as much as you, and that is fine.",
            ],
          },
        ],
      },
      {
        id: "their-things",
        title: "Their room, and their things",
        summary:
          "Keeping it exactly as it was, clearing it, and the fact that there is no deadline on either.",
        body: [
          {
            kind: "p",
            text: "Somebody will have an opinion about the room. They will think it is unhealthy that it has not been touched, or they will be upset that it has. Neither of them lives there.",
          },
          {
            kind: "p",
            text: "There is no correct time and no correct amount. Parents keep a room untouched for a decade and are fine. Parents clear it in a fortnight because they cannot walk past the door, and are also fine. What tends to cause lasting pain is only this: giving things away before you were ready because you were told you should. That one is not undoable.",
          },
          { kind: "heading", text: "If and when you do" },
          {
            kind: "list",
            items: [
              "Do it in layers. Nothing says it happens in one day. One drawer, then stop for six months.",
              "Keep the unglamorous things. The hairbrush with their hair in it. The half-used deodorant that smells of them. The phone. Parents almost never regret keeping too much; they regret specific things they let go.",
              "Photograph anything you are giving away, especially clothes.",
              "Have someone else in the house but not in the room. Company on the landing, not commentary at your shoulder.",
              "A box that does not get opened is a legitimate destination. It does not have to be sorted to be kept.",
              "Give things to people who loved them, rather than to a charity shop, if you can bear to choose. Their friends often want something very badly and would never ask.",
              "Quilts and bears made from their clothes exist and many parents find them a good answer for the shirts they cannot keep and cannot part with.",
            ],
          },
          {
            kind: "warn",
            text: "If you are moving house, go slowly. The house is often the last place they physically were, and leaving it is a second loss that catches parents completely unprepared. Take the door frame with the height marks on it if you have to. People do.",
          },
        ],
      },
      {
        id: "feeling-dead",
        title: "Carrying on when you feel dead",
        summary:
          "The days when nothing has a point, and what 'enough' means in that week.",
        body: [
          {
            kind: "p",
            text: "There will be stretches when you feel as though you died alongside them and are only walking around. Why eat, why wash, why any of it. This is one of the most common and least-admitted parts of losing a child: not wanting to die, exactly, but not being able to find the point of continuing.",
          },
          {
            kind: "p",
            text: "In that week, survival is the whole task. If you brushed your teeth, that was the day's work. If you got dressed, that was it. If you fed the other children something out of a packet, that counted.",
          },
          {
            kind: "p",
            text: "You do not have to be okay. You do not have to heal on anybody's schedule, and you do not have to find a purpose in this year. The point comes back on its own, slowly, and usually through something small and stupid — a dog, a garden, someone else who needs something. Not through deciding to have a point.",
          },
          {
            kind: "warn",
            text: "If this has moved from 'I can't see the point' to thinking about how, read the chapter on thoughts of not wanting to be here, and call or text 988 tonight.",
          },
        ],
      },
      {
        id: "healing",
        title: "What healing actually looks like",
        summary:
          "Not getting over it, not moving on, and what is genuinely different in year five.",
        body: [
          {
            kind: "p",
            text: "You will not get over it. You will not stop loving them, or missing them, and there is no version of this where you are done. Anybody promising otherwise is selling something.",
          },
          {
            kind: "p",
            text: "What does change, and it does change:",
          },
          {
            kind: "list",
            items: [
              "The waves come as far apart as they used to come close together.",
              "You can see them coming, sometimes, and get somewhere first.",
              "You can say their name without it costing the whole day.",
              "You can remember them alive. Early on, every memory ends at the death; later, the years before start coming back on their own.",
              "Joy returns, and eventually it comes without a bill attached.",
              "You can be with other people's children — and later, other people's grandchildren — without needing to leave the room.",
              "You get useful to somebody else in this. Many parents say this was the turn.",
            ],
          },
          {
            kind: "p",
            text: "It is not moving on and it is not letting go. It is closer to the grief and the rest of your life eventually occupying the same space instead of fighting over it. They stay. You carry them, and it stops being all you can do.",
          },
          {
            kind: "note",
            text: "Wherever you are in this today is where you are supposed to be, including if that is nowhere at all. There is no schedule and you are not behind.",
          },
        ],
      },
    ],
  },
];
