"use strict";
/* ===========================================================================
   Holding Today — a walkthrough, not the product.
   Every family, funeral home, price and figure below is invented. Nothing
   leaves the browser and nothing is stored anywhere: reload and it is back at
   the beginning.

   Four sides of one platform:
     Master    — you, adding funeral homes and setting each one up
     Sign-in   — what anybody reaches on the web
     Planning  — a living person writing their own file
     Family    — the people left behind, opening that same file
     Director  — the home working its cases
   =========================================================================== */

const DAY = 86400000;
const EPOCH = new Date(2026, 8, 8, 4, 20);            // Tue 8 Sep 2026, 4:20am
const d2 = (n) => new Date(EPOCH.getTime() + n * DAY);

const STOPS = [
  { d: -1095, n: "3 yrs before", t: "Thomas plans" },
  { d: 0,     n: "Day 0",        t: "Margaret dies" },
  { d: 1,     n: "Day 1",        t: "Arrangement" },
  { d: 2,     n: "Day 2",        t: "Family uploads" },
  { d: 4,     n: "Day 4",        t: "Proofs approved" },
  { d: 5,     n: "Day 5",        t: "The service" },
  { d: 19,    n: "Day 19",       t: "Case closed" },
  { d: 35,    n: "+30 days",     t: "First check-in" },
  { d: 65,    n: "+60 days",     t: "Second check-in" },
  { d: 95,    n: "+90 days",     t: "Third check-in" },
  { d: 370,   n: "+1 year",      t: "The anniversary" }
];

/* ------------------------------------------------------------- helpers --- */

const $ = (s, r) => (r || document).querySelector(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = (p) => p + Math.random().toString(36).slice(2, 8);

const fmtDay   = (d) => d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
const fmtShort = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const fmtFull  = (d) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const fmtTime  = (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const sod = (d) => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c.getTime(); };
const money = (n) => "$" + Number(n).toLocaleString("en-US");

const swatch = (tone) =>
  "background:linear-gradient(140deg,hsl(" + tone + " 26% 74%),hsl(" + ((tone + 40) % 360) + " 20% 56%))";

/* ================================================================ seeds === */

/* Every home gets this the day it signs up, and then edits it. Offsets are in
   days; `anchor` says what they are counted from — the service, or the day the
   file was opened. A home that wants "clothing in 48 hours after we take her
   into our care" needs the second, and the first version of this only had the
   first. */
const BASE_SCHEDULE = () => ([
  { id: uid("s"), title: "Photographs in for the slideshow", off: -4, anchor: "service", desc: "Anything you have is welcome — old, blurry, or straight from a phone.", event: false },
  { id: uid("s"), title: "Tell us about her for the obituary", off: -4, anchor: "service", desc: "Names, dates and a few sentences. We will write it up and check it with you.", event: false },
  { id: uid("s"), title: "Bring clothing to the funeral home", off: 2, anchor: "open", desc: "Including anything she should be wearing — glasses, a ring, a watch.", event: false },
  { id: uid("s"), title: "Vital statistics for the death certificate", off: -3, anchor: "service", desc: "We need these to file. Anything you are unsure of, leave blank and ring us.", event: false },
  { id: uid("s"), title: "Approve the proof for the service cards", off: -2, anchor: "service", desc: "A last read for spellings, especially names.", event: false },
  { id: uid("s"), title: "The service", off: 0, anchor: "service", desc: null, event: true }
]);

const FORM_VITALS = () => ({
  id: uid("f"), name: "Vital Statistics Worksheet", note: "Required to file the death certificate", attached: true, preplan: true,
  fields: [
    { k: "legal",     label: "Full legal name", type: "text" },
    { k: "maiden",    label: "Name at birth, if different", type: "text" },
    { k: "dob",       label: "Date of birth", type: "date" },
    { k: "birthpl",   label: "Place of birth (city, state)", type: "text" },
    { k: "father",    label: "Father's full name", type: "text" },
    { k: "mother",    label: "Mother's name before first marriage", type: "text" },
    { k: "edu",       label: "Highest level of schooling completed", type: "select", opts: ["", "High school", "Some college", "Associate", "Bachelor's", "Master's or higher"] },
    { k: "occ",       label: "Usual occupation (not “retired”)", type: "text" },
    { k: "industry",  label: "Kind of business or industry", type: "text" },
    { k: "vet",       label: "Ever served in the US armed forces?", type: "select", opts: ["", "Yes", "No", "Unsure"] },
    { k: "informant", label: "Informant's name and relationship", type: "text" }
  ]
});

const FORM_CREMATION = () => ({
  id: uid("f"), name: "Authorization for Cremation", note: "Must be signed before we may proceed", attached: true, preplan: false,
  fields: [
    { k: "auth",    label: "Authorising agent (full name)", type: "text" },
    { k: "rel",     label: "Relationship to decedent", type: "text" },
    { k: "pace",    label: "Pacemaker or other implanted device?", type: "select", opts: ["", "Yes", "No", "Unsure"] },
    { k: "jewel",   label: "Jewellery to be removed before cremation", type: "textarea" },
    { k: "witness", label: "Do you wish to witness the cremation?", type: "select", opts: ["", "Yes", "No"] },
    { k: "disp",    label: "Where the cremated remains should go", type: "textarea" }
  ]
});

const FORM_OBIT = () => ({
  id: uid("f"), name: "Obituary Information", note: "What runs in the paper and on our site", attached: true, preplan: true,
  fields: [
    { k: "survived", label: "Survived by", type: "textarea" },
    { k: "pre",      label: "Preceded in death by", type: "textarea" },
    { k: "memorial", label: "Memorial gifts to", type: "text" },
    { k: "note",     label: "Anything else the notice should say", type: "textarea" }
  ]
});

const FORM_CARE = () => ({
  id: uid("f"), name: "Personal Care Wishes", note: "How you would like to look", attached: true, preplan: true,
  fields: [
    { k: "hair",     label: "Hair — who does it, and how", type: "textarea" },
    { k: "makeup",   label: "Makeup", type: "textarea" },
    { k: "clothing", label: "What to dress me in", type: "textarea" },
    { k: "jewel",    label: "Glasses, jewellery, anything that stays on", type: "textarea" },
    { k: "nails",    label: "Nails", type: "text" },
    { k: "glasses",  label: "Glasses on or off", type: "select", opts: ["", "On", "Off"] }
  ]
});

const FORM_EFFECTS = () => ({
  id: uid("f"), name: "Release of Personal Effects", note: "Signed when belongings go back to the family", attached: false, preplan: false,
  fields: [
    { k: "items", label: "Items released", type: "textarea" },
    { k: "to",    label: "Released to", type: "text" }
  ]
});

const BASE_FORMS = () => [FORM_VITALS(), FORM_CREMATION(), FORM_OBIT(), FORM_CARE(), FORM_EFFECTS()];

const BASE_INVENTORY = () => ([
  { id: uid("i"), name: "Walnut classic urn", price: 295, desc: "Solid walnut, engraved plate", glyph: "⚱", kind: "Urn" },
  { id: uid("i"), name: "Brushed pewter urn", price: 240, desc: "Matte finish, holds 200 cu in", glyph: "⚱", kind: "Urn" },
  { id: uid("i"), name: "Hand-thrown stoneware", price: 410, desc: "Made in Lyons, no two alike", glyph: "⚱", kind: "Urn" },
  { id: uid("i"), name: "Biodegradable scattering tube", price: 85, desc: "For water or a hillside", glyph: "⚱", kind: "Urn" },
  { id: uid("i"), name: "Keepsake pendant, set of four", price: 180, desc: "A small share for each child", glyph: "◇", kind: "Keepsake" },
  { id: uid("i"), name: "Linen register book", price: 65, desc: "Ivory, 160 signature lines", glyph: "✐", kind: "Stationery" },
  { id: uid("i"), name: "Service cards, 100", price: 120, desc: "Printed here, next-day", glyph: "✐", kind: "Stationery" },
  { id: uid("i"), name: "Poplar cremation casket", price: 1150, desc: "For a viewing before cremation", glyph: "▭", kind: "Casket" }
]);

const BASE_PLOTS = () => ([
  { id: uid("g"), section: "Cedar Rise, section C", no: "C-114", price: 2400, desc: "Under the older cedars, east slope", kind: "Full burial" },
  { id: uid("g"), section: "Cedar Rise, section C", no: "C-115", price: 2400, desc: "Beside C-114 — families often take the pair", kind: "Full burial" },
  { id: uid("g"), section: "The Meadow", no: "M-032", price: 1850, desc: "Open ground, mown twice a year, flat markers only", kind: "Full burial" },
  { id: uid("g"), section: "Columbarium, north wall", no: "N-18", price: 1250, desc: "Granite niche, holds two urns", kind: "Niche" },
  { id: uid("g"), section: "Memory Garden", no: "MG-07", price: 640, desc: "Scattering bed with a name on the wall", kind: "Scattering" }
]);

function makeHome(o) {
  return Object.assign({
    id: uid("h"), logo: null, opens: "8:30am", closes: "5:00pm",
    schedule: BASE_SCHEDULE(), forms: BASE_FORMS(), inventory: BASE_INVENTORY(),
    plots: BASE_PLOTS(), slots: [], cemetery: "Cedar Hollow Memorial Gardens"
  }, o);
}

/* ------------------------------------------------------------ the world -- */

const cedar = makeHome({
  id: "cedar", name: "Cedar Hollow Funeral Home", initials: "CH", accent: "#23574E",
  line1: "418 Larimer Street", city: "Longmont", region: "CO", postal: "80501",
  phone: "(303) 555-0142", urgent: "(303) 555-0199", director: "Karen Voss",
  cemetery: "Cedar Hollow Memorial Gardens"
});

const ridgeway = makeHome({
  id: "ridgeway", name: "Ridgeway & Sons", initials: "R&S", accent: "#6B3A2E",
  line1: "12 Chapel Row", city: "Pueblo", region: "CO", postal: "81003",
  phone: "(719) 555-0177", urgent: "(719) 555-0180", director: "Michael Ridgeway",
  opens: "9:00am", closes: "4:30pm", cemetery: "Chapel Row Cemetery"
});

cedar.slots = [
  { id: uid("a"), day: 1,  time: "2:00pm",  mins: 90, what: "Arrangement conference", taken: "hale" },
  { id: uid("a"), day: 3,  time: "10:00am", mins: 30, what: "Bring clothing and photographs", taken: null },
  { id: uid("a"), day: 3,  time: "3:30pm",  mins: 30, what: "Bring clothing and photographs", taken: null },
  { id: uid("a"), day: 4,  time: "11:00am", mins: 45, what: "Private viewing, immediate family", taken: null },
  { id: uid("a"), day: 4,  time: "4:00pm",  mins: 45, what: "Private viewing, immediate family", taken: null },
  { id: uid("a"), day: 21, time: "1:00pm",  mins: 30, what: "Collect cremated remains", taken: null }
];

const fid = (home, name) => home.forms.find((f) => f.name.indexOf(name) === 0).id;

function makePerson(o) {
  return Object.assign({
    id: uid("p"), kind: "at-need", status: "open",
    answers: {}, answeredBy: {}, done: {}, frozen: {}, flags: {},
    photos: [], messages: [], videos: [], letters: [], sealed: [],
    chosen: {}, plot: null, aftercare: "pending", openedDay: 0, serviceDay: null, serviceHour: 10
  }, o);
}

/* --- Margaret Hale: the ordinary case. No pre-plan, family does everything. */
const hale = makePerson({
  id: "hale", homeId: "cedar", no: "26-0418",
  first: "Margaret", middle: "Ellen", last: "Hale",
  dob: "11/02/1944", born: d2(-29900), diedDay: 0, openedDay: 0, serviceDay: 5, serviceHour: 10,
  serviceWhere: "St Anne’s, Longmont", disposition: "Cremation following the service",
  nok: "Anne Hale", rel: "Daughter", nokPhone: "(303) 555-0166",
  photos: [
    { id: uid("ph"), label: "Mum and Dad, Estes Park", tone: 200, sel: true,  pos: 1, from: "Anne" },
    { id: uid("ph"), label: "Her 80th, the garden",     tone: 30,  sel: true,  pos: 2, from: "Anne" },
    { id: uid("ph"), label: "Nursing school, 1964",     tone: 60,  sel: true,  pos: 3, from: "Peter" },
    { id: uid("ph"), label: "With the grandchildren",   tone: 340, sel: true,  pos: 4, from: "Anne" },
    { id: uid("ph"), label: "Wedding day",              tone: 15,  sel: false, pos: 0, from: "Peter" },
    { id: uid("ph"), label: "On the porch at Kersey",   tone: 150, sel: false, pos: 0, from: "Anne" },
    { id: uid("ph"), label: "Christmas, about 1998",    tone: 280, sel: false, pos: 0, from: "Peter" },
    { id: uid("ph"), label: "Her allotment",            tone: 100, sel: false, pos: 0, from: "Anne" }
  ],
  messages: [
    { who: "home", at: 1.35, body: "Anne — it was good to meet you and Peter this afternoon. I have opened your mother's page. Everything I need from you is on it, with the day I need it by. Nothing here is urgent tonight." },
    { who: "fam",  at: 1.80, body: "Thank you. Peter is flying in Thursday so the photos might be slow." },
    { who: "home", at: 2.05, body: "That is fine. The slideshow is the last thing we build and Thursday leaves plenty of room. Send them as you find them rather than all at once." },
    { who: "fam",  at: 2.42, body: "Does she need shoes?" },
    { who: "home", at: 2.50, body: "Not for a cremation, no. Bring whatever you would like her to be wearing and we will do the rest." }
  ]
});

/* --- Thomas Pryor: pre-planned three years ago. The whole point of the demo:
       his file already exists when he dies, and his family walks into it.    */
const pryor = makePerson({
  id: "pryor", homeId: "cedar", no: "26-P009", kind: "pre-need",
  first: "Thomas", middle: "Reid", last: "Pryor",
  dob: "06/22/1949", born: d2(-28200), diedDay: null, planStartDay: -1095,
  serviceWhere: "Cedar Hollow chapel", disposition: "Burial, Cedar Rise section C",
  nok: "Ruth Pryor", rel: "Daughter", nokPhone: "(303) 555-0134",
  videos: [
    { id: uid("v"), title: "Why I chose all this myself", forWhom: "Everyone", mins: "4:12", day: -1095, tone: 190,
      transcript: "If you're watching this it means I'm gone and somebody has handed you a screen at a bad moment. I did this so nobody has to guess and nobody has to argue. It's all paid for and it's all written down. Have the sandwiches at the house, not a hall." },
    { id: uid("v"), title: "For Ruth, about the house", forWhom: "Ruth", mins: "6:38", day: -1090, tone: 25,
      transcript: "Ruth — the deed is in the green folder in the bottom drawer, not the filing cabinet. Don't let anybody tell you the boundary runs at the fence; it runs at the ditch and there's a survey to prove it." },
    { id: uid("v"), title: "The story about your grandmother", forWhom: "Everyone", mins: "11:04", day: -940, tone: 285,
      transcript: "She came over in 1931 with a suitcase and a cousin's address that turned out to be wrong. I've told this badly at every Christmas for forty years. Here it is properly, once." }
  ],
  letters: [
    { id: uid("l"), title: "A note before the service", forWhom: "Everyone", day: -1095,
      body: ["Don't wear black on my account. I never liked it on any of you.",
             "There is money set aside for this and it is already spent, so nobody is to start a row about who pays for what. That was the point.",
             "Be kind to your sister. She takes these things harder than she lets on."] },
    { id: uid("l"), title: "What I want said, and what I don't", forWhom: "Everyone", day: -1042,
      body: ["No long eulogy. Ten minutes, and let Father Alan do it, he's quick.",
             "Do not read the poem Margaret read at Ron's. It was lovely and it is not mine."] }
  ],
  sealed: [
    { id: uid("z"), forWhom: "Ruth", rel: "Daughter", hint: "The town we broke down in, 1987", pass: "cheyenne",
      body: ["Ruth — this is the one I couldn't say out loud, so it is in writing instead, which is cowardly of me and I am doing it anyway.",
             "You were right about the business and I was wrong, and I let you believe I thought otherwise for eleven years because I could not stand to say it. I thought it. I thought it the whole time.",
             "Whatever is left after the house sells is yours to do as you like with. Don't ask your brother. Don't ask me — I'm not there."] },
    { id: uid("z"), forWhom: "Daniel", rel: "Son", hint: "The dog we had when you were six", pass: "biscuit",
      body: ["Daniel — you'll have heard by now that I left the workshop to you and not the money. That was not a judgement, it was the opposite.",
             "You are the only one who ever made anything in there and I could not bear for it to be sold for the timber.",
             "I am sorry about the wedding. I should have come."] },
    { id: uid("z"), forWhom: "Ellie", rel: "Granddaughter", hint: "What I always called you", pass: "sparrow",
      body: ["Ellie — you're probably about twenty by now and I'd guess nobody has told you this one.",
             "Your grandmother and I nearly didn't. We were apart for two years and I spent both of them being an idiot about it.",
             "Whatever you're in the middle of right now that feels final: it usually isn't. Go and say the thing."] }
  ],
  messages: [
    { who: "home", at: -1094, body: "Thomas — everything is recorded and your file is locked to your name. When the time comes your family will not have to find a single piece of paper. Ring me if you change your mind about any of it; people usually change something." }
  ]
});

/* Thomas answered these himself, years ago. `answeredBy` is what lets the
   family's side say so rather than silently showing a filled box. */
function seedPryorAnswers() {
  const V = fid(cedar, "Vital"), O = fid(cedar, "Obituary"), C = fid(cedar, "Personal Care");
  const put = (f, k, v) => { pryor.answers[f + "." + k] = v; pryor.answeredBy[f + "." + k] = "self"; };
  put(V, "legal", "Thomas Reid Pryor");
  put(V, "maiden", "");
  put(V, "dob", "1949-06-22");
  put(V, "birthpl", "Sterling, CO");
  put(V, "father", "Reid Alan Pryor");
  put(V, "mother", "Hannah Vance");
  put(V, "edu", "Some college");
  put(V, "occ", "Cabinetmaker");
  put(V, "industry", "Building trades");
  put(V, "vet", "Yes");
  put(O, "survived", "His daughter Ruth, his son Daniel, and four grandchildren.");
  put(O, "pre", "His wife Eileen, 2014.");
  put(O, "memorial", "Sterling High School woodshop");
  put(O, "note", "He would want it said that he built the pews in the Cedar Hollow chapel in 1978 and they have not moved since.");
  put(C, "hair", "Short, the way Eileen always cut it. Don't let anyone do anything clever.");
  put(C, "makeup", "None.");
  put(C, "clothing", "The grey suit, no tie. Tie in the pocket if it bothers anybody.");
  put(C, "jewel", "Wedding ring stays on. Watch goes to Daniel.");
  put(C, "nails", "Trimmed, that's all.");
  put(C, "glasses", "On");
  pryor.chosen[cedar.inventory[7].id] = true;         // poplar casket
  pryor.chosen[cedar.inventory[5].id] = true;         // register book
  pryor.plot = cedar.plots[0].id;                      // C-114
}
seedPryorAnswers();

/* Margaret's family has filled some of hers. */
function seedHaleAnswers() {
  const V = fid(cedar, "Vital"), R = fid(cedar, "Authorization"), O = fid(cedar, "Obituary");
  const put = (f, k, v) => { hale.answers[f + "." + k] = v; hale.answeredBy[f + "." + k] = "family"; };
  put(V, "legal", "Margaret Ellen Hale");
  put(V, "maiden", "Margaret Ellen Doyle");
  put(V, "dob", "1944-11-02");
  put(V, "birthpl", "Kersey, CO");
  put(V, "father", "James Doyle");
  put(V, "occ", "Registered nurse");
  put(V, "industry", "Hospital");
  put(V, "vet", "No");
  put(V, "informant", "Anne Hale, daughter");
  put(R, "auth", "Anne Hale");
  put(R, "rel", "Daughter");
  put(R, "jewel", "Wedding ring — please return to me. Everything else may stay.");
  put(R, "witness", "No");
  put(O, "survived", "Her children Anne and Peter, six grandchildren, and her sister Ruth.");
  put(O, "pre", "Her husband Ronald, 2019.");
  put(O, "memorial", "Longmont Hospice");
  hale.flags[fid(cedar, "Vital") + ".mother"] = "The state will reject the certificate without this. Ring your aunt Ruth if you are not sure.";
  hale.flags[fid(cedar, "Authorization") + ".pace"] = "We cannot cremate until somebody has answered this. It is a legal question, not a medical one — if you don't know, put Unsure and we will check.";
  hale.chosen[cedar.inventory[1].id] = true;
  hale.chosen[cedar.inventory[5].id] = true;
  cedar.slots[0].taken = "hale";
}
seedHaleAnswers();

const alarcon = makePerson({
  id: "alarcon", homeId: "cedar", no: "26-0417",
  first: "Roberto", middle: "Luis", last: "Alarcón",
  dob: "03/14/1951", born: d2(-27600), diedDay: -2, openedDay: -2, serviceDay: 4, serviceHour: 14,
  serviceWhere: "Our Lady of the Valley", disposition: "Burial",
  nok: "Sofia Alarcón", rel: "Wife", nokPhone: "(303) 555-0121"
});
const whitfield = makePerson({
  id: "whitfield", homeId: "cedar", no: "26-0415", status: "closed", aftercare: "on",
  first: "Dorothy", middle: "", last: "Whitfield",
  dob: "01/09/1938", born: d2(-32300), diedDay: -11, openedDay: -11, serviceDay: -6, serviceHour: 11,
  serviceWhere: "Cedar Hollow chapel", disposition: "Cremation",
  nok: "Gerald Whitfield", rel: "Son", nokPhone: "(303) 555-0188"
});
const boone = makePerson({
  id: "boone", homeId: "cedar", no: "26-0412", status: "archived",
  first: "Estelle", middle: "", last: "Boone",
  dob: "02/03/1941", born: d2(-31200), diedDay: -28, openedDay: -28, serviceDay: -23, serviceHour: 10,
  serviceWhere: "Cedar Hollow chapel", disposition: "Cremation",
  nok: "Marcus Boone", rel: "Son", nokPhone: "(303) 555-0109"
});
const vance = makePerson({
  id: "vance", homeId: "ridgeway", no: "26-0044",
  first: "Harriet", middle: "June", last: "Vance",
  dob: "09/30/1946", born: d2(-29200), diedDay: -1, openedDay: -1, serviceDay: 6, serviceHour: 13,
  serviceWhere: "Chapel Row", disposition: "Burial",
  nok: "Douglas Vance", rel: "Son", nokPhone: "(719) 555-0155"
});

/* ================================================================ state === */

const state = {
  view: "director",
  day: 2,
  homes: [cedar, ridgeway],
  people: [hale, pryor, alarcon, whitfield, boone, vance],

  /* sign-in */
  doorHome: null, doorPick: null, doorTyped: "", doorError: null,

  /* who is signed in, and as what */
  session: null,          // { personId, as: "family" | "self" }

  familyTab: "hub",
  planStep: "who",
  dirHome: "cedar", dirPerson: "hale", dirTab: "overview",
  masterHome: "cedar", masterTab: "brand",

  openSealed: {},         // sealed note id -> true once unlocked
  sealTry: {},            // sealed note id -> what has been typed
  sealErr: {},
  editingFlag: null,      // "formId.fieldKey" while the director types a note
  toast: null
};

/* ------------------------------------------------------------ accessors -- */

const now = () => d2(state.day);
const homeById = (id) => state.homes.find((h) => h.id === id);
const personById = (id) => state.people.find((p) => p.id === id);
const peopleOf = (homeId) => state.people.filter((p) => p.homeId === homeId);
const fullName = (p) => [p.first, p.middle, p.last].filter(Boolean).join(" ");
const shortName = (p) => p.first + " " + p.last;
const isDead = (p) => p.diedDay !== null && p.diedDay !== undefined && state.day >= p.diedDay;
const serviceAt = (p) => p.serviceDay === null ? null : new Date(d2(p.serviceDay).setHours(p.serviceHour, 0, 0, 0));

function dueDate(p, step) {
  /* A step the family has already ticked off keeps the date it was due on.
     Moving a funeral must carry the unfinished work with it and leave the
     finished work alone — telling a daughter who delivered the clothing on
     Tuesday that it is now due Thursday would be worse than saying nothing. */
  if (p.frozen && p.frozen[step.id]) return new Date(p.frozen[step.id]);
  const base = step.anchor === "open" ? d2(p.openedDay) : (serviceAt(p) || d2(p.openedDay));
  return new Date(sod(base) + step.off * DAY + 10 * 3600000);
}
function stepState(p, step) {
  if (p.done[step.id]) return "done";
  const due = sod(dueDate(p, step)), today = sod(now());
  if (due < today) return "late";
  if (due === today) return "due";
  return "ahead";
}
const attachedForms = (home) => home.forms.filter((f) => f.attached);
const answerOf = (p, f, k) => p.answers[f.id + "." + k] || "";
function formProgress(p, f) {
  const filled = f.fields.filter((x) => String(answerOf(p, f, x.k)).trim() !== "").length;
  return { filled: filled, total: f.fields.length };
}
function openFlagCount(p) {
  const home = homeById(p.homeId);
  return Object.keys(p.flags).filter((key) => {
    const parts = key.split(".");
    const form = home.forms.find((f) => f.id === parts[0]);
    if (!form || !form.attached) return false;
    return String(p.answers[key] || "").trim() === "";
  }).length;
}
function outstanding(p) {
  const home = homeById(p.homeId);
  const late = home.schedule.filter((s) => !s.event && stepState(p, s) === "late").length;
  return late + openFlagCount(p);
}

function toast(msg) {
  state.toast = msg;
  render();
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { state.toast = null; render(); }, 3000);
}

