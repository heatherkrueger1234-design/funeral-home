/**
 * A flat list of every chapter in the guides, for searching.
 *
 * Kept as titles and summaries rather than full text on purpose. The search
 * returns chapter *ids* and the client renders the real chapter, so the index
 * only has to be good enough to rank — and a short index is what makes it
 * affordable to hand the whole thing to a model in one prompt, with no
 * embedding store, no vector database and nothing to keep in sync.
 *
 * It is duplicated from the frontend content rather than imported because the
 * two packages do not depend on each other, and this list changes about as
 * often as a chapter is added. `test/guide-search.test.ts` fails if it drifts
 * out of step with the number of chapters the frontend ships.
 */

export type GuideChapter = {
  id: string;
  /** Which page it lives on, for the link. */
  page: string;
  title: string;
  summary: string;
};

export const GUIDE_CHAPTERS: GuideChapter[] = [
  // --- The first days ---
  { id: "viewing", page: "/first-days", title: "Seeing them, holding them, and being told not to", summary: "What they will look like, what you are allowed to do, and why 'I wouldn't' is not a rule." },
  { id: "embalming", page: "/first-days", title: "Embalming or refrigeration", summary: "Embalming is almost never required by law. What each means for a viewing and for the bill." },
  { id: "autopsy", page: "/first-days", title: "The autopsy", summary: "When it is required, what is done, seeing them afterwards, and what is in the report." },
  { id: "closing-fast", page: "/first-days", title: "What to take from them before you cannot", summary: "Hair, handprints, fingerprints, photographs, voicemails, and the window each one closes in." },
  { id: "donation", page: "/first-days", title: "Organ and tissue donation", summary: "A short window, an early phone call, and what donation does and does not rule out." },
  { id: "belongings-from-the-hospital", page: "/first-days", title: "Getting their things back", summary: "The bag from the hospital, what the police keep, and how to ask for the clothes." },
  { id: "cheapest", page: "/first-days", title: "If there is no money", summary: "Direct cremation, cheaper caskets, state assistance, and what a funeral home may not require." },
  { id: "home-funeral", page: "/first-days", title: "Keeping them at home, and burying them on your own land", summary: "Home vigils and home burial are legal in most of the US. What that requires, by state." },
  { id: "not-rushing", page: "/first-days", title: "You are allowed to wait", summary: "There is no deadline on a memorial. Doing it in five days is a custom, not a rule." },
  { id: "every-option", page: "/first-days", title: "The whole list, on one page", summary: "Every legal option in the US for what happens to their body, one line each: burial, green burial, conservation, home burial, cremation, water cremation, composting, pyre, sea, donation." },
  { id: "green-burial", page: "/first-days", title: "Green and natural burial", summary: "No embalming, no vault, a shroud or plain box. Hybrid, natural and conservation burial grounds, and why the vault is a cemetery rule and not a law." },
  { id: "water-cremation", page: "/first-days", title: "Water cremation", summary: "Alkaline hydrolysis, aquamation, flameless cremation. Water and alkali instead of fire, returns more of them, legal in about half the states." },
  { id: "composting", page: "/first-days", title: "Human composting", summary: "Natural organic reduction or terramation: their body becomes about a cubic yard of living soil. Where it is legal, and using it from a state where it is not." },
  { id: "the-pyre", page: "/first-days", title: "The open-air pyre in Crestone, Colorado", summary: "The only public funeral pyre in the United States, its residency limit, and why a Viking funeral is not legal anywhere." },
  { id: "at-sea", page: "/first-days", title: "Burial at sea", summary: "Legal nationwide under a federal EPA permit you do not apply for. Distance and depth rules for a whole body and for ashes, and doing it yourself." },
  { id: "becoming-a-tree", page: "/first-days", title: "Planting them as a tree, honestly", summary: "The burial pod is a design concept and raw ashes will kill a tree. Memorial trees, tree urns, conservation burial, reefs and scattering, and what actually works." },
  { id: "donating-their-body", page: "/first-days", title: "Donating their body to science", summary: "Whole-body donation to a medical school or anatomical board. Usually free, the body-broker problem to avoid, and why it is often not possible for a child." },
  { id: "obituary-and-shame", page: "/first-days", title: "The obituary when you are ashamed of how they died", summary: "Overdose, suicide, a crime. What you owe the truth and what you do not." },
  { id: "split-families", page: "/first-days", title: "Divorced, separated, and who gets to decide", summary: "Who has legal authority over the body and the funeral, and how to survive it not being you." },

  // --- What to expect ---
  { id: "what-to-expect", page: "/healing", title: "What to expect", summary: "There is no order to this and no timeline, and the five stages were never a rulebook." },
  { id: "doesnt-feel-real", page: "/healing", title: "It doesn't feel real — and then the day it does", summary: "The strange calm of the first weeks, and why the collapse comes when everyone thinks you are through it." },
  { id: "dissociation", page: "/healing", title: "Feeling detached, foggy, or outside your own life", summary: "Watching yourself from a distance, losing days, feeling nothing when you should feel everything." },
  { id: "replaying", page: "/healing", title: "Replaying it, and needing to know exactly what happened", summary: "The loop of their last day, and why you want details other people find unbearable." },
  { id: "sudden-or-expected", page: "/healing", title: "Sudden, or expected", summary: "The two roads into this, and the particular guilt each one carries." },
  { id: "the-body", page: "/healing", title: "Sleep, fog, forgetting, drinking, and what grief does to your body", summary: "Insomnia, losing words, the weight, the drinking that starts reasonably, and PTSD, which is treatable." },
  { id: "dreams", page: "/healing", title: "Dreaming about them", summary: "The dreams where they are alive, the ones where you lose them again, and not dreaming at all." },
  { id: "not-wanting-to-be-here", page: "/healing", title: "Thoughts of not wanting to be here", summary: "Wanting to be where they are, the difference between that and a plan, and what to do tonight." },
  { id: "professional-help", page: "/healing", title: "When to get help, and what actually helps", summary: "The difference between a grief counsellor, a trauma therapist and a support group." },
  { id: "being-the-pillar", page: "/healing", title: "Being the pillar", summary: "Holding everyone else up while you are the one who has actually collapsed." },
  { id: "siblings", page: "/healing", title: "Their brothers and sisters", summary: "The younger one with the same face, the questions they ask, and the grief that gets overlooked." },
  { id: "the-table", page: "/healing", title: "The table", summary: "Setting their place or refusing to, the empty chair at Christmas, and both being right." },
  { id: "going-quiet", page: "/healing", title: "Going quiet", summary: "You stop saying their name because everyone looks tired of it, and you still think of them constantly." },
  { id: "strangers", page: "/healing", title: "Strangers", summary: "The world carrying on around you, the kindness that lands and the rudeness that does not know." },
  { id: "ambushes", page: "/healing", title: "Ambushes", summary: "Their name called across a car park, a song in a shop, someone their age in the next aisle." },
  { id: "how-many-children", page: "/healing", title: "How many kids do you have?", summary: "The most ordinary question there is, and the impossible choice inside it." },
  { id: "relationships", page: "/healing", title: "Friends, family, and being alone in a full room", summary: "The friends who vanish, the ones who surprise you, and why nobody can reach you in there." },
  { id: "marriage-and-after", page: "/healing", title: "Your marriage, sex, and whether to have another baby", summary: "Grieving on different timelines, the myth about divorce, and pregnancy after loss." },
  { id: "signs", page: "/healing", title: "Signs", summary: "Flickering lights, songs, feathers, mediums, and the argument nobody needs to have." },
  { id: "anger-at-god", page: "/healing", title: "Anger at God, and the church that did or did not show up", summary: "Being furious at something you may not be sure you believe in." },
  { id: "acceptance", page: "/healing", title: "Acceptance without understanding", summary: "Living with a fact you will never make sense of, and why acceptance is the wrong word." },
  { id: "guilt", page: "/healing", title: "Guilt", summary: "The what-ifs, laughing, forgetting for an hour, and forgiving yourself for something you did not do." },
  { id: "second-year", page: "/healing", title: "The second year, going back to work, and the days you just can't", summary: "Why year two is often harder, and what returning to work is actually like." },
  { id: "their-things", page: "/healing", title: "Their room, and their things", summary: "Keeping it as it was, clearing it, and the fact that there is no deadline on either." },
  { id: "feeling-dead", page: "/healing", title: "Carrying on when you feel dead", summary: "The days when nothing has a point, and what 'enough' means that week." },
  { id: "healing", page: "/healing", title: "What healing actually looks like", summary: "Not getting over it, not moving on, and what is genuinely different years later." },

  // --- Money and paperwork ---
  { id: "death-certificates", page: "/money", title: "Death certificates, and how many to order", summary: "The paperwork that unlocks everything else. Order more than you think." },
  { id: "what-can-wait", page: "/money", title: "What is urgent, and what is not", summary: "Almost nothing needs doing this month. These few things do." },
  { id: "medical-bills", page: "/money", title: "The medical bills that keep coming", summary: "Being invoiced for treatment that did not work, and how to actually dispute it." },
  { id: "their-debts", page: "/money", title: "Their debts", summary: "Student loans, credit cards, and what a collector may not tell you." },
  { id: "lease-car-phone", page: "/money", title: "Their lease, their car, and their phone", summary: "The three with running costs, and the one to keep paying on purpose." },
  { id: "life-insurance", page: "/money", title: "Life insurance and benefits nobody mentions", summary: "The policies that exist without anyone knowing, and how to find them." },
  { id: "taxes", page: "/money", title: "Taxes, the estate, and if there was no will", summary: "Claiming them for the year they died, the final return, and probate with nothing to probate." },
  { id: "leave-from-work", page: "/money", title: "Time off work, and how little of it there is", summary: "Three days of bereavement leave, FMLA that does not cover grief, and none if you work for yourself." },
  { id: "social-media", page: "/money", title: "Their social media", summary: "Memorialising, deleting, and getting the photographs out first." },
  { id: "subscriptions", page: "/money", title: "Subscriptions and the small recurring things", summary: "The charges that keep going out, and the reminders that keep arriving." },

  // --- If it was public, or criminal ---
  { id: "reporters", page: "/public-or-criminal", title: "Reporters", summary: "What they can and cannot do, and how to get one photograph used instead of another." },
  { id: "comments", page: "/public-or-criminal", title: "The comments", summary: "Strangers writing about your dead child under the news article, and why you will read them." },
  { id: "stigma", page: "/public-or-criminal", title: "Overdose, suicide, and the questions people ask", summary: "Grieving a death other people think they are allowed to have opinions about." },
  { id: "advocates", page: "/public-or-criminal", title: "Victim advocates and who is actually on your side", summary: "A free service most families are never told exists." },
  { id: "compensation", page: "/public-or-criminal", title: "Victim compensation", summary: "A state fund that pays funeral costs and counselling, with a deadline nobody mentions." },
  { id: "wrongful-death", page: "/public-or-criminal", title: "Wrongful death, and whether to sue", summary: "A separate civil case with its own clock, and what it costs you to run one." },
  { id: "the-trial", page: "/public-or-criminal", title: "The trial, years later", summary: "Waiting, plea deals, being in the room, the impact statement, and afterwards." },

  // --- For family and friends ---
  { id: "the-one-thing", page: "/for-family-and-friends", title: "If you read nothing else", summary: "Six things that cover most of it, for somebody supporting a grieving person." },
  { id: "what-to-say", page: "/for-family-and-friends", title: "What to say", summary: "Sentences that actually work, including when you have no idea what to say." },
  { id: "what-not-to-say", page: "/for-family-and-friends", title: "What not to say", summary: "The well-meant sentences that do real damage, and why each one lands that way." },
  { id: "what-helps", page: "/for-family-and-friends", title: "What actually helps", summary: "Concrete things to do, in the first month and the eleven after it." },
  { id: "what-to-expect-from-them", page: "/for-family-and-friends", title: "What to expect from them", summary: "Why they may be angry with you, cancel everything, or seem completely fine." },
  { id: "if-you-live-with-it", page: "/for-family-and-friends", title: "If it is your family too", summary: "For grandparents, siblings and partners, grieving the person and the parent at once." },
];