function applyAccent(hex) {
  const r = document.documentElement;
  r.style.setProperty("--accent", hex);
  r.style.setProperty("--accent-deep", "color-mix(in oklab," + hex + " 78%,black)");
  r.style.setProperty("--accent-wash", "color-mix(in oklab," + hex + " 11%,white)");
  r.style.setProperty("--accent-line", "color-mix(in oklab," + hex + " 34%,white)");
}
const crestMark = (h) => h.logo ? '<img src="' + esc(h.logo) + '" alt="">' : esc(h.initials);

/* ============================================================== sign-in === */

function viewDoor() {
  const h = state.doorHome ? homeById(state.doorHome) : null;
  if (h) applyAccent(h.accent);

  if (!h) {
    return banner("<b>This is the front of the whole platform.</b> One address for every home you sign up. A family picks their funeral home, then their person, and lands inside that home’s own branded page — they never see anybody else’s.") +
    '<div class="door-wrap">' +
      '<div class="door-hero">' +
        '<h1>Which funeral home is looking after them?</h1>' +
        '<p class="lede">Choose the home and you will see the people in their care. If you are planning your own funeral, choose the home first and then the last entry on the list.</p>' +
      '</div>' +
      '<div class="card card-pad">' +
        '<div class="eyebrow" style="margin-bottom:10px">Funeral homes on Holding Today</div>' +
        '<div class="homepick">' +
          state.homes.map((x) =>
            '<button class="homecard" data-act="door-home" data-id="' + x.id + '">' +
              '<span class="mk" style="background:' + esc(x.accent) + '">' + crestMark(x) + '</span>' +
              '<span><span class="k">' + esc(x.name) + '</span><br>' +
              '<span class="d">' + esc(x.city) + ', ' + esc(x.region) + ' &middot; ' + esc(x.phone) + '</span></span>' +
            '</button>').join("") +
        '</div>' +
        '<p class="tiny muted" style="margin-top:12px">Add a home in <b>Master</b> and it appears here immediately.</p>' +
      '</div>' +
    '</div>';
  }

  const dead = peopleOf(h.id).filter((p) => isDead(p) && p.status !== "archived");

  return banner("<b>" + esc(h.name) + "’s own page.</b> Their name, their colour, their telephone. A family who lands here has no idea there is a platform underneath it.") +
  '<div class="door-wrap">' +
    '<div class="door-hero">' +
      '<div class="crest">' +
        '<div class="mark">' + crestMark(h) + '</div>' +
        '<div><div class="nm">' + esc(h.name) + '</div>' +
        '<div class="ad">' + esc(h.line1) + ', ' + esc(h.city) + ' ' + esc(h.region) + ' &middot; ' + esc(h.phone) + '</div></div>' +
      '</div>' +
      '<h1>Find the person you are arranging for.</h1>' +
      '<p class="lede">Choose their name, then their date of birth. You will see only their arrangements — nothing about anybody else, and no account to create.</p>' +
      '<div class="row" style="margin-top:16px">' +
        '<button class="btn btn-sm" data-act="door-back">← A different funeral home</button>' +
        '<span class="tiny muted">24 hours: ' + esc(h.urgent) + '</span>' +
      '</div>' +
    '</div>' +

    '<div class="card card-pad">' +
      '<div class="eyebrow" style="margin-bottom:6px">In our care</div>' +
      '<div class="namelist">' +
        (dead.length ? dead.map((p) =>
          '<button class="namerow" data-act="door-pick" data-id="' + p.id + '">' +
            '<span><span class="who">' + esc(fullName(p)) + '</span><br>' +
            '<span class="sub">' + fmtFull(p.born) + ' – ' + fmtFull(d2(p.diedDay)) +
            (p.kind === "pre-need" ? ' &middot; <b>arranged it herself</b>'.replace("herself", p.first === "Thomas" ? "himself" : "herself") : "") +
            '</span></span><span class="go" aria-hidden="true">&rarr;</span>' +
          '</button>').join("")
          : '<p class="small muted" style="padding:12px 0">Nobody is in our care at the moment.</p>') +

        '<button class="namerow preplan" data-act="door-preplan">' +
          '<span><span class="who">I am planning ahead, for myself</span><br>' +
          '<span class="sub">Write down what you want, while you are here to be asked what you meant</span></span>' +
          '<span class="go" aria-hidden="true">&rarr;</span></button>' +
      '</div>' +
      (state.doorPick ? doorPassword() : '') +
    '</div>' +
  '</div>' +

  '<div class="foot-note"><b>About the date of birth.</b> It is what was asked for and it is the quickest thing to show, so the demonstration uses it. It should not ship that way: a date of birth is printed in the obituary, so anybody who read the notice could open the family’s file. What ships is a one-time link texted to the next of kin — the same two taps for them, and nothing guessable. There is more on this at the bottom of the Master screen.</div>';
}

function doorPassword() {
  const p = personById(state.doorPick);
  return '<hr class="rule" style="margin:16px 0">' +
  '<div class="stack" style="gap:12px">' +
    '<div><div class="eyebrow">Signing in for</div>' +
      '<div style="font-family:var(--serif);font-size:19px;font-weight:600">' + esc(fullName(p)) + '</div></div>' +
    '<div class="field"><label for="dobInput">' + (p.first === "Thomas" ? "His" : "Her") + ' date of birth</label>' +
      '<input id="dobInput" type="text" inputmode="numeric" placeholder="MM/DD/YYYY" value="' + esc(state.doorTyped) + '" data-act="dob-type" autocomplete="off"></div>' +
    (state.doorError ? '<div class="small" style="color:var(--late)">' + esc(state.doorError) + '</div>' : "") +
    '<button class="btn btn-primary btn-block" data-act="dob-submit">Open the arrangements</button>' +
    '<button class="btn btn-quiet btn-block btn-sm" data-act="dob-hint">Fill it in for me — it’s a demonstration</button>' +
  '</div>';
}

const banner = (html) => '<div class="banner"><div>' + html + '</div></div>';

/* =============================================================== family === */

const FAM_TABS = [
  ["hub", "Home"], ["timeline", "What’s due"], ["left", "Left for you"],
  ["photos", "Photographs"], ["forms", "Paperwork"], ["store", "Urns"],
  ["visits", "Visits"], ["messages", "Messages"], ["care", "Afterwards"]
];

function viewFamily() {
  const p = personById((state.session && state.session.personId) || "hale");
  const h = homeById(p.homeId);
  applyAccent(h.accent);

  const flags = openFlagCount(p);
  const hasLeft = p.videos.length || p.letters.length || p.sealed.length;
  const svc = serviceAt(p);

  const tabs = FAM_TABS.filter(([k]) => k !== "left" || hasLeft).map(([k, label]) => {
    const badge = (k === "forms" && flags) ? '<span class="badge">' + flags + '</span>'
      : (k === "left" && hasLeft) ? '<span class="badge" style="background:var(--seal)">' + (p.videos.length + p.letters.length + p.sealed.length) + '</span>'
      : (k === "care" && p.status === "closed" && p.aftercare === "pending") ? '<span class="badge">1</span>' : "";
    return '<button data-act="fam-tab" data-tab="' + k + '" aria-pressed="' + (state.familyTab === k) + '">' + label + badge + '</button>';
  }).join("");

  return banner("<b>The family’s side.</b> One link, no account, and only this one person behind it. Drawn at phone width because that is where every one of them opens it." +
      (p.kind === "pre-need" ? " <b>" + esc(p.first) + " arranged this himself</b> — watch what his family walks into." : "")) +
  '<div class="phone-stage">' +
    '<div class="phone">' +
      '<div class="phone-notch"><span></span></div>' +
      '<div>' +
        '<div class="fam-head">' +
          '<div class="home">' + esc(h.name) + '</div>' +
          '<h2>' + esc(shortName(p)) + '</h2>' +
          '<div class="dates">' + fmtFull(p.born) + ' – ' + fmtFull(d2(p.diedDay)) +
            (svc ? ' &nbsp;·&nbsp; ' + fmtDay(svc) + ', ' + fmtTime(svc) : "") + '</div>' +
        '</div>' +
        '<div class="fam-tabs">' + tabs + '</div>' +
        '<div class="fam-pane">' + famPane(p, h) + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="sidenote">' + famSide(p) + '</div>' +
  '</div>';
}

function famPane(p, h) {
  switch (state.familyTab) {
    case "timeline": return famTimeline(p, h);
    case "left":     return famLeft(p, h);
    case "photos":   return famPhotos(p);
    case "forms":    return famForms(p, h);
    case "store":    return famStore(p, h);
    case "visits":   return famVisits(p, h);
    case "messages": return famMessages(p, h);
    case "care":     return famCare(p, h);
    default:         return famHub(p, h);
  }
}

function famHub(p, h) {
  const steps = h.schedule.filter((s) => !s.event);
  const doneN = steps.filter((s) => p.done[s.id]).length;
  const pending = steps.filter((s) => !p.done[s.id]).sort((a, b) => dueDate(p, a) - dueDate(p, b));
  const flags = openFlagCount(p);
  const svc = serviceAt(p);
  const toSvc = svc ? Math.round((sod(svc) - sod(now())) / DAY) : null;
  const hasLeft = p.videos.length || p.letters.length || p.sealed.length;

  return '<div class="stack" style="gap:6px">' +
      '<div class="eyebrow">Where things stand</div>' +
      '<div class="meter" role="img" aria-label="' + doneN + ' of ' + steps.length + ' finished"><i style="width:' + Math.round(doneN / Math.max(1, steps.length) * 100) + '%"></i></div>' +
      '<div class="tiny muted mono">' + doneN + ' of ' + steps.length + ' finished</div>' +
    '</div>' +

    (hasLeft ? '<button class="card card-pad" style="text-align:left;cursor:pointer;width:100%;background:var(--seal-wash);border-color:color-mix(in oklab,var(--seal) 32%,transparent)" data-act="fam-tab" data-tab="left">' +
      '<div class="eyebrow" style="color:var(--seal)">' + esc(p.first) + ' left things for you</div>' +
      '<div style="font-size:13.5px;margin-top:4px">' + p.videos.length + ' recording' + (p.videos.length === 1 ? "" : "s") + ', ' +
        p.letters.length + ' letter' + (p.letters.length === 1 ? "" : "s") + ', and ' + p.sealed.length +
        ' sealed note' + (p.sealed.length === 1 ? "" : "s") + ' addressed to particular people.</div></button>' : "") +

    (svc ? '<div class="card card-pad"' + (toSvc >= 0 ? ' style="background:var(--accent-wash);border-color:var(--accent-line)"' : "") + '>' +
      '<div class="eyebrow">The service</div>' +
      '<div style="font-family:var(--serif);font-size:19px;font-weight:600;margin-top:3px">' + fmtDay(svc) + '</div>' +
      '<div class="mono small">' + fmtTime(svc) + ' &middot; ' + esc(p.serviceWhere) + ' &middot; ' +
        (toSvc > 0 ? toSvc + " days away" : toSvc === 0 ? "today" : "held " + Math.abs(toSvc) + " days ago") + '</div>' +
    '</div>' : "") +

    (flags ? '<button class="card card-pad" style="text-align:left;cursor:pointer;width:100%;background:var(--late-wash);border-color:color-mix(in oklab,var(--late) 30%,transparent)" data-act="fam-tab" data-tab="forms">' +
      '<div class="eyebrow" style="color:var(--late)">' + flags + ' thing' + (flags > 1 ? "s" : "") + ' sent back to you</div>' +
      '<div style="font-size:13.5px;margin-top:4px">' + esc(h.director) + ' has marked what she still needs, and why. Tap to go straight to the boxes.</div></button>' : "") +

    (pending.length ? '<div><div class="eyebrow" style="margin-bottom:7px">Next thing due</div>' +
      '<div class="tl"><div class="tl-item">' + tlRow(p, pending[0]) + '</div></div></div>'
      : '<div class="card card-pad" style="background:var(--done-wash);border-color:color-mix(in oklab,var(--done) 30%,transparent)">' +
        '<div style="font-size:13.5px">Everything we asked you for is in. There is nothing you need to do.</div></div>') +

    '<hr class="rule">' +
    '<div class="stack" style="gap:9px">' +
      '<div class="eyebrow">If you need us</div>' +
      '<div class="row" style="gap:8px">' +
        '<a class="btn btn-sm" href="tel:' + esc(h.phone.replace(/\D/g, "")) + '">Call ' + esc(h.phone) + '</a>' +
        '<button class="btn btn-sm" data-act="fam-tab" data-tab="messages">Send a message</button>' +
      '</div>' +
      '<div class="tiny muted">Office hours ' + esc(h.opens) + '–' + esc(h.closes) + '. Outside them, ' + esc(h.urgent) + ' reaches a person, not a machine.</div>' +
    '</div>';
}

function tlRow(p, step) {
  const st = stepState(p, step);
  const due = dueDate(p, step);
  const svc = serviceAt(p);
  const pill = st === "done" ? '<span class="pill pill-done">Done</span>'
    : st === "late" ? '<span class="pill pill-late">Overdue</span>'
    : st === "due" ? '<span class="pill pill-due">Today</span>' : "";
  return '<button class="tl-check" data-act="toggle-step" data-id="' + step.id + '" data-done="' + (p.done[step.id] ? 1 : 0) + '"' +
      (step.event ? " disabled" : "") + ' aria-label="Mark ' + esc(step.title) + ' done">' + (p.done[step.id] ? "✓" : "") + '</button>' +
    '<div class="tl-body">' +
      '<div class="tl-title' + (step.event ? " is-event" : "") + '">' + esc(step.title) + '</div>' +
      (step.desc ? '<div class="tl-desc">' + esc(step.desc) + '</div>' : "") +
      '<div class="tl-when"><span>' + fmtDay(due) + (step.event && svc ? ", " + fmtTime(svc) : "") + '</span>' + pill + '</div>' +
    '</div>';
}

function famTimeline(p, h) {
  return '<h3>What we need, and when</h3>' +
    '<p class="small muted">' + esc(h.director) + ' set these dates. Tick a thing off when you have done it — she sees it straight away and stops chasing you.</p>' +
    '<div class="tl">' + h.schedule.slice().sort((a, b) => dueDate(p, a) - dueDate(p, b))
      .map((s) => '<div class="tl-item ' + (p.done[s.id] ? "done" : "") + '">' + tlRow(p, s) + '</div>').join("") + '</div>';
}

function famLeft(p, h) {
  return '<h3>What ' + esc(p.first) + ' left</h3>' +
    '<p class="small muted">Recorded and written by him, before he died, and held here until now. ' + esc(h.name) + ' has never watched or read any of it.</p>' +

    (p.videos.length ? '<div class="stack" style="gap:12px">' +
      '<div class="eyebrow">Recordings</div>' +
      p.videos.map((v) => '<div class="vid">' +
        '<div class="screen" style="background:linear-gradient(150deg,hsl(' + v.tone + ' 18% 28%),hsl(' + ((v.tone + 30) % 360) + ' 20% 12%))">' +
          '<span class="grain" aria-hidden="true"></span>' +
          '<button class="play" data-act="play" data-id="' + v.id + '" aria-label="Play ' + esc(v.title) + '">▶</button>' +
          '<span class="len mono">' + esc(v.mins) + '</span>' +
        '</div>' +
        '<div class="vm"><div class="vt">' + esc(v.title) + '</div>' +
          '<div class="vs">For ' + esc(v.forWhom) + ' &middot; recorded ' + fmtFull(d2(v.day)) + '</div></div>' +
        '<div class="transcript"><span class="eyebrow">What he says</span><br>' + esc(v.transcript) + '</div>' +
      '</div>').join("") + '</div>' : "") +

    (p.letters.length ? '<div class="stack" style="gap:14px">' +
      '<div class="eyebrow">In writing, for everybody</div>' +
      p.letters.map((l) => '<div class="penned"><div class="pt">' + esc(l.title) + '</div>' +
        '<div class="pb">' + l.body.map((x) => "<p>" + esc(x) + "</p>").join("") + '</div>' +
        '<div class="tiny muted mono" style="margin-top:7px">Written ' + fmtFull(d2(l.day)) + '</div></div>').join("") + '</div>' : "") +

    (p.sealed.length ? '<div class="stack" style="gap:12px">' +
      '<div class="eyebrow" style="color:var(--seal)">Sealed — one person each</div>' +
      '<p class="small muted">These are addressed to one person and nobody else, including ' + esc(h.name) + ' and including whoever is holding this phone. Each one opens with a word only that person and ' + esc(p.first) + ' would know.</p>' +
      p.sealed.map((z) => sealedCard(p, z)).join("") + '</div>' : "");
}

function sealedCard(p, z) {
  const open = state.openSealed[z.id];
  return '<div class="sealed">' +
    '<div class="sh"><span class="pill pill-seal">' + (open ? "Open" : "Sealed") + '</span>' +
      '<span><span class="sw">For ' + esc(z.forWhom) + '</span> ' +
      '<span class="sr">' + esc(z.rel.toLowerCase()) + '</span></span></div>' +
    (open
      ? '<div class="letterbody">' + z.body.map((x) => "<p>" + esc(x) + "</p>").join("") +
        '</div><div class="tiny muted" style="margin-top:8px">Opened on this phone only. Closing the page seals it again.</div>'
      : '<div class="hint">The word is: <b>' + esc(z.hint) + '</b></div>' +
        '<div class="open">' +
          '<input type="text" placeholder="One word" value="' + esc(state.sealTry[z.id] || "") + '" data-act="seal-type" data-id="' + z.id + '" autocomplete="off" aria-label="Word for ' + esc(z.forWhom) + '">' +
          '<button class="btn btn-primary btn-sm" data-act="seal-open" data-id="' + z.id + '">Open it</button>' +
        '</div>' +
        (state.sealErr[z.id] ? '<div class="small" style="color:var(--late);margin-top:7px">That is not the word. There is no way to reset it and no one to ask — not the funeral home, not us.</div>' : "") +
        '<button class="btn btn-quiet btn-sm" style="margin-top:6px" data-act="seal-hint" data-id="' + z.id + '">Show me the answer — it’s a demonstration</button>') +
  '</div>';
}

function famPhotos(p) {
  const sel = p.photos.filter((x) => x.sel).sort((a, b) => a.pos - b.pos);
  const bin = p.photos.filter((x) => !x.sel);
  return '<h3>Photographs</h3>' +
    '<p class="small muted">Send whatever you have. Blurry, cropped, straight off a phone — we would rather have forty and choose, than have you pick before you send.</p>' +
    '<div><div class="eyebrow" style="margin-bottom:7px">In the slideshow, in this order — ' + sel.length + '</div>' +
      '<div class="photos">' + (sel.length ? sel.map((x, i) =>
        '<button class="ph" data-sel="1" data-act="toggle-photo" data-id="' + x.id + '" style="' + swatch(x.tone) + '">' +
        '<span class="num">' + (i + 1) + '</span><span class="cap">' + esc(x.label) + '</span></button>').join("")
        : '<p class="small muted">None chosen yet.</p>') + '</div></div>' +
    '<div><div class="eyebrow" style="margin-bottom:7px">Everything else you sent — ' + bin.length + '</div>' +
      '<div class="photos">' +
        '<button class="ph-add" data-act="add-photo"><span style="font-size:17px">+</span><span>Add photos</span></button>' +
        bin.map((x) => '<button class="ph" data-sel="0" data-act="toggle-photo" data-id="' + x.id + '" style="' + swatch(x.tone) + '">' +
          '<span class="cap">' + esc(x.label) + '</span></button>').join("") + '</div>' +
      '<p class="tiny muted" style="margin-top:8px">Tap one to move it in or out of the slideshow. Nothing you send is ever deleted — leaving a photograph out keeps it here.</p></div>';
}

function famForms(p, h) {
  const forms = attachedForms(h);
  const preAnswered = forms.reduce((n, f) => n + f.fields.filter((x) => p.answeredBy[f.id + "." + x.k] === "self").length, 0);
  return '<h3>Paperwork</h3>' +
    (preAnswered
      ? '<div class="card card-pad" style="background:var(--accent-wash);border-color:var(--accent-line)">' +
        '<div class="eyebrow">' + preAnswered + ' answers are already here</div>' +
        '<div style="font-size:13.5px;margin-top:4px">' + esc(p.first) + ' filled these in himself when he arranged all this. They are marked so you can see which are his. You only have to do what is left.</div></div>'
      : '<p class="small muted">Fill these in here, on your phone. Nothing to print, nothing to scan, and you can leave a box and come back to it.</p>') +
    forms.map((f) => {
      const pr = formProgress(p, f);
      return '<div class="formdoc">' +
        '<div class="formdoc-head"><div><h4>' + esc(f.name) + '</h4>' +
          '<div class="org">' + esc(h.name.toUpperCase()) + ' &middot; ' + esc(f.note) + '</div></div>' +
          '<span class="pill ' + (pr.filled === pr.total ? "pill-done" : "pill-quiet") + '">' + pr.filled + '/' + pr.total + '</span></div>' +
        '<div class="formdoc-fields">' + f.fields.map((x) => famField(p, f, x)).join("") + '</div></div>';
    }).join("") +
    '<button class="btn btn-block" data-act="say-pdf">Save these as a PDF</button>' +
    '<p class="tiny muted">Saved as you type. ' + esc(h.director) + ' sees each box the moment you fill it.</p>';
}

function famField(p, f, x) {
  const key = f.id + "." + x.k;
  const val = p.answers[key] || "";
  const flag = p.flags[key];
  const empty = String(val).trim() === "";
  const showFlag = flag && empty;
  const bySelf = p.answeredBy[key] === "self" && !empty;
  const id = "ff_" + key.replace(/\W/g, "_");

  let control;
  if (x.type === "textarea") {
    control = '<textarea id="' + id + '" data-act="form-field" data-form="' + f.id + '" data-key="' + x.k + '">' + esc(val) + '</textarea>';
  } else if (x.type === "select") {
    control = '<select id="' + id + '" data-act="form-field" data-form="' + f.id + '" data-key="' + x.k + '">' +
      x.opts.map((o) => '<option value="' + esc(o) + '"' + (o === val ? " selected" : "") + '>' + (o === "" ? "—" : esc(o)) + '</option>').join("") + '</select>';
  } else {
    control = '<input id="' + id + '" type="' + (x.type === "date" ? "date" : "text") + '" value="' + esc(val) + '" data-act="form-field" data-form="' + f.id + '" data-key="' + x.k + '">';
  }

  return '<div class="ff' + (showFlag ? " flagged" : bySelf ? " prefilled" : "") + '">' +
    '<label class="ff-label" for="' + id + '">' + esc(x.label) +
      (showFlag ? '<span class="pill pill-late">Sent back</span>' : "") +
      (bySelf ? '<span class="pill pill-accent">' + esc(p.first) + '’s own answer</span>' : "") + '</label>' +
    control +
    (showFlag ? '<div class="ff-note bad"><b>' + esc(homeById(p.homeId).director) + ':</b><span>' + esc(flag) + '</span></div>' : "") +
    (bySelf ? '<div class="ff-note good"><span>Answered by him on ' + fmtFull(d2(p.planStartDay || 0)) + '. You can change it if it is wrong.</span></div>' : "") +
  '</div>';
}

function famStore(p, h) {
  const chosen = h.inventory.filter((i) => p.chosen[i.id]);
  const total = chosen.reduce((s, i) => s + i.price, 0);
  const plot = p.plot ? h.plots.find((g) => g.id === p.plot) : null;
  const byHim = p.kind === "pre-need";

  return '<h3>Urns, caskets and stationery</h3>' +
    (byHim
      ? '<div class="card card-pad" style="background:var(--accent-wash);border-color:var(--accent-line)">' +
        '<div class="eyebrow">Already chosen</div>' +
        '<div style="font-size:13.5px;margin-top:4px">' + esc(p.first) + ' picked these himself. You do not have to decide anything here — and you may change any of it if you want to.</div></div>'
      : '<p class="small muted">These are ' + esc(h.name) + '’s own, at their own prices. Choosing here only tells ' + esc(h.director) + ' what you are thinking; nothing is charged and nothing is ordered until you have spoken.</p>') +

    (plot ? '<div class="card card-pad"><div class="eyebrow">Resting place</div>' +
      '<div style="font-family:var(--serif);font-size:17px;font-weight:600;margin-top:3px">' + esc(plot.section) + ' &middot; <span class="mono">' + esc(plot.no) + '</span></div>' +
      '<div class="small muted">' + esc(plot.desc) + ' &middot; ' + esc(h.cemetery) + '</div>' +
      '<div class="mono small" style="margin-top:5px">' + money(plot.price) + (byHim ? " — paid" : "") + '</div></div>' : "") +

    '<div class="shelf">' + h.inventory.map((i) =>
      '<div class="item" data-chosen="' + (p.chosen[i.id] ? 1 : 0) + '">' +
        '<div class="swatch" style="' + swatch((i.price * 7) % 360) + '" aria-hidden="true">' + i.glyph + '</div>' +
        '<div class="meta"><span class="pill pill-quiet" style="align-self:flex-start">' + esc(i.kind) + '</span>' +
          '<div class="nm">' + esc(i.name) + '</div><div class="dsc">' + esc(i.desc) + '</div>' +
          '<div class="pr">' + money(i.price) + '</div>' +
          '<div class="foot"><button class="btn btn-sm btn-block' + (p.chosen[i.id] ? "" : " btn-primary") + '" data-act="choose-item" data-id="' + i.id + '">' +
            (p.chosen[i.id] ? "Chosen — remove" : "Choose this") + '</button></div></div></div>').join("") + '</div>' +

    (chosen.length ? '<div class="card card-pad"><div class="eyebrow">Marked</div>' +
      chosen.map((i) => '<div class="kv-row"><div class="k">' + esc(i.kind) + '</div><div class="v">' + esc(i.name) +
        ' <span class="mono muted">' + money(i.price) + '</span></div></div>').join("") +
      '<div class="row" style="margin-top:10px"><b class="mono">' + money(total + (plot ? plot.price : 0)) + '</b>' +
      '<span class="tiny muted">before tax, not a quote</span></div></div>' : "") +

    '<p class="tiny muted">You are free to buy an urn or a casket anywhere you like and bring it to us. The FTC Funeral Rule says so, and we may not charge you a fee for handling it.</p>';
}

function famVisits(p, h) {
  const mine = h.slots.filter((s) => s.taken === p.id);
  const open = h.slots.filter((s) => !s.taken);
  return '<h3>Coming in</h3>' +
    '<p class="small muted">Times ' + esc(h.director) + ' has open. Take whichever you need — you do not have to ring to book one.</p>' +
    (mine.length ? '<div><div class="eyebrow" style="margin-bottom:7px">Yours</div><div class="slots">' + mine.map((s) => slotRow(s, true)).join("") + '</div></div>' : "") +
    '<div><div class="eyebrow" style="margin-bottom:7px">Open</div>' +
      (open.length ? '<div class="slots">' + open.map((s) => slotRow(s, false)).join("") + '</div>'
        : '<p class="small muted">Nothing open at the moment. Send a message and she will make time.</p>') + '</div>';
}
function slotRow(s, taken) {
  return '<button class="slot" data-taken="' + (taken ? 1 : 0) + '" data-act="take-slot" data-id="' + s.id + '">' +
    '<span><span class="w">' + fmtShort(d2(s.day)) + ' &middot; ' + esc(s.time) + '</span><br>' +
    '<span class="k">' + esc(s.what) + ' &middot; ' + s.mins + ' min</span></span>' +
    '<span class="spacer">' + (taken ? '<span class="pill pill-done">Booked</span>' : '<span class="pill pill-accent">Take it</span>') + '</span></button>';
}

function famMessages(p, h) {
  const visible = p.messages.filter((m) => m.at <= state.day);
  return '<h3>Messages</h3>' +
    '<div class="hours-note">Everyone in your family sees this same thread, so nobody has to relay anything. Sent now, it will be read when the office opens at ' + esc(h.opens) + '. If it cannot wait, ring ' + esc(h.urgent) + '.</div>' +
    '<div class="thread">' + visible.map((m) => {
      const at = d2(m.at);
      return '<div class="msg ' + (m.who === "home" ? "msg-home" : "msg-fam") + '">' +
        '<div class="from">' + (m.who === "home" ? esc(h.director) + ", " + esc(h.name) : esc(p.nok)) + '</div>' + esc(m.body) +
        '<div class="msg-time">' + fmtShort(at) + ", " + fmtTime(at) + '</div></div>';
    }).join("") + '</div>' +
    '<div class="field"><label for="famMsg">Write to ' + esc(h.director) + '</label>' +
      '<textarea id="famMsg" placeholder="Ask anything. No question is too small."></textarea></div>' +
    '<button class="btn btn-primary btn-block" data-act="fam-send">Send</button>';
}

const CARE_LETTERS = [
  { at: 30, subject: "Thinking of you", body: (n) => [
    "It has been a month since " + n + "’s service.",
    "This is often the point when the cards stop arriving and everyone else goes back to their week, which can make it a harder month rather than an easier one. If today is a bad day, that is not a sign anything is going wrong.",
    "There is nothing you need to do with this message."] },
  { at: 60, subject: "Two months on", body: (n) => [
    "Two months since " + n + "’s service.",
    "Grief is not a line that goes steadily down. A good fortnight followed by a week where you cannot function is the ordinary shape of it, not a setback.",
    "If you would like to talk to someone, we can point you to people locally."] },
  { at: 90, subject: "Three months on", body: (n) => [
    "Three months since " + n + "’s service.",
    "Some people find this is when the practical work finally stops and the loss itself gets louder. If that is where you are, you are not behind.",
    "We are still here, and you are welcome to call."] },
  { at: 365, subject: "A year today", body: (n) => [
    "A year today since " + n + "’s service.",
    "Anniversaries are often heavier than the day itself, partly because most people no longer know the date. We do.",
    "Thinking of you and your family today."] }
];

function famCare(p, h) {
  const svc = serviceAt(p);
  if (p.status !== "closed") {
    return '<h3>Afterwards</h3><div class="card card-pad"><p class="small muted">Nothing here yet. When ' + esc(h.director) +
      ' closes the file she will ask whether you would like to hear from her again over the coming year. In the <b>Director</b> view, press <b>Close the case</b> — or move the marker to <b>Day 19</b>.</p></div>';
  }
  if (p.aftercare === "pending") {
    return '<h3>Afterwards</h3><div class="consent">' +
      '<div class="eyebrow">A question, and a real one</div>' +
      '<p style="margin-top:7px;font-size:13.5px;line-height:1.6">Some families want to hear from us again. Others would rather close the door, and that is an entirely reasonable thing to want. If you say yes, ' + esc(h.name) + ' will write to you on these four days and no others:</p>' +
      '<div class="kv" style="margin-top:11px">' + CARE_LETTERS.map((l) =>
        '<div class="kv-row"><div class="k">' + (l.at === 365 ? "1 year" : l.at + " days") + '</div>' +
        '<div class="v mono small">' + fmtFull(new Date(svc.getTime() + l.at * DAY)) + '</div></div>').join("") + '</div>' +
      '<div class="choices"><button class="btn btn-primary" data-act="care-yes">Yes, write to me</button>' +
        '<button class="btn" data-act="care-no">No, thank you</button></div>' +
      '<p class="tiny muted" style="margin-top:9px">No is final. We will not ask again, and nothing else changes.</p></div>';
  }
  if (p.aftercare === "declined") {
    return '<h3>Afterwards</h3><div class="card card-pad"><p class="small">You asked us not to write, and we will not. Nothing else about the file changes.</p>' +
      '<button class="btn btn-sm btn-quiet" style="margin-top:8px" data-act="care-reset">Undo (demonstration only)</button></div>';
  }
  const since = state.day - p.serviceDay;
  return '<h3>Afterwards</h3>' +
    '<p class="small muted">Four letters from ' + esc(h.director) + ', signed in the home’s name. Sent and then left alone — nothing to reply to, nothing to unsubscribe from twice.</p>' +
    '<div class="stack" style="gap:12px">' + CARE_LETTERS.map((l) => {
      const sent = since >= l.at;
      const on = new Date(svc.getTime() + l.at * DAY);
      return '<div class="letter" data-state="' + (sent ? "sent" : "future") + '">' +
        '<div class="lh"><span class="lt mono">' + (l.at === 365 ? "1 YEAR" : l.at + " DAYS") + '</span>' +
          '<span class="small" style="font-weight:600">' + esc(l.subject) + '</span>' +
          '<span class="spacer">' + (sent ? '<span class="pill pill-done">Sent ' + fmtShort(on) + '</span>'
            : '<span class="pill pill-quiet">' + fmtShort(on) + '</span>') + '</span></div>' +
        '<div class="lb">' + l.body(p.first).map((x) => "<p>" + esc(x) + "</p>").join("") +
          '<div class="sig">— ' + esc(h.director) + ', ' + esc(h.name) + '</div></div></div>';
    }).join("") + '</div>' +
    '<p class="tiny muted">Jump the marker to <b>+30</b>, <b>+60</b>, <b>+90</b> and <b>+1 year</b> to watch these arrive.</p>';
}

function famSide(p) {
  const notes = {
    hub: ["The first screen", "A grieving family opens this on a phone, once, at eleven at night. So it answers only the two questions they actually have: <b>when is it</b>, and <b>what do you need from me next</b>. Everything else is a tap away and nothing shouts."],
    timeline: ["Dates the home chose", "Not our dates. The home writes its schedule once and every case inherits it — some steps counted back from the service, some counted forward from the day the file opened. Move the funeral and every unfinished step moves with it."],
    left: ["The part that only pre-planning can do", "A family who opens this is not filling in forms, they are hearing from him. The recordings and the open letters are for everyone. The <b>sealed</b> ones are the hard part and are worth reading the note about on the Master screen — they are addressed to one person, and nobody else can open them, including you."],
    photos: ["Why the bin is so big", "A family genuinely has a thousand photographs, and asking them to pick fifty before they upload is where they give up and email forty attachments from six addresses instead. Send everything, choose later, and the pack comes out numbered with the captions in a text file."],
    forms: ["Your forms, their phone", "You upload your paperwork once and it becomes boxes a family fills on the sofa. Where they leave one empty you can mark it and say why, and it lands in front of them exactly at the blank. Where the person pre-planned, their own answers are already in and labelled as theirs."],
    store: ["Your merchandise, your margin", "Your urn room and your cemetery, at your prices, and the money is yours. We never touch the transaction — the point is a family browsing on the sofa instead of in a windowless selection room."],
    visits: ["Stop playing telephone", "You open windows when you have them. The family takes what it needs. Nobody rings the office three times to settle on Thursday at four."],
    messages: ["One thread, whole family", "Every relative sees the same conversation, so “who told you that?” settles itself and you answer once. A two in the morning message is <b>delivered</b> at two in the morning — we just say, before they send, when it will be read, and put the 24-hour number beside it."],
    care: ["The part they remember", "This is what brings the next family. Four letters over a year, in your name, costing your staff nothing — and it starts only after a plain question with a no of equal size next to it."]
  };
  const n = notes[state.familyTab] || notes.hub;
  return '<div><h4>' + n[0] + '</h4><div class="note" style="margin-top:8px">' + n[1] + '</div></div>' +
    '<div class="note"><b>Showing this to a director?</b> Move the marker at the top. The whole case moves with it — deadlines go overdue, the service happens, the file closes, the check-ins go out.</div>' +
    '<div class="row"><button class="btn btn-sm" data-act="sign-out">Sign out</button>' +
    '<button class="btn btn-sm" data-act="goto-director">Open the director’s side</button></div>';
}

/* ============================================================= planning === */

const PLAN_STEPS = [
  ["who",     "Who you are",      "Vital Statistics Worksheet", "The facts a death certificate needs. Nobody who loves you will know all of these."],
  ["service", "What kind of day",  "Obituary Information", "What is said, and what is not."],
  ["where",   "Where you go",      null, "A plot, a niche, a hillside — or your own arrangements entirely."],
  ["look",    "How you look",      "Personal Care Wishes", "Hair, clothes, glasses on or off. People agonise over this. You can just say."],
  ["things",  "What you choose",   null, "The casket or urn, the register book, the cards."],
  ["leave",   "What you leave",    null, "Recordings, open letters, and sealed notes for one person each."],
  ["done",    "When the time comes", null, "What your family walks into."]
];

function viewPlan() {
  const p = personById("pryor");
  const h = homeById(p.homeId);
  applyAccent(h.accent);

  const stepDone = {
    who: formFilledFor(p, h, "Vital"), service: formFilledFor(p, h, "Obituary"),
    where: !!p.plot, look: formFilledFor(p, h, "Personal Care"),
    things: Object.keys(p.chosen).length > 0,
    leave: (p.videos.length + p.letters.length + p.sealed.length) > 0,
    done: isDead(p)
  };

  return banner("<b>Pre-planning, three years before he dies.</b> Thomas Pryor picked " + esc(h.name) + " off the list and chose the last entry instead of a name. Everything he does here is waiting in his file on the day he dies.") +
  '<div class="pp-stage">' +
    '<div class="pp-steps">' +
      PLAN_STEPS.map(([k, label, , sub], i) =>
        '<button class="pp-step" data-act="plan-step" data-k="' + k + '" aria-current="' + (state.planStep === k) + '" data-done="' + (stepDone[k] ? 1 : 0) + '">' +
          '<span class="dotn">' + (stepDone[k] ? "✓" : i + 1) + '</span>' +
          '<span><span class="lbl">' + esc(label) + '</span><br><span class="sub">' + esc(sub.slice(0, 44)) + (sub.length > 44 ? "…" : "") + '</span></span>' +
        '</button>').join("") +
      '<div class="card card-pad" style="margin-top:14px">' +
        '<div class="eyebrow">Your funeral home</div>' +
        '<div style="font-weight:700;font-size:14px;margin-top:3px">' + esc(h.name) + '</div>' +
        '<div class="tiny muted">' + esc(h.director) + ' &middot; ' + esc(h.phone) + '</div>' +
      '</div>' +
    '</div>' +
    '<div>' + planPane(p, h) + '</div>' +
  '</div>';
}

function formFilledFor(p, h, nameStart) {
  const f = h.forms.find((x) => x.name.indexOf(nameStart) === 0);
  if (!f) return false;
  return formProgress(p, f).filled > 0;
}

function planPane(p, h) {
  const meta = PLAN_STEPS.find(([k]) => k === state.planStep) || PLAN_STEPS[0];
  const head = '<div class="pp-head"><div class="eyebrow">Planning ahead</div>' +
    '<h2>' + esc(meta[1]) + '</h2><p class="small muted" style="margin-top:6px;max-width:60ch">' + esc(meta[3]) + '</p></div>';

  if (meta[2]) return head + planForm(p, h, meta[2]);
  if (state.planStep === "where")  return head + planWhere(p, h);
  if (state.planStep === "things") return head + planThings(p, h);
  if (state.planStep === "leave")  return head + planLeave(p, h);
  return head + planDone(p, h);
}

function planForm(p, h, nameStart) {
  const f = h.forms.find((x) => x.name.indexOf(nameStart) === 0);
  if (!f) return '<div class="card card-pad"><p class="small muted">' + esc(h.name) + ' has not put this form in their library. Add it in <b>Master</b>.</p></div>';
  return '<div class="formdoc">' +
    '<div class="formdoc-head"><div><h4>' + esc(f.name) + '</h4>' +
      '<div class="org">' + esc(h.name.toUpperCase()) + ' &middot; ' + esc(f.note) + '</div></div>' +
      '<span class="pill pill-accent">Answering for yourself</span></div>' +
    '<div class="formdoc-fields">' + f.fields.map((x) => {
      const key = f.id + "." + x.k, val = p.answers[key] || "", id = "pp_" + key.replace(/\W/g, "_");
      let control;
      if (x.type === "textarea") control = '<textarea id="' + id + '" data-act="plan-field" data-form="' + f.id + '" data-key="' + x.k + '">' + esc(val) + '</textarea>';
      else if (x.type === "select") control = '<select id="' + id + '" data-act="plan-field" data-form="' + f.id + '" data-key="' + x.k + '">' +
        x.opts.map((o) => '<option value="' + esc(o) + '"' + (o === val ? " selected" : "") + '>' + (o === "" ? "—" : esc(o)) + '</option>').join("") + '</select>';
      else control = '<input id="' + id + '" type="' + (x.type === "date" ? "date" : "text") + '" value="' + esc(val) + '" data-act="plan-field" data-form="' + f.id + '" data-key="' + x.k + '">';
      return '<div class="ff"><label class="ff-label" for="' + id + '">' + esc(x.label) + '</label>' + control + '</div>';
    }).join("") + '</div></div>' +
    '<p class="small muted" style="margin-top:12px">Every one of these boxes is one your family would otherwise be asked, three days after you die, by somebody with a clipboard. They are already in your file.</p>';
}

function planWhere(p, h) {
  return '<div class="card card-pad">' +
    '<div class="sectitle"><h3>' + esc(h.cemetery) + '</h3><span class="hint">' + esc(h.name) + '’s own ground</span></div>' +
    '<div class="scroller"><table class="tbl"><thead><tr><th>Section</th><th>Plot</th><th>What it is</th><th style="text-align:right">Price</th><th></th></tr></thead><tbody>' +
      h.plots.map((g) => '<tr>' +
        '<td><b>' + esc(g.section) + '</b><br><span class="tiny muted">' + esc(g.desc) + '</span></td>' +
        '<td class="mono">' + esc(g.no) + '</td><td class="tiny">' + esc(g.kind) + '</td>' +
        '<td class="mono" style="text-align:right">' + money(g.price) + '</td>' +
        '<td>' + (p.plot === g.id
          ? '<button class="btn btn-sm" data-act="pick-plot" data-id="">Chosen — release</button>'
          : '<button class="btn btn-sm btn-primary" data-act="pick-plot" data-id="' + g.id + '">Take it</button>') + '</td></tr>').join("") +
    '</tbody></table></div></div>' +
    '<div class="card card-pad" style="margin-top:14px">' +
      '<div class="sectitle"><h3>Or your own arrangements</h3></div>' +
      '<div class="field"><label for="ownPlot">Somewhere else, or scattered</label>' +
        '<textarea id="ownPlot" data-act="own-plot" placeholder="The family plot at Sterling, next to Eileen. Deed is in the green folder.">' + esc(p.ownPlot || "") + '</textarea></div>' +
      '<p class="tiny muted" style="margin-top:8px">A funeral home has to take you at your word here and has no business talking you out of it.</p>' +
    '</div>';
}

function planThings(p, h) {
  return '<div class="shelf">' + h.inventory.map((i) =>
    '<div class="item" data-chosen="' + (p.chosen[i.id] ? 1 : 0) + '">' +
      '<div class="swatch" style="' + swatch((i.price * 7) % 360) + '" aria-hidden="true">' + i.glyph + '</div>' +
      '<div class="meta"><span class="pill pill-quiet" style="align-self:flex-start">' + esc(i.kind) + '</span>' +
        '<div class="nm">' + esc(i.name) + '</div><div class="dsc">' + esc(i.desc) + '</div>' +
        '<div class="pr">' + money(i.price) + '</div>' +
        '<div class="foot"><button class="btn btn-sm btn-block' + (p.chosen[i.id] ? "" : " btn-primary") + '" data-act="choose-item" data-id="' + i.id + '">' +
          (p.chosen[i.id] ? "Chosen — remove" : "Choose this") + '</button></div></div></div>').join("") + '</div>' +
    '<p class="small muted" style="margin-top:12px">Choosing here is not buying. It tells ' + esc(h.director) + ' what you want, and she will tell you what it costs to lock the price in now rather than at the time — which is a conversation with a person, not a checkout.</p>';
}

function planLeave(p, h) {
  return '<div class="card card-pad">' +
    '<div class="sectitle"><h3>Recordings</h3><span class="hint">Your voice, which nobody can reconstruct later</span></div>' +
    '<div class="grid2">' + p.videos.map((v) =>
      '<div class="vid"><div class="screen" style="background:linear-gradient(150deg,hsl(' + v.tone + ' 18% 28%),hsl(' + ((v.tone + 30) % 360) + ' 20% 12%))">' +
        '<span class="grain" aria-hidden="true"></span><button class="play" data-act="play" data-id="' + v.id + '" aria-label="Play">▶</button>' +
        '<span class="len mono">' + esc(v.mins) + '</span></div>' +
      '<div class="vm"><div class="vt">' + esc(v.title) + '</div><div class="vs">For ' + esc(v.forWhom) + '</div></div></div>').join("") + '</div>' +
    '<label class="dropzone" style="margin-top:12px"><b>Record something, or upload one</b>Two minutes of you talking is worth more than anything on this screen.' +
      '<input type="file" hidden data-act="upload-video" accept="video/*"></label>' +
  '</div>' +

  '<div class="card card-pad" style="margin-top:14px">' +
    '<div class="sectitle"><h3>Open letters</h3><span class="hint">Everyone who opens your file will read these</span></div>' +
    p.letters.map((l) => '<div class="penned" style="margin-bottom:14px"><div class="pt">' + esc(l.title) + '</div>' +
      '<div class="pb">' + l.body.map((x) => "<p>" + esc(x) + "</p>").join("") + '</div></div>').join("") +
    '<div class="grid2"><div class="field"><label for="letTitle">What it is about</label>' +
      '<input id="letTitle" type="text" placeholder="About the house"></div>' +
      '<div class="field" style="grid-column:1/-1"><label for="letBody">What you want to say</label>' +
      '<textarea id="letBody" placeholder="Write it the way you would say it."></textarea></div></div>' +
    '<button class="btn btn-primary btn-sm" style="margin-top:10px" data-act="add-letter">Add this letter</button>' +
  '</div>' +

  '<div class="card card-pad" style="margin-top:14px;border-color:color-mix(in oklab,var(--seal) 34%,transparent)">' +
    '<div class="sectitle"><h3>Sealed notes</h3><span class="hint">One person each. Nobody else, ever.</span></div>' +
    '<p class="small muted" style="margin-bottom:12px">Each of these is locked with a word you choose and only that person would know. The word is never stored anywhere — not by ' + esc(h.name) + ', not by us — so the note cannot be opened by a funeral director, by a court order served on us, or by anyone who steals the database. <b>It also cannot be recovered if the word is forgotten.</b> That is the trade, and it is the whole reason it is worth anything.</p>' +
    p.sealed.map((z) => '<div class="sealed" style="margin-bottom:10px">' +
      '<div class="sh"><span class="pill pill-seal">Sealed</span>' +
      '<span><span class="sw">For ' + esc(z.forWhom) + '</span> <span class="sr">' + esc(z.rel.toLowerCase()) + '</span></span>' +
      '<span class="spacer"><button class="btn btn-sm btn-danger" data-act="del-sealed" data-id="' + z.id + '">Delete</button></span></div>' +
      '<div class="hint">Their clue: “' + esc(z.hint) + '” &middot; <span class="mono">' + z.body.join(" ").length + ' characters</span></div></div>').join("") +
    '<hr class="rule" style="margin:14px 0">' +
    '<div class="grid2">' +
      '<div class="field"><label for="szWho">Who it is for</label><input id="szWho" type="text" placeholder="Ruth"></div>' +
      '<div class="field"><label for="szRel">Their relationship to you</label><input id="szRel" type="text" placeholder="Daughter"></div>' +
      '<div class="field"><label for="szPass">The word that opens it</label><input id="szPass" type="text" placeholder="cheyenne"></div>' +
      '<div class="field"><label for="szHint">The clue they will see</label><input id="szHint" type="text" placeholder="The town we broke down in, 1987"></div>' +
      '<div class="field" style="grid-column:1/-1"><label for="szBody">What only they should read</label>' +
        '<textarea id="szBody" placeholder="The thing you could not say out loud."></textarea></div>' +
    '</div>' +
    '<button class="btn btn-primary btn-sm" style="margin-top:10px" data-act="add-sealed">Seal it</button>' +
    '<p class="tiny muted" style="margin-top:10px">Pick a clue that is a shared memory, not a fact. A mother’s maiden name, a birthday or a pet’s name is in somebody’s Facebook; the town you broke down in is not.</p>' +
  '</div>';
}

function planDone(p, h) {
  const dead = isDead(p);
  return '<div class="card card-pad">' +
    '<div class="sectitle"><h3>What happens on the day</h3></div>' +
    '<div class="kv">' +
      '<div class="kv-row"><div class="k">Your file</div><div class="v">Held by ' + esc(h.name) + ', locked to your name, nothing visible to anyone.</div></div>' +
      '<div class="kv-row"><div class="k">Who tells us</div><div class="v">' + esc(p.nok) + ' (' + esc(p.rel.toLowerCase()) + '), ' + esc(p.nokPhone) + '</div></div>' +
      '<div class="kv-row"><div class="k">Already answered</div><div class="v mono">' + Object.keys(p.answers).filter((k) => p.answers[k]).length + ' boxes</div></div>' +
      '<div class="kv-row"><div class="k">Already chosen</div><div class="v mono">' + Object.keys(p.chosen).length + ' items' + (p.plot ? ", plus a plot" : "") + '</div></div>' +
      '<div class="kv-row"><div class="k">Left for them</div><div class="v mono">' + p.videos.length + ' recordings, ' + p.letters.length + ' letters, ' + p.sealed.length + ' sealed</div></div>' +
    '</div>' +
    '<hr class="rule" style="margin:16px 0">' +
    (dead
      ? '<p class="small">Thomas has died. His name is now on ' + esc(h.name) + '’s list of the deceased, and his family can sign in with his date of birth.</p>' +
        '<div class="row" style="margin-top:10px"><button class="btn btn-primary btn-sm" data-act="open-as-family" data-id="pryor">Open it as Ruth does</button></div>'
      : '<p class="small muted">To see the point of all this, record his death — the thing a family actually rings the home about — and then open the file as his daughter.</p>' +
        '<div class="row" style="margin-top:10px"><button class="btn btn-primary btn-sm" data-act="record-death" data-id="pryor">Record Thomas’s death</button>' +
        '<span class="tiny muted">Does what the director would do on the telephone at 6am.</span></div>') +
  '</div>';
}

/* ============================================================= director === */

const D_TABS = [
  ["overview", "Overview"], ["paperwork", "Paperwork"], ["photos", "Photographs"],
  ["left", "What they left"], ["schedule", "Deadlines"], ["visits", "Availability"],
  ["messages", "Messages"], ["aftercare", "Aftercare"]
];

function viewDirector() {
  const h = homeById(state.dirHome);
  applyAccent(h.accent);
  const mine = peopleOf(h.id);
  let p = personById(state.dirPerson);
  if (!p || p.homeId !== h.id) { p = mine[0]; state.dirPerson = p.id; }

  const open = mine.filter((x) => x.status === "open" && isDead(x));
  const pre  = mine.filter((x) => !isDead(x));
  const rest = mine.filter((x) => x.status !== "open" && isDead(x));

  return banner("<b>The director’s side.</b> Every family " + esc(h.name) + " is carrying. Everything a family sees was typed here or in Master first." +
      (state.homes.length > 1 ? " Switch home: " + state.homes.map((x) =>
        '<button class="btn btn-sm" style="margin-left:6px" data-act="dir-home" data-id="' + x.id + '">' + esc(x.name) + '</button>').join("") : "")) +
  '<div class="desk">' +
    '<div class="caselist">' +
      '<div class="caselist-head"><span class="eyebrow">In our care</span><span class="mono tiny muted spacer">' + open.length + ' open</span></div>' +
      (open.length ? open.map((x) => caseRow(x)).join("") : '<p class="small muted">Nobody open.</p>') +
      (pre.length ? '<div class="caselist-head" style="padding-top:18px"><span class="eyebrow">Arranged in advance</span></div>' + pre.map((x) => caseRow(x)).join("") : "") +
      (rest.length ? '<div class="caselist-head" style="padding-top:18px"><span class="eyebrow">Closed and archived</span></div>' + rest.map((x) => caseRow(x)).join("") : "") +
      '<div class="card card-pad" style="margin-top:18px">' +
        '<div class="eyebrow">Add somebody to our care</div>' +
        '<div class="field" style="margin-top:8px"><label for="npName">Full name</label><input id="npName" type="text" placeholder="Harold James Finch"></div>' +
        '<div class="field" style="margin-top:8px"><label for="npDob">Date of birth</label><input id="npDob" type="text" placeholder="MM/DD/YYYY"></div>' +
        '<div class="field" style="margin-top:8px"><label for="npNok">Next of kin</label><input id="npNok" type="text" placeholder="Deborah Finch"></div>' +
        '<div class="field" style="margin-top:8px"><label for="npSvc">Service, days from today</label><input id="npSvc" type="number" value="5"></div>' +
        '<button class="btn btn-primary btn-sm btn-block" style="margin-top:10px" data-act="add-person">Open a file</button>' +
        '<p class="tiny muted" style="margin-top:8px">The schedule starts from the moment you press this, on the offsets ' + esc(h.name) + ' chose.</p>' +
      '</div>' +
    '</div>' +

    '<div>' + dirDetail(p, h) + '</div>' +
  '</div>';
}

function caseRow(p) {
  const out = isDead(p) ? outstanding(p) : 0;
  const st = !isDead(p) ? '<span class="pill pill-accent">Pre-need, file ready</span>'
    : p.status === "closed" ? '<span class="pill pill-quiet">Closed</span>' + (p.aftercare === "on" ? '<span class="pill pill-accent">Aftercare running</span>' : "")
    : p.status === "archived" ? '<span class="pill pill-quiet">Archived</span>'
    : out ? '<span class="pill pill-late">' + out + ' outstanding</span>'
    : '<span class="pill pill-done">Nothing outstanding</span>';
  const svc = serviceAt(p);
  return '<button class="caserow" data-act="open-case" data-id="' + p.id + '" aria-current="' + (state.dirPerson === p.id) + '">' +
    '<span class="who">' + esc(fullName(p)) + '</span>' +
    '<span class="no">' + esc(p.no) + (isDead(p) && svc ? " &middot; service " + fmtShort(svc) : " &middot; no death recorded") +
      (p.kind === "pre-need" ? " &middot; pre-arranged" : "") + '</span>' +
    '<span class="st">' + st + '</span></button>';
}

function dirDetail(p, h) {
  const svc = serviceAt(p);
  const tabs = D_TABS.filter(([k]) => k !== "left" || (p.videos.length + p.letters.length + p.sealed.length));
  return '<div class="detail-head">' +
    '<div><h2>' + esc(fullName(p)) + '</h2>' +
      '<div class="sub">' + esc(p.no) + ' &middot; ' + esc(p.kind) + ' &middot; next of kin ' + esc(p.nok) +
      ' (' + esc(p.rel.toLowerCase()) + ') &middot; ' + esc(p.nokPhone) + ' &middot; signs in with <b>' + esc(p.dob) + '</b></div></div>' +
    '<div class="acts">' +
      (!isDead(p)
        ? '<button class="btn btn-primary btn-sm" data-act="record-death" data-id="' + p.id + '">Record the death</button>'
        : p.status === "open"
          ? '<button class="btn btn-primary btn-sm" data-act="case-status" data-id="' + p.id + '" data-to="closed">Close the case</button>' +
            '<button class="btn btn-sm" data-act="case-status" data-id="' + p.id + '" data-to="archived">Archive</button>'
          : '<button class="btn btn-sm" data-act="case-status" data-id="' + p.id + '" data-to="open">Reopen</button>' +
            (p.status === "closed" ? '<button class="btn btn-sm" data-act="case-status" data-id="' + p.id + '" data-to="archived">Archive</button>' : "")) +
      (isDead(p) ? '<button class="btn btn-sm" data-act="open-as-family" data-id="' + p.id + '">See it as the family does</button>' : "") +
    '</div></div>' +

    (!isDead(p)
      ? '<div class="card card-pad"><div class="sectitle"><h3>Arranged in advance</h3>' +
        '<span class="hint">Nothing for you to do until the telephone rings</span></div>' +
        '<div class="kv">' +
          '<div class="kv-row"><div class="k">Answers on file</div><div class="v mono">' + Object.keys(p.answers).filter((k) => p.answers[k]).length + '</div></div>' +
          '<div class="kv-row"><div class="k">Chosen already</div><div class="v mono">' + Object.keys(p.chosen).length + ' items' + (p.plot ? ", plot " + esc(h.plots.find((g) => g.id === p.plot).no) : "") + '</div></div>' +
          '<div class="kv-row"><div class="k">Left for the family</div><div class="v mono">' + p.videos.length + ' recordings, ' + p.letters.length + ' letters, ' + p.sealed.length + ' sealed</div></div>' +
          '<div class="kv-row"><div class="k">Sealed notes</div><div class="v">You cannot read these, and neither can we. Hand the family the file and they open their own.</div></div>' +
        '</div></div>'
      : '<div class="dtabs">' + tabs.map(([k, l]) =>
          '<button data-act="dir-tab" data-tab="' + k + '" aria-pressed="' + (state.dirTab === k) + '">' + l + '</button>').join("") + '</div>' +
        dirPane(p, h));
}

function dirPane(p, h) {
  switch (state.dirTab) {
    case "paperwork": return dirPaperwork(p, h);
    case "photos":    return dirPhotos(p, h);
    case "left":      return dirLeft(p, h);
    case "schedule":  return dirSchedule(p, h);
    case "visits":    return dirVisits(p, h);
    case "messages":  return dirMessages(p, h);
    case "aftercare": return dirAftercare(p, h);
    default:          return dirOverview(p, h);
  }
}

function dirOverview(p, h) {
  const steps = h.schedule.filter((s) => !s.event);
  const late = steps.filter((s) => stepState(p, s) === "late").length;
  const flags = openFlagCount(p);
  const sel = p.photos.filter((x) => x.sel).length;
  const filled = attachedForms(h).reduce((a, f) => a + formProgress(p, f).filled, 0);
  const all = attachedForms(h).reduce((a, f) => a + formProgress(p, f).total, 0);
  const svc = serviceAt(p);

  return '<div class="grid2">' +
    '<div class="card card-pad"><div class="sectitle"><h3>Waiting on the family</h3></div><div class="kv">' +
      '<div class="kv-row"><div class="k">Steps overdue</div><div class="v">' + (late ? '<span class="pill pill-late">' + late + '</span>' : '<span class="pill pill-done">None</span>') + '</div></div>' +
      '<div class="kv-row"><div class="k">Sent back</div><div class="v">' + (flags ? '<span class="pill pill-late">' + flags + ' unanswered</span>' : '<span class="pill pill-done">Nothing outstanding</span>') + '</div></div>' +
      '<div class="kv-row"><div class="k">Paperwork</div><div class="v mono">' + filled + ' of ' + all + ' boxes filled</div></div>' +
      '<div class="kv-row"><div class="k">Slideshow</div><div class="v mono">' + sel + ' chosen of ' + p.photos.length + ' sent</div></div>' +
    '</div></div>' +
    '<div class="card card-pad"><div class="sectitle"><h3>The service</h3></div><div class="kv">' +
      '<div class="kv-row"><div class="k">When</div><div class="v">' + (svc ? fmtDay(svc) + '<br><span class="mono small muted">' + fmtTime(svc) + '</span>' : "—") + '</div></div>' +
      '<div class="kv-row"><div class="k">Where</div><div class="v">' + esc(p.serviceWhere || "—") + '</div></div>' +
      '<div class="kv-row"><div class="k">Disposition</div><div class="v">' + esc(p.disposition || "—") + '</div></div>' +
      '<div class="kv-row"><div class="k">Move it</div><div class="v row" style="gap:6px">' +
        '<button class="btn btn-sm" data-act="move-service" data-by="-1">− a day</button>' +
        '<button class="btn btn-sm" data-act="move-service" data-by="1">+ a day</button></div></div>' +
    '</div></div></div>' +

  '<div class="card card-pad" style="margin-top:14px">' +
    '<div class="sectitle"><h3>What the family has done</h3><span class="hint">Ticked by them, on their phone</span></div>' +
    '<div class="tl">' + h.schedule.slice().sort((a, b) => dueDate(p, a) - dueDate(p, b))
      .map((s) => '<div class="tl-item ' + (p.done[s.id] ? "done" : "") + '">' + tlRow(p, s) + '</div>').join("") + '</div>' +
    '<p class="small muted" style="margin-top:11px">Move the service with the buttons above and watch every unfinished step move with it. Anything already ticked stays exactly where it is — telling a daughter who delivered the clothing on Tuesday that it is now due Thursday would be worse than saying nothing.</p>' +
  '</div>';
}

function dirPaperwork(p, h) {
  return '<div class="card card-pad">' +
    '<div class="sectitle"><h3>' + esc(p.first) + '’s forms</h3><span class="hint">Mark a blank box and say why — it lands in front of them at the blank</span></div>' +
    attachedForms(h).map((f) => {
      const pr = formProgress(p, f);
      return '<div style="padding:14px 0;border-bottom:1px solid var(--rule)">' +
        '<div class="row" style="margin-bottom:9px"><b>' + esc(f.name) + '</b>' +
        '<span class="pill ' + (pr.filled === pr.total ? "pill-done" : "pill-due") + '">' + pr.filled + '/' + pr.total + ' filled</span></div>' +
        '<div class="scroller"><table class="tbl"><thead><tr><th>Box</th><th>What is in it</th><th style="width:160px">Send it back</th></tr></thead><tbody>' +
          f.fields.map((x) => {
            const key = f.id + "." + x.k, val = p.answers[key] || "", empty = String(val).trim() === "";
            const flagged = !!p.flags[key], bySelf = p.answeredBy[key] === "self";
            return '<tr><td>' + esc(x.label) + '</td>' +
              '<td>' + (empty ? '<span class="pill pill-due">Blank</span>'
                : '<span style="word-break:break-word">' + esc(String(val).slice(0, 80)) + '</span>' +
                  (bySelf ? '<br><span class="pill pill-accent">their own answer</span>' : "")) + '</td>' +
              '<td>' + (state.editingFlag === key
                ? '<textarea data-act="flag-text" data-key="' + key + '" style="width:100%;min-height:52px;border:1px solid var(--accent);border-radius:6px;padding:6px;font-size:13px" placeholder="We still need this one.">' + esc(p.flags[key] || "") + '</textarea>' +
                  '<button class="btn btn-sm btn-primary" style="margin-top:5px" data-act="flag-save" data-key="' + key + '">Send it back</button>'
                : flagged ? '<button class="btn btn-sm btn-danger" data-act="unflag" data-key="' + key + '">Marked — clear</button>'
                : '<button class="btn btn-sm" data-act="flag" data-key="' + key + '"' + (empty ? "" : " disabled") + '>Mark &amp; send back</button>') + '</td></tr>';
          }).join("") + '</tbody></table></div></div>';
    }).join("") +
    '<p class="small muted" style="margin-top:12px">To change which forms this home uses at all — upload, rename, delete, attach — go to <b>Master → Forms</b>.</p>' +
  '</div>';
}

function dirPhotos(p, h) {
  const sel = p.photos.filter((x) => x.sel).sort((a, b) => a.pos - b.pos);
  return '<div class="card card-pad">' +
    '<div class="sectitle"><h3>What the family sent</h3>' +
      '<span class="hint">' + p.photos.length + ' in, ' + sel.length + ' in the slideshow</span>' +
      '<span class="spacer"></span><button class="btn btn-sm btn-primary" data-act="say-pack">Download the photo pack</button></div>' +
    (p.photos.length
      ? '<div class="photos" style="grid-template-columns:repeat(auto-fill,minmax(104px,1fr))">' +
        p.photos.slice().sort((a, b) => (b.sel - a.sel) || a.pos - b.pos).map((x) => {
          const i = sel.indexOf(x);
          return '<button class="ph" data-sel="' + (x.sel ? 1 : 0) + '" data-act="toggle-photo" data-id="' + x.id + '" style="' + swatch(x.tone) + '">' +
            (x.sel ? '<span class="num">' + (i + 1) + '</span>' : "") +
            '<span class="cap">' + esc(x.label) + '<br>from ' + esc(x.from) + '</span></button>';
        }).join("") + '</div>'
      : '<p class="small muted">Nothing sent yet. The family adds them on their Photographs tab.</p>') +
    '<p class="small muted" style="margin-top:11px">The pack downloads as a folder, numbered in slideshow order, named with the caption the family wrote, with a <span class="mono">captions.txt</span> for whoever is typesetting the order of service.</p></div>';
}

function dirLeft(p, h) {
  return '<div class="card card-pad">' +
    '<div class="sectitle"><h3>What ' + esc(p.first) + ' left</h3><span class="hint">Held for the family, not for you</span></div>' +
    '<div class="kv">' +
      '<div class="kv-row"><div class="k">Recordings</div><div class="v">' + p.videos.map((v) => esc(v.title) + ' <span class="mono tiny muted">' + esc(v.mins) + '</span>').join("<br>") + '</div></div>' +
      '<div class="kv-row"><div class="k">Open letters</div><div class="v">' + p.letters.map((l) => esc(l.title)).join("<br>") + '</div></div>' +
      '<div class="kv-row"><div class="k">Sealed notes</div><div class="v">' +
        p.sealed.map((z) => '<span class="pill pill-seal">For ' + esc(z.forWhom) + '</span>').join(" ") +
        '<div class="tiny muted" style="margin-top:6px">You can see that they exist and who each one is for. You cannot open them, and neither can we — see the note at the bottom of Master.</div></div></div>' +
    '</div></div>';
}

function dirSchedule(p, h) {
  return '<div class="card card-pad">' +
    '<div class="sectitle"><h3>' + esc(h.name) + '’s standard schedule</h3>' +
      '<span class="hint">Every file this home opens inherits it</span></div>' +
    '<div class="stack">' +
      '<div class="editline" style="border-bottom-color:var(--rule-strong)">' +
        '<span class="eyebrow">Step</span><span class="eyebrow">Counted from</span><span class="eyebrow">Days</span><span></span></div>' +
      h.schedule.slice().sort((a, b) => dueDate(p, a) - dueDate(p, b)).map((s) =>
        '<div class="editline">' +
          '<input type="text" value="' + esc(s.title) + '" data-act="step-title" data-id="' + s.id + '" aria-label="Step name">' +
          '<span class="anchorcell"><select data-act="step-anchor" data-id="' + s.id + '" aria-label="Counted from"' + (s.event ? " disabled" : "") + '>' +
            '<option value="service"' + (s.anchor === "service" ? " selected" : "") + '>the service</option>' +
            '<option value="open"' + (s.anchor === "open" ? " selected" : "") + '>the day we open the file</option></select></span>' +
          '<span class="offcell"><input type="number" value="' + s.off + '" data-act="step-off" data-id="' + s.id + '" aria-label="Days" step="1">' +
            '<span class="resolved">' + fmtShort(dueDate(p, s)) + '</span></span>' +
          '<button class="btn btn-sm btn-danger" data-act="del-step" data-id="' + s.id + '"' + (s.event ? " disabled" : "") + '>' + (s.event ? "Fixed" : "Delete") + '</button>' +
        '</div>').join("") +
    '</div>' +
    '<hr class="rule" style="margin:14px 0">' +
    '<div class="grid2">' +
      '<div class="field"><label for="stTitle">A new step</label><input id="stTitle" type="text" placeholder="Choose the readings"></div>' +
      '<div class="field"><label for="stOff">Days</label><input id="stOff" type="number" value="-3"></div>' +
      '<div class="field"><label for="stAnchor">Counted from</label><select id="stAnchor">' +
        '<option value="service">the service</option><option value="open">the day we open the file</option></select></div>' +
    '</div>' +
    '<button class="btn btn-primary btn-sm" style="margin-top:10px" data-act="add-step">Add it</button>' +
    '<p class="small muted" style="margin-top:12px"><b>Negative is before.</b> −4 counted from the service means four days before the funeral; +2 counted from the day the file opens means two days after you take them into your care. Change a number and every family’s page changes with it.</p>' +
  '</div>';
}

function dirVisits(p, h) {
  return '<div class="card card-pad">' +
    '<div class="sectitle"><h3>Times you can offer</h3><span class="hint">Families take what they need</span></div>' +
    '<div class="scroller"><table class="tbl"><thead><tr><th>Day</th><th>Time</th><th>What for</th><th>Status</th><th></th></tr></thead><tbody>' +
      (h.slots.length ? h.slots.map((s) => {
        const who = s.taken ? personById(s.taken) : null;
        return '<tr><td class="mono">' + fmtShort(d2(s.day)) + '</td><td class="mono">' + esc(s.time) + '</td>' +
          '<td>' + esc(s.what) + '</td>' +
          '<td>' + (who ? '<span class="pill pill-done">' + esc(who.nok) + '</span>' : '<span class="pill pill-quiet">Open</span>') + '</td>' +
          '<td><button class="btn btn-sm btn-danger" data-act="del-slot" data-id="' + s.id + '">Withdraw</button></td></tr>';
      }).join("") : '<tr><td colspan="5" class="muted small">Nothing offered yet.</td></tr>') +
    '</tbody></table></div>' +
    '<hr class="rule" style="margin:16px 0">' +
    '<div class="grid2">' +
      '<div class="field"><label for="slotDay">Day</label><select id="slotDay">' +
        [0, 1, 2, 3, 4, 5, 6, 7, 10, 14, 21].map((n) => '<option value="' + (state.day + n) + '">' +
          fmtShort(d2(state.day + n)) + (n === 0 ? " (today)" : "") + '</option>').join("") + '</select></div>' +
      '<div class="field"><label for="slotTime">Time</label><select id="slotTime">' +
        ["9:00am", "10:00am", "11:00am", "1:00pm", "2:00pm", "3:30pm", "4:00pm"].map((t) => '<option>' + t + '</option>').join("") + '</select></div>' +
      '<div class="field" style="grid-column:1/-1"><label for="slotWhat">What it is for</label>' +
        '<input id="slotWhat" type="text" placeholder="Private viewing, immediate family"></div>' +
    '</div>' +
    '<button class="btn btn-primary btn-sm" style="margin-top:10px" data-act="add-slot">Offer this time</button></div>';
}

function dirMessages(p, h) {
  const visible = p.messages.filter((m) => m.at <= state.day);
  return '<div class="card card-pad">' +
    '<div class="sectitle"><h3>Thread with the ' + esc(p.last) + ' family</h3><span class="hint">Everyone on their side sees the same conversation</span></div>' +
    (visible.length ? '<div class="thread">' + visible.map((m) => {
      const at = d2(m.at);
      return '<div class="msg ' + (m.who === "home" ? "msg-fam" : "msg-home") + '">' +
        '<div class="from">' + (m.who === "home" ? "You" : esc(p.nok)) + '</div>' + esc(m.body) +
        '<div class="msg-time">' + fmtShort(at) + ", " + fmtTime(at) + '</div></div>';
    }).join("") + '</div>' : '<p class="small muted">Nothing yet.</p>') +
    '<div class="field" style="margin-top:14px"><label for="dirMsg">Reply</label>' +
      '<textarea id="dirMsg" placeholder="Write to ' + esc(p.nok) + '"></textarea></div>' +
    '<button class="btn btn-primary btn-sm" style="margin-top:10px" data-act="dir-send">Send</button></div>';
}

function dirAftercare(p, h) {
  const svc = serviceAt(p);
  const since = svc ? state.day - p.serviceDay : -999;
  return '<div class="card card-pad">' +
    '<div class="sectitle"><h3>Aftercare</h3><span class="hint">Costs your staff nothing, and it is what brings the next family</span></div>' +
    '<div class="kv">' +
      '<div class="kv-row"><div class="k">Case</div><div class="v">' + (p.status === "closed"
        ? '<span class="pill pill-done">Closed</span>' : '<span class="pill pill-quiet">Open — enrolment starts at closing</span>') + '</div></div>' +
      '<div class="kv-row"><div class="k">Family said</div><div class="v">' + (p.status !== "closed" ? '<span class="pill pill-quiet">Not asked yet</span>'
        : p.aftercare === "pending" ? '<span class="pill pill-due">Waiting on them</span>'
        : p.aftercare === "declined" ? '<span class="pill pill-quiet">Declined — final</span>'
        : '<span class="pill pill-done">Yes</span>') + '</div></div>' +
    '</div>' +
    (p.aftercare === "on" ? '<div class="scroller" style="margin-top:14px"><table class="tbl"><thead><tr><th>Check-in</th><th>Goes out</th><th>Status</th></tr></thead><tbody>' +
      CARE_LETTERS.map((l) => '<tr><td>' + esc(l.subject) + '</td>' +
        '<td class="mono">' + fmtShort(new Date(svc.getTime() + l.at * DAY)) + '</td>' +
        '<td>' + (since >= l.at ? '<span class="pill pill-done">Sent</span>' : '<span class="pill pill-quiet">Scheduled</span>') + '</td></tr>').join("") +
      '</tbody></table></div>' : "") +
    '<p class="small muted" style="margin-top:12px">Enrolment starts <b>pending</b> and sends nothing until the family agrees. They see the four actual dates, a decline the same size as the accept, and a no is final. A bereavement check-in nobody asked for is not a kindness.</p></div>';
}

/* =============================================================== master === */

const M_TABS = [
  ["brand", "Name, logo, colour"], ["forms", "Forms"], ["schedule", "Deadlines"],
  ["inventory", "Storefront"], ["cemetery", "Cemetery"], ["people", "Files"]
];

function viewMaster() {
  const h = homeById(state.masterHome) || state.homes[0];
  applyAccent(h.accent);

  return banner("<b>Yours, not theirs.</b> This is where a funeral home gets set up: name, logo, colour, their own paperwork, their own deadlines, their own urn room and their own ground. Everything else — the family’s screens, the letters, the photo pack, the sealed notes — is the same software for every home on the platform.") +
  '<div class="desk">' +
    '<div class="caselist">' +
      '<div class="caselist-head"><span class="eyebrow">Homes on the platform</span><span class="mono tiny muted spacer">' + state.homes.length + '</span></div>' +
      state.homes.map((x) =>
        '<button class="caserow" data-act="master-home" data-id="' + x.id + '" aria-current="' + (h.id === x.id) + '">' +
          '<span class="who">' + esc(x.name) + '</span>' +
          '<span class="no">' + esc(x.city) + ', ' + esc(x.region) + ' &middot; ' + peopleOf(x.id).length + ' files</span>' +
          '<span class="st"><span class="pill pill-quiet">' + x.forms.length + ' forms</span>' +
          '<span class="pill pill-quiet">' + x.schedule.length + ' steps</span></span></button>').join("") +

      '<div class="card card-pad" style="margin-top:18px">' +
        '<div class="eyebrow">Sign up a new home</div>' +
        '<div class="field" style="margin-top:8px"><label for="nhName">Funeral home name</label><input id="nhName" type="text" placeholder="Okonkwo Family Funerals"></div>' +
        '<div class="field" style="margin-top:8px"><label for="nhCity">Town</label><input id="nhCity" type="text" placeholder="Greeley"></div>' +
        '<div class="field" style="margin-top:8px"><label for="nhDir">Director</label><input id="nhDir" type="text" placeholder="Adaeze Okonkwo"></div>' +
        '<div class="field" style="margin-top:8px"><label for="nhPhone">Telephone</label><input id="nhPhone" type="text" placeholder="(970) 555-0100"></div>' +
        '<div class="field" style="margin-top:8px"><label for="nhAccent">Their colour</label><input id="nhAccent" type="color" value="#3A5A78" style="height:38px;padding:3px"></div>' +
        '<button class="btn btn-primary btn-sm btn-block" style="margin-top:10px" data-act="add-home">Create their page</button>' +
        '<p class="tiny muted" style="margin-top:8px">They start with the standard schedule, the five standard forms and an empty storefront, then change whatever they like.</p>' +
      '</div>' +
    '</div>' +

    '<div>' +
      '<div class="detail-head">' +
        '<div class="crest" style="border:0;padding:0;margin:0">' +
          '<div class="mark">' + crestMark(h) + '</div>' +
          '<div><div class="nm">' + esc(h.name) + '</div>' +
          '<div class="ad">' + esc(h.line1) + ', ' + esc(h.city) + ' ' + esc(h.region) + ' ' + esc(h.postal) + '</div></div>' +
        '</div>' +
        '<div class="acts"><button class="btn btn-sm" data-act="preview-home" data-id="' + h.id + '">Open their public page</button></div>' +
      '</div>' +
      '<div class="dtabs">' + M_TABS.map(([k, l]) =>
        '<button data-act="master-tab" data-tab="' + k + '" aria-pressed="' + (state.masterTab === k) + '">' + l + '</button>').join("") + '</div>' +
      masterPane(h) +
    '</div>' +
  '</div>' +
  privacyNote();
}

function masterPane(h) {
  switch (state.masterTab) {
    case "forms":     return masterForms(h);
    case "schedule":  return dirSchedule(peopleOf(h.id)[0] || hale, h);
    case "inventory": return masterInventory(h);
    case "cemetery":  return masterCemetery(h);
    case "people":    return masterPeople(h);
    default:          return masterBrand(h);
  }
}

function masterBrand(h) {
  const f = (id, key, label, type) =>
    '<div class="field"><label for="' + id + '">' + label + '</label>' +
    '<input id="' + id + '" type="' + (type || "text") + '" value="' + esc(h[key]) + '" data-act="home-field" data-key="' + key + '"' +
    (type === "color" ? ' style="height:38px;padding:3px"' : "") + '></div>';

  return '<div class="card card-pad">' +
    '<div class="sectitle"><h3>What makes this home theirs</h3><span class="hint">Change anything — every family screen follows</span></div>' +
    '<div class="grid2">' +
      f("mName", "name", "Funeral home name") + f("mDir", "director", "Director signing letters") +
      f("mInit", "initials", "Initials for the crest") + f("mCem", "cemetery", "Their cemetery") +
      f("mLine1", "line1", "Street") + f("mCity", "city", "Town") +
      f("mRegion", "region", "State") + f("mPostal", "postal", "ZIP") +
      f("mPhone", "phone", "Office telephone") + f("mUrgent", "urgent", "24-hour number") +
      f("mOpens", "opens", "Office opens") + f("mCloses", "closes", "Office closes") +
      '<div class="field"><label for="mAccent">Their colour</label>' +
        '<input id="mAccent" type="color" value="' + esc(h.accent) + '" data-act="home-accent" style="height:38px;padding:3px"></div>' +
      '<div class="field"><label for="mLogo">Their logo</label>' +
        '<input id="mLogo" type="file" accept="image/*" data-act="home-logo"></div>' +
    '</div>' +
    '<p class="small muted" style="margin-top:12px">Name, address, telephone, hours, logo and colour are the whole of what a family sees as different between one home and the next. Their paperwork, their schedule, their storefront and their ground are theirs too. Nothing else is per-home, which is why one deploy serves all of them.</p></div>';
}

function masterForms(h) {
  return '<div class="card card-pad">' +
    '<div class="sectitle"><h3>' + esc(h.name) + '’s forms</h3><span class="hint">Upload once; every file this home opens gets the attached ones</span></div>' +
    '<div class="formlist">' + h.forms.map((f) =>
      '<div class="formrow">' +
        '<div><div class="nm">' + esc(f.name) + '</div>' +
        '<div class="mt">' + esc(f.note) + ' &middot; ' + f.fields.length + ' boxes' + (f.preplan ? " &middot; also used in pre-planning" : "") + '</div></div>' +
        '<div class="acts">' +
          '<button class="btn btn-sm" data-act="toggle-attach" data-id="' + f.id + '">' + (f.attached ? "Attached" : "Attach") + '</button>' +
          '<button class="btn btn-sm" data-act="toggle-preplan" data-id="' + f.id + '">' + (f.preplan ? "In pre-planning" : "Not in pre-planning") + '</button>' +
          '<button class="btn btn-sm btn-danger" data-act="delete-form" data-id="' + f.id + '">Delete</button>' +
        '</div></div>').join("") + '</div>' +

    '<hr class="rule" style="margin:16px 0">' +
    '<div class="grid2">' +
      '<div class="field"><label for="fmName">Rename a form</label><select id="fmPick">' +
        h.forms.map((f) => '<option value="' + f.id + '">' + esc(f.name) + '</option>').join("") + '</select></div>' +
      '<div class="field"><label for="fmNew">New name</label><input id="fmNew" type="text" placeholder="Cremation Authorization (Colorado)"></div>' +
    '</div>' +
    '<button class="btn btn-sm" style="margin-top:10px" data-act="rename-form">Rename it</button>' +

    '<label class="dropzone" style="margin-top:16px"><b>Upload one of their own forms</b>' +
      'A PDF or a Word document. We turn it into boxes a family can fill on a phone.' +
      '<input type="file" hidden data-act="upload-form" accept=".pdf,.doc,.docx"></label>' +
    '<p class="tiny muted" style="margin-top:10px">In the product the PDF’s own fields are read out and become the boxes; here the upload makes three example boxes so you can see the flow.</p></div>';
}

function masterInventory(h) {
  return '<div class="card card-pad">' +
    '<div class="sectitle"><h3>' + esc(h.name) + '’s storefront</h3><span class="hint">Their inventory, their prices, their money</span></div>' +
    '<div class="scroller"><table class="tbl"><thead><tr><th>Item</th><th>Kind</th><th style="text-align:right">Price</th><th></th></tr></thead><tbody>' +
      (h.inventory.length ? h.inventory.map((i) => '<tr>' +
        '<td><b>' + esc(i.name) + '</b><br><span class="tiny muted">' + esc(i.desc) + '</span></td>' +
        '<td class="mono tiny">' + esc(i.kind) + '</td>' +
        '<td class="mono" style="text-align:right">' + money(i.price) + '</td>' +
        '<td><button class="btn btn-sm btn-danger" data-act="del-item" data-id="' + i.id + '">Remove</button></td></tr>').join("")
        : '<tr><td colspan="4" class="muted small">Empty. A home with nothing here simply does not get the tab.</td></tr>') +
    '</tbody></table></div>' +
    '<hr class="rule" style="margin:16px 0">' +
    '<div class="grid2">' +
      '<div class="field"><label for="itName">Item</label><input id="itName" type="text" placeholder="Hand-turned maple urn"></div>' +
      '<div class="field"><label for="itPrice">Their price</label><input id="itPrice" type="number" placeholder="320"></div>' +
      '<div class="field"><label for="itKind">Kind</label><select id="itKind">' +
        ["Urn", "Casket", "Keepsake", "Stationery"].map((k) => '<option>' + k + '</option>').join("") + '</select></div>' +
      '<div class="field"><label for="itDesc">One line about it</label><input id="itDesc" type="text" placeholder="Made in Lyons, no two alike"></div>' +
    '</div>' +
    '<button class="btn btn-primary btn-sm" style="margin-top:10px" data-act="add-item">Add to the storefront</button></div>';
}

function masterCemetery(h) {
  return '<div class="card card-pad">' +
    '<div class="sectitle"><h3>' + esc(h.cemetery) + '</h3><span class="hint">Plots somebody planning ahead can take</span></div>' +
    '<div class="scroller"><table class="tbl"><thead><tr><th>Section</th><th>Plot</th><th>Kind</th><th style="text-align:right">Price</th><th>Taken by</th><th></th></tr></thead><tbody>' +
      (h.plots.length ? h.plots.map((g) => {
        const owner = state.people.find((p) => p.plot === g.id);
        return '<tr><td><b>' + esc(g.section) + '</b><br><span class="tiny muted">' + esc(g.desc) + '</span></td>' +
          '<td class="mono">' + esc(g.no) + '</td><td class="tiny">' + esc(g.kind) + '</td>' +
          '<td class="mono" style="text-align:right">' + money(g.price) + '</td>' +
          '<td>' + (owner ? '<span class="pill pill-accent">' + esc(shortName(owner)) + '</span>' : '<span class="pill pill-quiet">Open</span>') + '</td>' +
          '<td><button class="btn btn-sm btn-danger" data-act="del-plot" data-id="' + g.id + '">Remove</button></td></tr>';
      }).join("") : '<tr><td colspan="6" class="muted small">No ground. A home that does not own a cemetery simply does not show this.</td></tr>') +
    '</tbody></table></div>' +
    '<hr class="rule" style="margin:16px 0">' +
    '<div class="grid2">' +
      '<div class="field"><label for="plSection">Section</label><input id="plSection" type="text" placeholder="The Meadow"></div>' +
      '<div class="field"><label for="plNo">Plot number</label><input id="plNo" type="text" placeholder="M-033"></div>' +
      '<div class="field"><label for="plKind">Kind</label><select id="plKind">' +
        ["Full burial", "Niche", "Scattering"].map((k) => '<option>' + k + '</option>').join("") + '</select></div>' +
      '<div class="field"><label for="plPrice">Price</label><input id="plPrice" type="number" placeholder="1850"></div>' +
      '<div class="field" style="grid-column:1/-1"><label for="plDesc">One line about it</label>' +
        '<input id="plDesc" type="text" placeholder="Open ground, flat markers only"></div>' +
    '</div>' +
    '<button class="btn btn-primary btn-sm" style="margin-top:10px" data-act="add-plot">Add the plot</button></div>';
}

function masterPeople(h) {
  const mine = peopleOf(h.id);
  return '<div class="card card-pad">' +
    '<div class="sectitle"><h3>Files at ' + esc(h.name) + '</h3>' +
      '<span class="hint">The home enters these, not you</span></div>' +
    '<div class="scroller"><table class="tbl"><thead><tr><th>Name</th><th>Case</th><th>Signs in with</th><th>Kind</th><th>State</th></tr></thead><tbody>' +
      (mine.length ? mine.map((p) => '<tr>' +
        '<td><b>' + esc(fullName(p)) + '</b></td><td class="mono">' + esc(p.no) + '</td>' +
        '<td class="mono">' + esc(p.dob) + '</td>' +
        '<td class="tiny">' + esc(p.kind) + '</td>' +
        '<td>' + (!isDead(p) ? '<span class="pill pill-accent">Living, planning</span>'
          : '<span class="pill pill-quiet">' + esc(p.status) + '</span>') + '</td></tr>').join("")
        : '<tr><td colspan="5" class="muted small">No files yet.</td></tr>') +
    '</tbody></table></div>' +
    '<p class="small muted" style="margin-top:12px">You never type a dead person’s name. The home does, in <b>Director</b>, and the moment they do, the schedule this home chose starts running and the family can sign in.</p></div>';
}

function privacyNote() {
  return '<div class="card card-pad" style="margin-top:24px;border-color:color-mix(in oklab,var(--seal) 34%,transparent);background:var(--seal-wash)">' +
    '<div class="sectitle"><h3>The sealed notes, and how they are actually kept private</h3></div>' +
    '<p class="small" style="max-width:74ch;line-height:1.65">You asked how to make a note private to one family member, and floated the director handing out passwords at the funeral. Do not do that one: the moment a director can hand over the word, the director has the word, and so does anyone who reads the file, steals the database, or serves you with a subpoena. A note the funeral home can open is not a private note — it is a note with a doorman.</p>' +
    '<p class="small" style="max-width:74ch;line-height:1.65;margin-top:10px">What makes it real is that the word never reaches your server at all. The writer types it while they are alive; the note is encrypted <b>in their browser</b>; only the scrambled version is ever sent to you. You store something you cannot read. The recipient types the same word and it unscrambles on <b>their</b> phone. There is no reset, no support route and no security question — because the person this is designed to keep out is not a stranger, it is somebody who knows the dead person’s address, mother’s maiden name and which hospital they were in.</p>' +
    '<p class="small" style="max-width:74ch;line-height:1.65;margin-top:10px">Which leaves one real problem: getting the word to the right person. Three ways that work, in order:</p>' +
    '<ul class="small" style="max-width:74ch;line-height:1.65;margin-top:8px;padding-left:20px">' +
      '<li><b>A shared memory as the clue, told to nobody.</b> “The town we broke down in, 1987.” The recipient already knows it and it is in no database. This is the default here, and it is the one that needs no process at all.</li>' +
      '<li><b>A sealed envelope in the home’s safe.</b> Printed at the time of writing, one per person, never opened by the home. A funeral home already has a safe and already handles signed originals — this fits work they are good at, and the director hands over an envelope without knowing what is in it.</li>' +
      '<li><b>Told in life.</b> “If anything happens, the word is the dog’s name.” Simplest, and the most likely to be forgotten.</li>' +
    '</ul>' +
    '<p class="small" style="max-width:74ch;line-height:1.65;margin-top:10px">Say the cost out loud, at the moment of writing, in plain words: <b>forget the word and the note is gone.</b> Not recoverable by you, by the home, or by anybody. People accept that trade readily when it is explained — it is the same bargain as a safe deposit box — and they are furious when it is discovered afterwards.</p>' +
    '<p class="small muted" style="max-width:74ch;line-height:1.65;margin-top:10px">In this demonstration the word is simply compared, because it is a demonstration and there is no server. The button that shows you the answer exists for the same reason.</p>' +
  '</div>';
}

/* ================================================================ shell === */

const VIEWS = [
  ["master",   "0 · Master"],
  ["door",     "1 · Sign-in"],
  ["plan",     "2 · Planning ahead"],
  ["family",   "3 · The family"],
  ["director", "4 · The director"]
];

function render() {
  $("#views").innerHTML = VIEWS.map(([k, l]) =>
    '<button data-act="view" data-k="' + k + '" aria-pressed="' + (state.view === k) + '">' + l + '</button>').join("");

  $("#railToday").textContent = state.day < -300
    ? "Three years before Margaret dies — " + fmtFull(now())
    : "Today is " + fmtDay(now());

  $("#stops").innerHTML = STOPS.map((s) =>
    '<button class="stop" data-act="stop" data-d="' + s.d + '" aria-current="' + (state.day === s.d) + '">' +
      '<span class="n">' + esc(s.n) + '</span><span class="t">' + esc(s.t) + '</span></button>').join("");

  const body =
    state.view === "master" ? viewMaster() :
    state.view === "door"   ? viewDoor() :
    state.view === "plan"   ? viewPlan() :
    state.view === "family" ? viewFamily() : viewDirector();

  $("#stage").innerHTML = body +
    '<div class="foot-note">A demonstration. Every person, funeral home, price and figure here is invented. ' +
    'Nothing you type leaves this page or is stored anywhere — reload and it is back at the beginning.</div>';

  let t = document.getElementById("toastEl");
  if (state.toast) {
    if (!t) { t = document.createElement("div"); t.id = "toastEl"; t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = state.toast;
  } else if (t) { t.remove(); }
}

/* The person the current screen is about. */
function subject() {
  if (state.view === "family") return personById((state.session && state.session.personId) || "hale");
  if (state.view === "plan") return personById("pryor");
  return personById(state.dirPerson);
}
function subjectHome() { return homeById(subject().homeId); }
function masterOrDirHome() {
  return state.view === "master" ? (homeById(state.masterHome) || state.homes[0]) : subjectHome();
}
const val = (id) => { const e = $("#" + id); return e ? e.value.trim() : ""; };

/* ---------------------------------------------------------------- click -- */

document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-act]");
  if (!el) return;
  if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.tagName === "LABEL") return;
  const a = el.dataset.act;
  const A = {

  view() { state.view = el.dataset.k; if (state.view === "door") { state.session = null; state.doorPick = null; } render(); },
  stop() { state.day = Number(el.dataset.d); render(); },

  "door-home"() { state.doorHome = el.dataset.id; state.doorPick = null; render(); },
  "door-back"() { state.doorHome = null; state.doorPick = null; render(); },
  "door-pick"() { state.doorPick = el.dataset.id; state.doorTyped = ""; state.doorError = null; render(); const i = $("#dobInput"); if (i) i.focus(); },
  "door-preplan"() { state.view = "plan"; state.planStep = "who"; toast("This is what somebody arranging their own funeral opens."); },
  "dob-hint"() { state.doorTyped = personById(state.doorPick).dob; render(); },
  "dob-submit"() {
    const p = personById(state.doorPick);
    if ((state.doorTyped || "").trim() !== p.dob) {
      state.doorError = "That is not the date of birth we have for " + p.first + ". Check the notice, or ring us on " + homeById(p.homeId).phone + ".";
      render(); return;
    }
    state.session = { personId: p.id, as: "family" };
    state.view = "family"; state.familyTab = "hub"; state.doorError = null;
    toast("Signed in as " + p.nok + ".");
  },
  "sign-out"() { state.session = null; state.doorPick = null; state.doorTyped = ""; state.view = "door"; render(); },
  "goto-director"() { const p = subject(); state.dirHome = p.homeId; state.dirPerson = p.id; state.view = "director"; render(); },
  "open-as-family"() { state.session = { personId: el.dataset.id, as: "family" }; state.view = "family"; state.familyTab = "hub"; render(); },
  "preview-home"() { state.doorHome = el.dataset.id; state.doorPick = null; state.view = "door"; render(); },

  "fam-tab"() { state.familyTab = el.dataset.tab; render(); },
  "dir-tab"() { state.dirTab = el.dataset.tab; render(); },
  "master-tab"() { state.masterTab = el.dataset.tab; render(); },
  "plan-step"() { state.planStep = el.dataset.k; render(); },
  "master-home"() { state.masterHome = el.dataset.id; render(); },
  "dir-home"() { state.dirHome = el.dataset.id; state.dirPerson = (peopleOf(el.dataset.id)[0] || {}).id; state.dirTab = "overview"; render(); },
  "open-case"() { state.dirPerson = el.dataset.id; state.dirTab = "overview"; render(); },

  "toggle-step"() {
    const p = subject(), h = subjectHome();
    const s = h.schedule.find((x) => x.id === el.dataset.id);
    if (p.done[s.id]) { delete p.done[s.id]; delete p.frozen[s.id]; }
    else { p.frozen[s.id] = dueDate(p, s); p.done[s.id] = now(); }
    render();
  },
  "toggle-photo"() {
    const p = subject(), x = p.photos.find((q) => q.id === el.dataset.id);
    x.sel = !x.sel;
    x.pos = x.sel ? Math.max(0, ...p.photos.map((q) => q.pos)) + 1 : 0;
    render();
  },
  "add-photo"() {
    const p = subject();
    p.photos.push({ id: uid("ph"), label: "From " + p.nok.split(" ")[0] + "’s camera roll", tone: Math.floor(Math.random() * 360), sel: false, pos: 0, from: p.nok.split(" ")[0] });
    toast("Added. In the product this is a real upload — an iPhone HEIC comes back as a JPEG.");
  },
  "choose-item"() { const p = subject(); const id = el.dataset.id; if (p.chosen[id]) delete p.chosen[id]; else p.chosen[id] = true; render(); },
  "take-slot"() {
    const p = subject(), h = subjectHome();
    const s = h.slots.find((x) => x.id === el.dataset.id);
    if (s.taken) return;
    s.taken = p.id;
    toast("Booked. " + h.director + " sees it straight away.");
  },
  "fam-send"() {
    const p = subject(), h = subjectHome(), b = val("famMsg");
    if (!b) { toast("Write something first."); return; }
    p.messages.push({ who: "fam", at: state.day, body: b });
    toast("Sent. It will be read when the office opens at " + h.opens + ".");
  },
  "dir-send"() {
    const p = subject(), b = val("dirMsg");
    if (!b) { toast("Write something first."); return; }
    p.messages.push({ who: "home", at: state.day, body: b });
    toast("Sent to " + p.nok + ".");
  },
  "care-yes"() { subject().aftercare = "on"; toast("Enrolled. Four letters over the next year."); },
  "care-no"() { subject().aftercare = "declined"; toast("Declined. We will not ask again."); },
  "care-reset"() { subject().aftercare = "pending"; render(); },

  "seal-hint"() {
    const p = subject(), z = p.sealed.find((x) => x.id === el.dataset.id);
    state.sealTry[z.id] = z.pass; state.sealErr[z.id] = false; render();
  },
  "seal-open"() {
    const p = subject(), z = p.sealed.find((x) => x.id === el.dataset.id);
    const typed = (state.sealTry[z.id] || "").trim().toLowerCase();
    if (typed !== z.pass.toLowerCase()) { state.sealErr[z.id] = true; render(); return; }
    state.openSealed[z.id] = true; state.sealErr[z.id] = false;
    toast("Open. Only on this phone, and only for " + z.forWhom + ".");
  },
  play() { toast("A real recording in the product. Here, the transcript underneath is what he says."); },

  flag() { state.editingFlag = el.dataset.key; render(); const t = document.querySelector('[data-act="flag-text"]'); if (t) t.focus(); },
  "flag-save"() {
    const p = subject(), key = el.dataset.key;
    const box = document.querySelector('[data-act="flag-text"][data-key="' + key + '"]');
    p.flags[key] = (box && box.value.trim()) || "We still need this one.";
    state.editingFlag = null;
    toast("Sent back to " + p.nok + " — look at the family’s Paperwork tab.");
  },
  unflag() { delete subject().flags[el.dataset.key]; render(); },

  "add-step"() {
    const h = masterOrDirHome(), t = val("stTitle"), o = Number(val("stOff"));
    if (!t || !Number.isFinite(o)) { toast("Needs a name and a number of days."); return; }
    h.schedule.push({ id: uid("s"), title: t, off: Math.trunc(o), anchor: val("stAnchor") || "service", desc: null, event: false });
    toast("Added. Every family at " + h.name + " sees it now.");
  },
  "del-step"() {
    const h = masterOrDirHome();
    h.schedule = h.schedule.filter((s) => s.id !== el.dataset.id);
    state.people.forEach((p) => { delete p.done[el.dataset.id]; delete p.frozen[el.dataset.id]; });
    render();
  },

  "add-slot"() {
    const h = masterOrDirHome();
    h.slots.push({ id: uid("a"), day: Number(val("slotDay")), time: val("slotTime"), mins: 30, what: val("slotWhat") || "Appointment", taken: null });
    toast("Offered. It is on the family’s page now.");
  },
  "del-slot"() { const h = masterOrDirHome(); h.slots = h.slots.filter((s) => s.id !== el.dataset.id); render(); },

  "add-item"() {
    const h = masterOrDirHome(), n = val("itName"), pr = Number(val("itPrice"));
    if (!n || !Number.isFinite(pr)) { toast("Needs a name and a price."); return; }
    h.inventory.push({ id: uid("i"), name: n, price: Math.round(pr), kind: val("itKind") || "Urn", desc: val("itDesc") || "—", glyph: "⚱" });
    toast("On the storefront. Look at a family’s Urns tab.");
  },
  "del-item"() { const h = masterOrDirHome(); h.inventory = h.inventory.filter((i) => i.id !== el.dataset.id); render(); },

  "add-plot"() {
    const h = masterOrDirHome(), s = val("plSection"), no = val("plNo"), pr = Number(val("plPrice"));
    if (!s || !no || !Number.isFinite(pr)) { toast("Needs a section, a number and a price."); return; }
    h.plots.push({ id: uid("g"), section: s, no: no, price: Math.round(pr), kind: val("plKind") || "Full burial", desc: val("plDesc") || "—" });
    toast("Added to " + h.cemetery + ".");
  },
  "del-plot"() { const h = masterOrDirHome(); h.plots = h.plots.filter((g) => g.id !== el.dataset.id); render(); },
  "pick-plot"() { subject().plot = el.dataset.id || null; render(); },

  "toggle-attach"() { const h = masterOrDirHome(); const f = h.forms.find((x) => x.id === el.dataset.id); f.attached = !f.attached; render(); },
  "toggle-preplan"() { const h = masterOrDirHome(); const f = h.forms.find((x) => x.id === el.dataset.id); f.preplan = !f.preplan; render(); },
  "delete-form"() {
    const h = masterOrDirHome();
    h.forms = h.forms.filter((f) => f.id !== el.dataset.id);
    toast("Deleted from " + h.name + "’s library.");
  },
  "rename-form"() {
    const h = masterOrDirHome(), id = val("fmPick"), n = val("fmNew");
    if (!n) { toast("Type the new name first."); return; }
    const f = h.forms.find((x) => x.id === id);
    if (f) { f.name = n; toast("Renamed."); }
  },

  "add-home"() {
    const n = val("nhName");
    if (!n) { toast("Give the home a name."); return; }
    const h = makeHome({
      name: n, city: val("nhCity") || "Longmont", region: "CO", postal: "80501",
      line1: "1 Main Street", director: val("nhDir") || "The director",
      phone: val("nhPhone") || "(000) 555-0000", urgent: val("nhPhone") || "(000) 555-0000",
      accent: ($("#nhAccent") && $("#nhAccent").value) || "#3A5A78",
      initials: n.split(/\s+/).map((w) => w[0]).join("").slice(0, 3).toUpperCase(),
      cemetery: n + " Cemetery"
    });
    h.inventory = []; h.plots = [];
    state.homes.push(h);
    state.masterHome = h.id; state.masterTab = "brand";
    toast(n + " is live. They are on the sign-in page now.");
  },

  "add-person"() {
    const h = homeById(state.dirHome);
    const name = val("npName"), dob = val("npDob");
    if (!name || !dob) { toast("A name and a date of birth, at minimum."); return; }
    const parts = name.split(/\s+/);
    const svcIn = Number(val("npSvc"));
    const p = makePerson({
      homeId: h.id, no: "26-" + String(400 + state.people.length).padStart(4, "0"),
      first: parts[0], middle: parts.length > 2 ? parts.slice(1, -1).join(" ") : "", last: parts[parts.length - 1],
      dob: dob, born: new Date(1940, 0, 1), diedDay: state.day, openedDay: state.day,
      serviceDay: state.day + (Number.isFinite(svcIn) ? svcIn : 5), serviceHour: 10,
      serviceWhere: h.name + " chapel", disposition: "To be decided",
      nok: val("npNok") || "Next of kin", rel: "Family", nokPhone: h.phone
    });
    state.people.push(p);
    state.dirPerson = p.id; state.dirTab = "overview";
    toast(name + "’s file is open. The schedule started from today.");
  },

  "record-death"() {
    const p = personById(el.dataset.id);
    p.diedDay = state.day; p.openedDay = state.day;
    p.serviceDay = state.day + 5; p.kind = "pre-need"; p.status = "open";
    toast(p.first + "’s death is recorded. His file was already waiting — open it as his family.");
  },
  "case-status"() {
    const p = personById(el.dataset.id);
    p.status = el.dataset.to;
    toast(p.status === "closed"
      ? "Closed. " + p.nok + " is now asked about aftercare — see the family’s Afterwards tab."
      : shortName(p) + " — " + p.status + ".");
  },
  "move-service"() {
    const p = subject();
    p.serviceDay += Number(el.dataset.by);
    toast("Moved to " + fmtDay(serviceAt(p)) + ". Every unfinished step moved with it; anything already done stayed put.");
  },

  "add-letter"() {
    const p = subject(), t = val("letTitle"), b = val("letBody");
    if (!t || !b) { toast("Needs a title and something to say."); return; }
    p.letters.push({ id: uid("l"), title: t, forWhom: "Everyone", day: state.day, body: b.split(/\n{2,}/) });
    toast("Added. Everyone who opens his file will read it.");
  },
  "add-sealed"() {
    const p = subject();
    const who = val("szWho"), pass = val("szPass"), body = val("szBody");
    if (!who || !pass || !body) { toast("Needs a person, a word and something to say."); return; }
    p.sealed.push({ id: uid("z"), forWhom: who, rel: val("szRel") || "Family", hint: val("szHint") || "A word only you two know", pass: pass, body: body.split(/\n{2,}/) });
    toast("Sealed for " + who + ". Nobody else can open it — including " + subjectHome().name + ".");
  },
  "del-sealed"() { const p = subject(); p.sealed = p.sealed.filter((z) => z.id !== el.dataset.id); render(); },

  "say-pdf"() { toast("In the product this saves a filled PDF. Here it is a demonstration."); },
  "say-pack"() { toast("A folder, numbered in slideshow order, with captions.txt. Real in the product."); }
  };

  if (A[a]) { ev.preventDefault(); A[a](); }
});

/* ---------------------------------------------------------------- input -- */

document.addEventListener("input", (ev) => {
  const el = ev.target.closest("[data-act]");
  if (!el) return;
  const a = el.dataset.act;

  if (a === "dob-type")  { state.doorTyped = el.value; state.doorError = null; return; }
  if (a === "seal-type") { state.sealTry[el.dataset.id] = el.value; state.sealErr[el.dataset.id] = false; return; }
  if (a === "own-plot")  { subject().ownPlot = el.value; return; }

  if (a === "form-field" || a === "plan-field") {
    const p = subject(), h = subjectHome();
    const f = h.forms.find((x) => x.id === el.dataset.form);
    const key = f.id + "." + el.dataset.key;
    p.answers[key] = el.value;
    if (!p.answeredBy[key]) p.answeredBy[key] = (a === "plan-field") ? "self" : "family";
    return;
  }

  if (a === "home-field")  { masterOrDirHome()[el.dataset.key] = el.value; softName(); return; }
  if (a === "home-accent") { masterOrDirHome().accent = el.value; applyAccent(el.value); return; }

  if (a === "step-title") { masterOrDirHome().schedule.find((s) => s.id === el.dataset.id).title = el.value; return; }
  if (a === "step-off") {
    const h = masterOrDirHome(), s = h.schedule.find((x) => x.id === el.dataset.id);
    const n = Number(el.value);
    if (!Number.isFinite(n)) return;
    s.off = Math.trunc(n);
    const cell = el.closest(".editline").querySelector(".resolved");
    if (cell) cell.textContent = fmtShort(dueDate(subject(), s));
    return;
  }
});

/* --------------------------------------------------------------- change -- */

document.addEventListener("change", (ev) => {
  const el = ev.target.closest("[data-act]");
  if (!el) return;
  const a = el.dataset.act;

  if (a === "step-anchor") {
    masterOrDirHome().schedule.find((s) => s.id === el.dataset.id).anchor = el.value;
    render(); return;
  }
  if (a === "home-logo" && el.files && el.files[0]) {
    const h = masterOrDirHome(), rd = new FileReader();
    rd.onload = () => { h.logo = rd.result; toast("Logo set. It is on their public page now."); };
    rd.readAsDataURL(el.files[0]); return;
  }
  if (a === "upload-form" && el.files && el.files[0]) {
    const h = masterOrDirHome();
    h.forms.push({
      id: uid("f"), name: el.files[0].name.replace(/\.[^.]+$/, ""), note: "Uploaded just now", attached: true, preplan: false,
      fields: [
        { k: "n1", label: "Full name", type: "text" },
        { k: "n2", label: "Relationship to the decedent", type: "text" },
        { k: "n3", label: "Anything we should know", type: "textarea" }
      ]
    });
    toast("In " + h.name + "’s library and attached. In the product we read the PDF’s own fields.");
    return;
  }
  if (a === "upload-video" && el.files && el.files[0]) {
    const p = subject();
    p.videos.push({ id: uid("v"), title: el.files[0].name.replace(/\.[^.]+$/, ""), forWhom: "Everyone",
      mins: "2:00", day: state.day, tone: Math.floor(Math.random() * 360),
      transcript: "Your own recording. In the product this plays; here the tile stands in for it." });
    toast("Recorded and held until the day.");
    return;
  }
  if (a === "form-field" || a === "plan-field" || a === "step-title") render();
});

function softName() {
  const h = masterOrDirHome();
  const n = document.querySelector(".crest .nm");
  if (n) n.textContent = h.name;
}

document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter") return;
  if (ev.target && ev.target.id === "dobInput") {
    ev.preventDefault();
    const b = document.querySelector('[data-act="dob-submit"]');
    if (b) b.click();
  }
  if (ev.target && ev.target.dataset && ev.target.dataset.act === "seal-type") {
    ev.preventDefault();
    const b = document.querySelector('[data-act="seal-open"][data-id="' + ev.target.dataset.id + '"]');
    if (b) b.click();
  }
});

render();
