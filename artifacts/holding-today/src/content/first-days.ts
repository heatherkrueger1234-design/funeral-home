import type { ChapterGroup } from "./types";

/**
 * The first days. Public, no sign-in.
 *
 * These are the questions that get asked in a hospital corridor at two in the
 * morning, when there is nobody to ask. Most of what is written for bereaved
 * parents starts a week later, when the decisions have already been made by
 * whoever was in the room. This starts before that.
 *
 * Two rules for anything added here:
 *
 * 1. Anything whose answer depends on where you live goes in a `law` block
 *    with the state named. Never in a paragraph. A parent in Ohio must not be
 *    quietly handed Colorado's rules.
 * 2. Say the plain thing. "You can ask to stay with them longer" is the
 *    sentence somebody needs. "Families may wish to consider spending
 *    additional time" is not.
 *
 * The chapters about the body and the autopsy have not yet been reviewed by a
 * funeral director or a medical examiner. That review is on the launch list in
 * replit.md and it is not optional.
 */

export const firstDaysIntro =
  "Nobody hands you this. These are the things that get decided in the first two or three days — most of them by whoever happens to be standing there, because no one told you they were yours to decide. They are yours. Almost all of them can wait longer than you are being told, and the few that genuinely cannot are marked.";

export const firstDaysGroups: ChapterGroup[] = [
  {
    heading: "Seeing them",
    blurb:
      "The decisions that close within hours or days, and that people will try to make for you.",
    chapters: [
      {
        id: "viewing",
        title: "Seeing them, holding them, and being told not to",
        summary:
          "What they will look like, what you are allowed to do, and why 'I wouldn't, if I were you' is not a rule.",
        body: [
          {
            kind: "p",
            text: "Somebody may tell you not to see your child. A doctor, a nurse, a police officer, a funeral director, your own mother. They are almost always trying to protect you, and they are giving you their judgement, not a rule. Unless there is a legal hold on the body — which is a specific thing, and they will say so — the decision is yours.",
          },
          {
            kind: "p",
            text: "Parents who chose to see their child overwhelmingly do not regret it, including in cases of traumatic death. Parents who were talked out of it often do regret it, and they cannot go back. That is not a reason to force yourself. It is a reason not to let someone else's flinch decide for you.",
          },
          { kind: "heading", text: "What they will look like" },
          {
            kind: "p",
            text: "They will look like themselves and not like themselves at the same time. That is the part nobody prepares you for. The face is right, and something behind it is gone.",
          },
          {
            kind: "list",
            items: [
              "They will be cold, and heavier than you expect. Skin feels different — firmer, waxy.",
              "Colour drains, and settles. The parts of them lying lowest may look bruised or purple. That is gravity, not injury.",
              "Within a few hours the body stiffens, and then over a day or so softens again. If they are stiff when you come, that passes.",
              "Their eyes and mouth may not close fully. Staff can help with this.",
              "There may be tubes, a breathing tube, IV lines, or tape still in place, especially after resuscitation was attempted. You can ask for those to be removed first, or for the sheet to be arranged so you see only their face and hands.",
              "After trauma, there may be injuries. You can ask the staff, plainly, what you will see before you go in. You can ask them to cover a specific part. You can ask to see only their hand.",
            ],
          },
          {
            kind: "note",
            text: "Ask, before you go in: what will I see? Somebody has already looked. Let them tell you.",
          },
          { kind: "heading", text: "What you are allowed to do" },
          {
            kind: "p",
            text: "Far more than anyone will offer. Hospitals and funeral homes rarely volunteer these things, and they will almost always say yes if you ask.",
          },
          {
            kind: "list",
            items: [
              "Hold them. Lie next to them. Get in the bed if it is a bed.",
              "Stay. Not five minutes — hours, if you need them. Ask for the room.",
              "Wash them. Comb their hair. Put their own clothes on them.",
              "Bring their brother or sister in, or their grandparents.",
              "Bring something of theirs to leave with them.",
              "Take photographs. This feels wrong to want and it is not wrong. Many parents who did not take any wish they had.",
              "Come back. Ask the funeral home for a second viewing later in the week, when the shock has moved and you can actually see them.",
            ],
          },
          {
            kind: "warn",
            text: "If the death is under investigation — an accident, an overdose, a crime, anything sudden and unexplained — the body may legally be in the coroner's or medical examiner's custody, and touching or washing may not be allowed until they release it. Ask specifically: is there a hold, and when is it expected to lift? A hold is temporary. It is not a refusal.",
          },
          {
            kind: "p",
            text: "If you cannot do it, that is not a failure, and it is not a thing you will have to defend for the rest of your life. Some parents know immediately that they need the last picture in their head to be their child alive. That is a real reason.",
          },
        ],
      },
      {
        id: "embalming",
        title: "Embalming or refrigeration",
        summary:
          "Embalming is almost never required by law. What each one actually means for seeing them, and for the bill.",
        body: [
          {
            kind: "p",
            text: "You will likely be told a viewing requires embalming. Usually that is the funeral home's policy, not the law.",
          },
          { kind: "heading", text: "Refrigeration" },
          {
            kind: "list",
            items: [
              "The body is held cold. Nothing is done to it.",
              "Holds well for several days, which is enough for most funerals and viewings.",
              "Much cheaper — commonly a modest daily rate rather than a several-hundred-dollar procedure.",
              "They will look cold, because they are. A refrigerated viewing looks less 'arranged' than an embalmed one.",
              "This is the option if you want a home vigil, a green burial, or simply nothing done to your child.",
            ],
          },
          { kind: "heading", text: "Embalming" },
          {
            kind: "list",
            items: [
              "Blood is replaced with preservative fluid. It is an invasive procedure, done without you there.",
              "Slows decomposition for longer, and allows more restorative work after trauma or a long illness.",
              "Costs several hundred to over a thousand dollars, before the cosmetic work that usually accompanies it.",
              "Makes a delayed funeral, an open casket days later, or transporting them a long distance more practical.",
              "It is not required for cremation, and it does not preserve anyone permanently.",
            ],
          },
          {
            kind: "law",
            state: "United States (federal)",
            text: "The FTC Funeral Rule requires funeral homes to give you an itemised price list, to let you buy only what you want, and to tell you in writing when embalming is not legally required. They may not charge you for embalming they did without your permission, except in limited circumstances. If a funeral home tells you embalming is 'required' and will not put that in writing, ask which law — and then ask a second funeral home.",
          },
          {
            kind: "law",
            state: "Most states",
            text: "No US state requires embalming for a body that is buried or cremated within the ordinary window, and refrigeration is an accepted alternative. Some states require embalming or refrigeration after a set number of days, or for transport across state lines, or in specific communicable-disease cases. Which applies to you is a state question — ask your state's funeral board or health department, not only the funeral home selling it.",
          },
          {
            kind: "note",
            text: "You can decline embalming and still have a viewing. Ask for it plainly: a private family viewing, refrigerated, no embalming. Funeral homes do this. Some will only do it for immediate family, and within a shorter window.",
          },
        ],
      },
      {
        id: "autopsy",
        title: "The autopsy",
        summary:
          "When it is required and when it is your choice, what is done, what they look like afterwards, and what is in the report.",
        body: [
          {
            kind: "warn",
            text: "This chapter says what is physically done to a child's body during an autopsy, and what is in the report. It is written plainly because parents ask for it plainly. There is nothing here you need to read today.",
          },
          { kind: "heading", text: "When it happens whether you agree or not" },
          {
            kind: "p",
            text: "A coroner or medical examiner can order an autopsy without the family's consent, and in these cases your permission is not required and refusing does not stop it. Broadly, that is when a death is sudden and unexplained, violent, an accident, a suspected overdose, a suicide, in custody, during or shortly after a procedure, or when nobody can certify a cause. Most sudden child deaths fall into at least one of those.",
          },
          {
            kind: "p",
            text: "You can still ask questions. You can ask why it is required, how long the body will be held, whether a limited examination would answer the question, and when they will be released to a funeral home. Some jurisdictions will consider a limited or external-only examination when the cause is not in doubt — it is worth asking, and the answer is often no.",
          },
          {
            kind: "law",
            state: "Varies by state and county",
            text: "Which deaths must be reported to a coroner or medical examiner, who has authority to order an autopsy over family objection, and whether a religious objection is recognised, are all set by state law and vary considerably. A few states have a formal religious-objection process. Ask the coroner's office directly, and ask them to name the statute.",
          },
          { kind: "heading", text: "When it is yours to decide" },
          {
            kind: "p",
            text: "If the death was expected, or a cause has already been certified, an autopsy may be optional — a private one, which you consent to and often pay for. Parents choose it when they need to know, when something does not add up, or when a genetic finding would matter for their other children. Parents decline it because they cannot bear anything more being done. Both are reasonable. It does not have to be decided in the corridor.",
          },
          { kind: "heading", text: "What is actually done" },
          {
            kind: "list",
            items: [
              "An external examination first: photographs, measurements, every mark on the body recorded.",
              "A Y-shaped incision on the torso, and the internal organs examined and sampled. Organs may be retained for further testing.",
              "Usually an examination of the brain, which requires an incision across the back of the scalp.",
              "Blood and fluid samples for toxicology. This is what takes weeks — the physical examination is done in hours, the report waits on the lab.",
              "The body is then closed with sutures, and released.",
            ],
          },
          { kind: "heading", text: "Seeing them afterwards" },
          {
            kind: "p",
            text: "You can still see them, and you can still have an open casket. The incisions are on the torso and the back of the head, and are covered by clothing and by how they are laid. With their hair combed and a collar, most families see nothing. Ask the funeral director what will be visible; they will know, because they will have received them.",
          },
          {
            kind: "p",
            text: "You can ask whether all organs were returned to the body before release, and what happens to anything retained. Some parents very much want to know this and are never told, because nobody thinks to say.",
          },
          { kind: "heading", text: "The report" },
          {
            kind: "p",
            text: "It usually takes weeks to a few months, mostly waiting on toxicology. As next of kin you can generally request a copy, though who may receive it and when varies by state — and if there is a criminal investigation it may be withheld until that closes.",
          },
          {
            kind: "p",
            text: "It is a clinical document. It describes your child by height and weight and organ mass. It names their tattoos and their scars. It describes their injuries in exact language, and if they were injured, it will tell you things about the last minutes of their life that you have been guessing at. Some parents need that more than anything. Some read one page and cannot unread it.",
          },
          {
            kind: "list",
            items: [
              "You do not have to read it today, or this year, or ever.",
              "You can have it sent to a doctor, a nurse friend, or a grief counsellor, and have them tell you the answer to your one actual question without you reading the rest.",
              "You can ask the medical examiner's office to explain it over the phone. Many will.",
              "Ask for it to arrive by post rather than email if you do not want it sitting in your inbox.",
              "Take it out of the house if you find you cannot stop rereading it.",
            ],
          },
          {
            kind: "note",
            text: "There is no reading of it that will change the answer. Whatever the report says, it will not tell you it was preventable by you.",
          },
        ],
      },
    ],
  },
  {
    heading: "The things that close fast",
    blurb:
      "Almost nothing in the first week is urgent. These few things genuinely are, and no one tells you until they have passed.",
    chapters: [
      {
        id: "closing-fast",
        title: "What to take from them before you cannot",
        summary:
          "Hair, handprints, fingerprints, photographs, voicemails. Each with the window it closes in.",
        body: [
          {
            kind: "p",
            text: "This is the one page in this guide that is genuinely time-sensitive. Everything else can wait. These cannot, and parents find out about them a month late, which is the cruellest possible time to find out.",
          },
          {
            kind: "p",
            text: "You do not have to want these things now. Take them anyway and put them in a drawer. The version of you in three years may want them very badly, and you cannot go back for them.",
          },
          {
            kind: "checklist",
            items: [
              {
                text: "A lock of their hair. Ask the hospital, the funeral home, or the medical examiner's office. Ask for more than you think you want, and from underneath where it will not show if there is a viewing.",
                deadline: "Before cremation or burial. Ask on the first day.",
              },
              {
                text: "Hand and foot moulds or prints. Most funeral homes can do this, many hospitals can, and there are services that do nothing else. Ask for prints even if you do not want a cast.",
                deadline:
                  "Within roughly the first few days, and always before cremation or burial.",
              },
              {
                text: "A fingerprint, taken specifically for jewellery — a print pressed into silver, a ring, a pendant. Funeral homes take these, but usually only if asked before they proceed.",
                deadline: "Before cremation or burial.",
              },
              {
                text: "Photographs of them. Of their hands. Of the freckle on their shoulder. Some parents want photographs of them at the funeral home, and that is allowed, and it is more common than you think.",
                deadline: "Before the funeral. Nobody will offer.",
              },
              {
                text: "Save every voicemail they left you, immediately, off the phone. Carriers delete old voicemail on their own schedule and the recording is gone when they do. Record it playing on speaker with another phone, today, before doing anything cleverer.",
                deadline:
                  "Now. Some carriers delete voicemail after 30 days, some sooner.",
              },
              {
                text: "Keep their phone number alive. Keep paying that line — it is usually a few dollars a month — so the voicemail greeting in their voice keeps answering. Parents call it for years.",
                deadline:
                  "Before the next billing cycle, or the number is reassigned.",
              },
              {
                text: "Videos, and their voice in the background of other people's videos. Ask family and friends now, while everyone is gathered and willing, for anything they have. In six months they will have new phones.",
                deadline: "Ask in the first weeks, while people are still asking what they can do.",
              },
              {
                text: "Do not wash the clothes, or the pillowcase, or the hoodie. Put them in a sealed bag. Their smell is a real thing and it does not last.",
                deadline:
                  "Before anyone tidies. Tell people, out loud, not to wash anything.",
              },
              {
                text: "Get into their phone, laptop and accounts, or at least write down where they are. Their photographs and messages are in there. Once an account is locked or auto-deleted, recovering it means lawyers, and often means never.",
                deadline:
                  "As soon as you can. Deletion policies for inactive accounts run from months to a couple of years.",
              },
              {
                text: "If donation is a possibility, it is decided in hours, not days — see the donation chapter.",
                deadline: "Hours.",
              },
            ],
          },
          {
            kind: "note",
            text: "If you can only manage one thing off this list today: keep the phone line paid, and do not let anyone wash anything.",
          },
        ],
      },
      {
        id: "donation",
        title: "Organ and tissue donation",
        summary:
          "A short window, an early phone call, and what donation does and does not rule out.",
        body: [
          {
            kind: "p",
            text: "If donation is possible, someone will call you very early, sometimes within an hour. It can feel monstrous — a stranger asking about your child's body while you are still standing up. They are calling then because the window is genuinely that short.",
          },
          { kind: "heading", text: "The timing, roughly" },
          {
            kind: "list",
            items: [
              "Organs — heart, lungs, liver, kidneys — are usually only possible when someone dies in hospital on a ventilator, because the organs need circulation until recovery. That is a window of hours.",
              "Tissue — corneas, skin, bone, heart valves, tendons — can often be recovered for a day or so after death, and does not require a ventilator. This is why a family who was told 'no organ donation' may still be asked about tissue.",
              "Whole-body donation to a medical school or research programme is a separate thing with its own paperwork, usually arranged directly with the institution, and often needs to happen quickly too.",
            ],
          },
          { kind: "heading", text: "What it does not stop" },
          {
            kind: "list",
            items: [
              "You can still have an open casket. Recovery is surgical, and incisions are placed and closed with that in mind.",
              "It does not usually delay the funeral by more than a day.",
              "It does not cost the family anything. You are not billed for recovery.",
              "It does not prevent an autopsy — the medical examiner and the recovery agency coordinate.",
            ],
          },
          {
            kind: "law",
            state: "Most states",
            text: "If your child was over 18 and registered as a donor — a mark on a driving licence, or a state registry — that registration is legally a decision they made, and it generally stands on its own. In practice agencies work with families rather than over them, but you may be told the decision was already made. For a child under 18, the decision is the parents'.",
          },
          {
            kind: "p",
            text: "You are allowed to say no. Parents say no because they cannot bear one more thing being done, and that is a whole reason. You are also allowed to say yes to some things and not others — corneas but not skin, say. Ask; the list is itemised.",
          },
          {
            kind: "note",
            text: "If you say yes, you can usually write to the recipients later, anonymously, through the agency. Some parents need that years afterwards. Keep the agency's name and case number.",
          },
        ],
      },
      {
        id: "belongings-from-the-hospital",
        title: "Getting their things back",
        summary:
          "The bag from the hospital, what the police keep and for how long, and how to ask for the clothes.",
        body: [
          {
            kind: "p",
            text: "Somewhere there is a plastic bag with their clothes in it, and their phone, and whatever was in their pockets. Nobody will bring it to you. You have to ask, and if you do not ask, in some places it is eventually disposed of.",
          },
          { kind: "heading", text: "From the hospital" },
          {
            kind: "list",
            items: [
              "Ask for 'patient belongings' or 'personal effects', and ask at the ward or the nursing supervisor, not the front desk.",
              "There may be two piles: what came off them in the room, and what was cut off during resuscitation. Ask for both. Clothing cut off in an emergency is often bagged separately and thrown away by default.",
              "Ask for their jewellery specifically, by item. Rings sometimes come off and go into a safe rather than the bag.",
              "If they were an inpatient, check the room, the locker and the bedside drawer yourself if you can bear to. Things get missed.",
            ],
          },
          { kind: "heading", text: "From the police or the medical examiner" },
          {
            kind: "list",
            items: [
              "If anything is evidence, it is held until the investigation closes — which after a criminal case can be years, not months.",
              "Ask for a property receipt and a property number now. Without it, tracing an item later is very hard.",
              "Ask specifically whether the phone is being held, whether it will be searched, and whether you can get a copy of the photographs off it in the meantime. Sometimes they will.",
              "Ask what happens to blood-stained or damaged clothing. Some agencies destroy it as biohazard by default. If you want it, say so in writing and say so early — parents do want it, and it surprises people.",
              "Put a calendar reminder to ask again in three months. Property gets released without anybody calling you.",
            ],
          },
          {
            kind: "warn",
            text: "Ask before anyone helpfully cleans out a car, a locker, or a room. Families lose more to a well-meaning relative tidying up in week one than to any institution.",
          },
        ],
      },
    ],
  },
  {
    heading: "The funeral, and what it costs",
    blurb:
      "You are about to be sold something, while grieving, on a deadline. Almost none of it is required.",
    chapters: [
      {
        id: "cheapest",
        title: "If there is no money",
        summary:
          "Direct cremation, Costco caskets, state assistance, cemetery help, and what a funeral home may not require.",
        body: [
          {
            kind: "p",
            text: "The average American funeral runs into many thousands of dollars. Almost none of that is legally required, and a funeral home is not allowed to tell you otherwise. This is not a lesser way to bury your child. It is the same child.",
          },
          { kind: "heading", text: "The cheapest real options" },
          {
            kind: "list",
            items: [
              "Direct cremation. No embalming, no viewing, no funeral-home ceremony — they are collected, cremated, and returned to you. Typically the lowest-cost option by a wide margin. You can hold whatever memorial you want afterwards, anywhere, for free, whenever you are ready.",
              "Immediate burial. The same idea for burial: no embalming, no viewing, a simple container. The cemetery plot and the opening fee are then usually the largest cost.",
              "Buy the casket somewhere else. Costco, Walmart and online sellers ship caskets, often for a fraction of the funeral home's price, sometimes next-day.",
              "Skip the burial vault unless the cemetery requires one — many do, and it is a cemetery rule rather than a law. Ask, and ask what the cheapest acceptable one is.",
              "Do less at the funeral home and more yourself. Print the programme at home. Have the service at a church, a park, a garage, a backyard.",
            ],
          },
          {
            kind: "law",
            state: "United States (federal)",
            text: "Under the FTC Funeral Rule, a funeral home must give you an itemised General Price List before discussing arrangements, must quote prices over the phone if you ask, must let you buy individual items rather than a package, and may not charge a handling fee for a casket you bought elsewhere or refuse to use it. If any of that is not happening, it is a violation, and saying so out loud usually resolves it.",
          },
          { kind: "heading", text: "Help that exists" },
          {
            kind: "list",
            items: [
              "State and county funeral assistance. Many states and counties have a burial or cremation assistance fund for low-income families, often administered by human services or the county. Amounts are modest and the paperwork is real, but it exists. Ask the county human services office, and ask the funeral home which programme they usually bill.",
              "Crime victim compensation, if the death was a crime. These funds commonly cover several thousand dollars of funeral costs, and they are not means-tested in most states. See the page on public or criminal deaths.",
              "If your child was a minor covered by a parent's insurance or a school policy, or was employed, check for small accidental-death benefits nobody mentions.",
              "Some cemeteries and funeral homes quietly donate infant and child plots or services. It is very often not advertised. Ask directly: is there anything you can do for a child. People say yes more than you expect.",
              "Churches, unions, fraternal organisations and employers frequently have small hardship funds.",
              "A crowdfunding page. Someone else should set it up and run it — a sibling, a friend, a coworker. It should not be you.",
            ],
          },
          {
            kind: "warn",
            text: "Do not sign a payment plan or take a loan in the first week. Funeral homes will wait, assistance takes weeks to arrive and is often paid retroactively, and a decision made in this state of mind about several thousand dollars is one you will be living with for years.",
          },
          {
            kind: "note",
            text: "You are allowed to ring three funeral homes and ask each one for their price for a direct cremation. It is a five-minute phone call and the difference between them is routinely thousands of dollars.",
          },
        ],
      },
      {
        id: "home-funeral",
        title: "Keeping them at home, and burying them on your own land",
        summary:
          "Home vigils and home burial are legal in most of the US. What that actually requires, marked by state.",
        body: [
          {
            kind: "p",
            text: "In most of the United States you may keep your child at home after they die, care for their body yourself, and hold a vigil for a few days. Most people have no idea this is permitted, because for a century it has not been the custom and there is an industry with no reason to mention it.",
          },
          { kind: "heading", text: "A home vigil, in practice" },
          {
            kind: "list",
            items: [
              "The body is kept cool — a cool room, dry ice or gel packs beneath and beside the torso, curtains drawn, no heating. This is what makes several days possible.",
              "You wash and dress them yourself, or with help. Families describe this as the single thing they were most glad they did.",
              "You will still need the death certificate signed and filed, and in most states a permit before the body is buried, cremated or transported.",
              "Home funeral guides exist for exactly this, and the National Home Funeral Alliance can point you to one near you. Many funeral homes will also do part of it and let you do the rest — you do not have to choose all or nothing.",
            ],
          },
          {
            kind: "law",
            state: "Most states",
            text: "Home funerals — a family caring for their own dead without a funeral director — are legal in the large majority of US states. A minority require a licensed funeral director for specific steps, most often filing the death certificate or transporting the body. Which steps, if any, is a state-by-state question. Confirm with your state's vital records office before assuming either way.",
          },
          {
            kind: "law",
            state: "Colorado",
            text: "Colorado is among the most permissive states for family-directed funerals: families may care for and transport their own dead, and historically Colorado did not license funeral directors at all. That is changing — Colorado passed legislation in 2024 to license funeral establishments and practitioners, phasing in over following years, after the abuses at several Colorado funeral homes. Family-directed care is not what that law was aimed at, but the rules around it are actively moving. Confirm the current position with the Colorado Department of Public Health and Environment's vital records office before relying on anything here.",
          },
          { kind: "heading", text: "Burial on your own land" },
          {
            kind: "p",
            text: "Home burial is legal in most states, and is governed far more by the county than by the state. The state sets a few conditions; the county decides whether it happens.",
          },
          {
            kind: "list",
            items: [
              "Expect requirements about distance from water sources, wells, and property lines, and about depth.",
              "Expect the burial to have to be recorded — on the deed, with the county, or on a plat — so that the grave is documented for every future owner of the land.",
              "Zoning is usually the real obstacle. Rural and unincorporated land is where this is realistic; inside city limits it very often is not.",
              "Think about what happens when you sell. Parents have found themselves unable to move, or unable to bear to.",
            ],
          },
          {
            kind: "law",
            state: "Colorado",
            text: "Colorado permits burial on private land, subject to county rules — and the county rules are the whole question. Requirements commonly include county land-use or zoning approval, minimum setbacks from water supplies and property lines, and recording the burial location with the county so it appears on the land records. Call the county planning or land-use department and the county clerk and recorder before you plan anything, because the answer in one Colorado county is not the answer in the next.",
          },
          {
            kind: "law",
            state: "Everywhere",
            text: "Wherever you are, three things have to be true before a burial or cremation: the death certificate is signed by whoever is legally allowed to sign it, it is filed with the state within that state's deadline (commonly a small number of days), and a disposition or transit permit has been issued. Those are the mechanics that actually gate everything else, and the local registrar's office is the place that answers them.",
          },
          {
            kind: "note",
            text: "A green burial — no embalming, a shroud or a plain wooden box, no vault — is available at a growing number of conventional cemeteries, and needs no land of your own. It is often cheaper than a standard burial, not more expensive.",
          },
        ],
      },
      {
        id: "not-rushing",
        title: "You are allowed to wait",
        summary:
          "There is no deadline on a memorial. Doing it in five days is a custom, not a rule.",
        body: [
          {
            kind: "p",
            text: "Everyone will assume the service happens this week. Out-of-town family will ask what to book. Somebody will say it helps to have something to focus on. And so parents hold the largest gathering of their lives four days after the worst thing that has ever happened to them, and remember almost none of it.",
          },
          {
            kind: "p",
            text: "The body has to be dealt with fairly promptly. The memorial does not. Those are two different events and they have been glued together by habit.",
          },
          {
            kind: "list",
            items: [
              "Direct cremation or a simple burial now, and a memorial in three weeks, three months, or on their birthday.",
              "A tiny private goodbye now with six people, and something larger later, or never.",
              "A graveside gathering only, twenty minutes, no service.",
              "Nothing at all. Some families never hold one. That is allowed too.",
            ],
          },
          {
            kind: "p",
            text: "Waiting also means you can actually be there for it — choose the music, hear what people say, and remember it. Parents who waited very rarely regret it. Parents who were rushed frequently do.",
          },
          {
            kind: "note",
            text: "If you need a sentence for the people pushing: 'We're not doing the memorial yet. I'll tell you as soon as we set a date.' You do not have to explain it. Repeat it as many times as necessary.",
          },
        ],
      },
    ],
  },
  {
    heading: "Every way there is",
    blurb:
      "You are going to be offered two options. There are closer to a dozen, several of them cheaper, and nobody hands you the list.",
    chapters: [
      {
        id: "every-option",
        title: "The whole list, on one page",
        summary:
          "Every legal option in the US for what happens to their body, one line each, so you can see the shape of it before anyone starts selling.",
        body: [
          {
            kind: "p",
            text: "A funeral home will present you with burial or cremation, because those are the two things almost every funeral home sells. They are not the only two things that are legal. Some of what follows will not be available where you live, and some of it will sound wrong to you, and that is fine — the point is that you get to see the list before you choose, instead of finding out in a year that the thing you would have wanted existed the whole time.",
          },
          {
            kind: "list",
            items: [
              "Burial, conventional. A casket, a vault, a cemetery plot. The most expensive route by a wide margin, and the default almost everywhere.",
              "Green or natural burial. No embalming, a shroud or plain wooden box, no concrete vault. Legal in every state, available at a growing number of ordinary cemeteries, and usually cheaper than conventional burial rather than dearer.",
              "Conservation burial. A natural burial inside land that is permanently protected because of the burial. The closest real thing to becoming part of a forest.",
              "Home burial on your own land. Legal in most states, governed almost entirely by your county.",
              "Flame cremation. The most common alternative, and direct cremation is typically the cheapest option there is.",
              "Water cremation — alkaline hydrolysis. Water and alkali instead of fire. Returns more of them than flame does. Legal in about half the states and spreading.",
              "Natural organic reduction — human composting. Their body becomes roughly a cubic yard of living soil over a month or two. Legal in a growing handful of states, and you can send them to one from a state that has not legalised it.",
              "Open-air cremation on a pyre. Exists in exactly one place in the United States that is open to the public, in Colorado, and with real limits on who can use it.",
              "Burial at sea. Legal under a federal permit that you do not have to apply for, and you can do it yourself from a boat.",
              "Whole-body donation to a medical school or anatomical board. Usually free, including transport, with remains returned afterwards — but with real cautions, and often not available for children.",
              "Organ and tissue donation, which is a separate decision and a much faster one. It has its own chapter above.",
            ],
          },
          {
            kind: "note",
            text: "Roughly, cheapest first: home burial, direct cremation, green burial, water cremation, conventional cremation with a service, human composting, conventional burial. Regional variation is enormous — the same direct cremation can differ by thousands of dollars between two funeral homes in one city.",
          },
          {
            kind: "warn",
            text: "You do not have to decide today. Almost every option here remains open for days, and refrigeration buys more. The chapter on waiting is not sentiment; it is the practical advice.",
          },
        ],
      },
      {
        id: "green-burial",
        title: "Green and natural burial",
        summary:
          "No embalming, no vault, a shroud or a plain box. What it is, what it costs, and the rule that is a cemetery policy rather than a law.",
        body: [
          {
            kind: "p",
            text: "A natural burial is a burial without the things that were added in the last century and a half: no embalming fluid, no metal or hardwood casket, no concrete vault, no chemically maintained lawn. Your child is buried in a shroud or a simple biodegradable box, at a depth where the soil is still biologically active, and they break down and become part of the ground.",
          },
          {
            kind: "p",
            text: "Parents often assume this is an expensive boutique choice. It is usually the opposite. You are declining the three most expensive line items on the invoice.",
          },
          { kind: "heading", text: "The three kinds of ground" },
          {
            kind: "list",
            items: [
              "A hybrid cemetery: an ordinary cemetery with a section that permits natural burial. This is the most common and the easiest to find, and it means the rest of the family can still be buried nearby.",
              "A natural burial ground: the whole cemetery operates this way. Usually no upright headstones — a flat native stone, a GPS coordinate, a planted marker.",
              "A conservation burial ground: the same, but the land is held under a permanent conservation easement, and the burial fees fund protecting it. The grave is inside land that legally cannot be developed. There are not many of these, and people travel for them.",
            ],
          },
          {
            kind: "law",
            state: "Every US state",
            text: "No state requires embalming for a body buried within the ordinary window, and no state law requires a burial vault or grave liner. The vault is a cemetery policy — cemeteries require them so the ground does not settle and mowing stays easy. A cemetery is entitled to that rule, but it is their rule and not the law, and asking which it is will sometimes change the answer.",
          },
          {
            kind: "note",
            text: "The Green Burial Council certifies cemeteries and funeral homes to a published standard, and their directory is the fastest way to find what exists near you. If nothing does, ask a conventional cemetery directly whether they will permit a vault-free burial in an existing section. Some quietly will.",
          },
        ],
      },
      {
        id: "water-cremation",
        title: "Water cremation",
        summary:
          "Alkaline hydrolysis: water and alkali instead of fire. It returns more of them than flame cremation does, and it is legal in about half the country.",
        body: [
          {
            kind: "p",
            text: "Also called aquamation, flameless cremation, or alkaline hydrolysis. Your child is placed in a stainless steel vessel with water and a strong alkali, gently heated, for somewhere between four and sixteen hours. What is left is the bone mineral, which is dried and processed into a fine white powder and returned to you in exactly the way ashes are.",
          },
          {
            kind: "list",
            items: [
              "It returns roughly twenty to thirty per cent more than flame cremation, and the colour is paler — closer to white than to grey.",
              "It uses a small fraction of the energy of flame cremation, produces no smokestack emissions, and does not vaporise the mercury in dental fillings.",
              "It is gentler on anything you want back. Implants, plates and joint replacements come through intact and can be returned to you.",
              "Desmond Tutu chose it in 2021, which is why you may have heard of it at all.",
            ],
          },
          {
            kind: "warn",
            text: "One thing to know before you choose it rather than after. What remains of the liquid is sterile, and it is released into the wastewater system, the same as at a hospital. Some families find that unbearable and some find it no different from what happens to smoke. Nobody should learn it afterwards.",
          },
          {
            kind: "law",
            state: "Varies by state",
            text: "Roughly half of US states now permit alkaline hydrolysis for human remains, and more legalise it most years. Legality and availability are different problems: a state can permit it and have no operator within several hundred miles. Ask a funeral home directly whether they offer it or will arrange it, or ask the Cremation Association of North America who operates near you. Transporting your child to a provider in another state is permitted and is routinely done.",
          },
        ],
      },
      {
        id: "composting",
        title: "Human composting",
        summary:
          "Natural organic reduction: their body becomes about a cubic yard of soil over a month or two. Where it is legal, and how to use it from a state where it is not.",
        body: [
          {
            kind: "p",
            text: "Formally natural organic reduction, sometimes called terramation. Your child is laid in a vessel with wood chips, alfalfa and straw. Airflow, moisture and temperature are controlled, and the ordinary microbes that live on and in all of us do the rest over about thirty to sixty days, followed by a curing period. What comes back is soil. Not ashes, not a symbol — actual living soil.",
          },
          {
            kind: "warn",
            text: "It is far more than families picture. A full reduction yields roughly a cubic yard — several hundred pounds. Every provider will let you take as much or as little as you want, and will place the rest on protected conservation land in your child's name. Decide this in advance, because a truckload of soil arriving at a suburban house is a thing that has genuinely happened to people.",
          },
          { kind: "heading", text: "Where it is legal" },
          {
            kind: "p",
            text: "Washington was first, in 2019. Colorado, Oregon, Vermont, California, New York, Nevada, Arizona, Maryland, Delaware, Minnesota and Maine have followed, and more legislatures take it up every year. The list is genuinely moving, so treat any list — including this one — as out of date and check.",
          },
          {
            kind: "law",
            state: "Colorado",
            text: "Colorado legalised natural organic reduction in 2021, and attached conditions that are specific to Colorado: the resulting soil may not be sold, it may not be combined with another person's remains without consent, and it may not be used to grow food for human consumption. Providers will walk you through this. Confirm the current rules with the provider and with the Colorado Department of Public Health and Environment.",
          },
          {
            kind: "note",
            text: "If your state has not legalised it, this is still available to you. Providers accept bodies from anywhere in the country and usually arrange the transport themselves as part of the price. Living in the wrong state is a logistics problem here, not a closed door.",
          },
        ],
      },
      {
        id: "the-pyre",
        title: "The open-air pyre in Crestone, Colorado",
        summary:
          "The only public funeral pyre in the United States. What it actually is, and the residency limit you need to know before you let yourself hope.",
        body: [
          {
            kind: "p",
            text: "In Crestone, Colorado, in Saguache County, there is a piece of ground where a body is laid on a juniper wood pyre at dawn, wrapped in a natural-fibre shroud, and the family lights the fire. It has operated since the late 2000s, run by the Crestone End of Life Project, and it is the only open-air cremation site in the United States that is open to the general public rather than to a single religious community.",
          },
          {
            kind: "warn",
            text: "Read this part before you make a call. It primarily serves people who live in the local area — Crestone, the Baca Grande, and Saguache County. It is not a place you can send your child from another state. It performs a small number of cremations a year. Parents have found it, felt for the first time in weeks that they had found the right thing, and then been told no, and that is a specific cruelty this page would rather spare you.",
          },
          {
            kind: "list",
            items: [
              "No embalming. A shroud, no coffin, nothing synthetic.",
              "Metal implants and pacemakers must be removed beforehand.",
              "Some causes of death are excluded, and a death under investigation must be released first, like any other.",
              "The family and the community are present for the whole burn. It is not a service you drop off and collect from.",
            ],
          },
          {
            kind: "p",
            text: "A true Viking funeral — a burning boat pushed out onto the water — is not legal anywhere in the United States, and it is worth saying plainly because it is the thing people picture. You may not burn a body outside a licensed crematory or an approved site, and you may not set a fire adrift on navigable water. Burial at sea, in the next chapter, is the legal version of that impulse, and it is more available than almost anyone realises.",
          },
          {
            kind: "note",
            text: "Open-air cremation is practised elsewhere in the US under narrower arrangements, mostly within specific Hindu and Buddhist communities, and other states have seen proposals. If this is what your family's faith asks for, that is a conversation with your own community first — the legal position is far more workable for a religious practice than for an individual request.",
          },
        ],
      },
      {
        id: "at-sea",
        title: "Burial at sea",
        summary:
          "Legal across the whole country under a federal permit you do not have to apply for, for a whole body or for ashes, and you can do it yourself.",
        body: [
          {
            kind: "p",
            text: "This is far more available than people think, and it is one of the few options that does not require you to buy anything from anybody. There is a standing federal permit. You do not apply for it. You comply with it and you file a short report afterwards.",
          },
          { kind: "heading", text: "A whole body" },
          {
            kind: "list",
            items: [
              "At least three nautical miles from shore.",
              "In water at least six hundred feet deep. Certain regions — parts of the Gulf and the area off the Mississippi delta and Florida — require eighteen hundred feet. Check the depth requirement for the water you are actually going out on.",
              "The body and anything it is wrapped or contained in must sink quickly and stay down, and must be free of plastic and anything else that will not break down. Weighting is expected, and there are shrouds and caskets made specifically for it.",
              "No embalming, which most families prefer anyway.",
            ],
          },
          { kind: "heading", text: "Ashes" },
          {
            kind: "list",
            items: [
              "At least three nautical miles from shore. There is no depth requirement for cremated remains.",
              "Flowers and wreaths are allowed if they break down in the marine environment.",
              "An urn may be committed with them only if it is biodegradable. A non-biodegradable urn has to come home with you.",
            ],
          },
          {
            kind: "law",
            state: "United States (federal)",
            text: "Burial at sea is authorised under a general permit issued by the Environmental Protection Agency under the Marine Protection, Research and Sanctuaries Act. No individual permit or fee is required, but the person who conducts it must notify the EPA regional office for that stretch of water within thirty days. Inland waters, lakes and rivers are not covered by this permit and are governed separately, usually by the state.",
          },
          {
            kind: "note",
            text: "You do not need a funeral home or a charter. If you or someone you know has a boat that can reach the distance safely, you may do this yourselves. Charter services exist in every coastal region and are inexpensive compared with almost everything else on this page. For a service member or an eligible dependent, the US Navy performs burial at sea at no cost, though family are not usually aboard.",
          },
        ],
      },
      {
        id: "becoming-a-tree",
        title: "Planting them as a tree, honestly",
        summary:
          "The picture you have seen is a design concept, and raw ashes will kill a tree. What actually works instead, which is more than you would think.",
        body: [
          {
            kind: "p",
            text: "Almost every parent who wants this has seen the same image: a body curled in a seed-shaped pod with a tree growing out of it. That pod is a design concept. The full-body version has never been available to buy anywhere in the world. Only the small urn version, for ashes, is actually sold. This chapter exists because wanting that and then discovering it is not real, at this particular moment of your life, is not something you should have to find out on your own.",
          },
          {
            kind: "warn",
            text: "The second thing nobody says: cremated ashes are actively hostile to plants. They are extremely alkaline, very high in sodium and salt, and contain almost nothing a plant can use. Poured around the base of a tree, they will stunt or kill it. Families have planted a memorial tree with their child's ashes and watched it die over the following year, and understood it as a sign. It was chemistry.",
          },
          { kind: "heading", text: "What actually works" },
          {
            kind: "list",
            items: [
              "Human composting. This is the real version of the thing you are picturing. What comes back is living soil, and you can plant into it, because that is precisely what it is for.",
              "A conservation burial ground. A natural burial in permanently protected land, often with a native tree or planting permitted over the grave. Legally and physically, they become part of a forest.",
              "Urns built for the problem — Bios Urn, The Living Urn, Let Your Love Grow and others. They work by buffering the pH and diluting the ashes heavily into a proper growing medium. They are a real solution to a real chemical problem, not a gimmick.",
              "Mixing a small proportion of ashes into a large volume of good soil, well away from the root ball, rather than into the planting hole. A soil test afterwards is not excessive.",
              "A memorial tree with nothing in it at all. This is what most families ultimately want — a living thing in a place that means something. It is allowed everywhere, it costs almost nothing, and it will not die of what you put under it.",
              "A memorial reef, where ashes are set into a concrete reef ball and placed on the seabed under permit. It is real, it is permitted, and divers can visit it.",
            ],
          },
          {
            kind: "note",
            text: "Scattering, plainly: on your own land, freely. On someone else's, with permission. In most national parks, allowed with a free permit — ring the park and ask. At sea, under the federal rule in the previous chapter. And you are allowed to keep some and scatter some. Splitting ashes between places and people is ordinary, and no one will think it strange.",
          },
        ],
      },
      {
        id: "donating-their-body",
        title: "Donating their body to science",
        summary:
          "Usually free, including transport. Also the one option on this list with a genuine industry problem, and often not available for a child.",
        body: [
          {
            kind: "p",
            text: "Whole-body donation is different from organ and tissue donation, which is a decision made within hours and has its own chapter. This is donating the body itself to a medical school, a state anatomical board, or a research programme, for teaching anatomy, surgical training or forensic science.",
          },
          {
            kind: "list",
            items: [
              "It is normally free, and usually includes transport and the cremation afterwards. For a family with no money, it is sometimes the only route that does not involve a bill at all.",
              "Remains are typically returned in one to three years. Some programmes do not return them. Ask, and get the answer in writing.",
              "An autopsy will disqualify your child from many programmes. So will certain infectious diseases, significant trauma, and weight limits at both ends. A programme saying no is common and is not a judgement of anything.",
            ],
          },
          {
            kind: "warn",
            text: "This is the part to be careful about. Alongside university programmes there is a lightly regulated private trade in donated bodies in the United States, and there have been repeated documented cases of bodies being dismembered and sold on, with families told something entirely different. Donate through a university medical school anatomical programme or your state's anatomical board. Ask directly: are you a university programme, who exactly receives the body, what happens to it, and will the remains be returned and when. A programme that will not answer those four questions plainly is your answer.",
          },
          {
            kind: "warn",
            text: "For a child, this is often simply not possible. Most anatomical programmes accept only adults, and paediatric donation, where it exists at all, runs through specific children's hospitals and research programmes rather than general body donation. If this was your child's wish or yours, ask the hospital that treated them — but expect the answer to be no, and know in advance that it is a limit of the system and not a refusal of them.",
          },
        ],
      },
    ],
  },
  {
    heading: "The hard conversations",
    chapters: [
      {
        id: "obituary-and-shame",
        title: "The obituary when you are ashamed of how they died",
        summary:
          "Overdose, suicide, a crime they were part of. What you owe the truth, and what you do not.",
        body: [
          {
            kind: "p",
            text: "You do not have to name a cause of death in an obituary. Ever. It is not a legal document, nobody proofreads it against the death certificate, and 'died unexpectedly' is a complete sentence that thousands of families use every week.",
          },
          {
            kind: "p",
            text: "But you may find you are not really deciding what to publish. You are deciding whether you are going to spend the rest of your life hiding how your child died — and that is a much bigger decision to be making on a deadline, in a room with a funeral director, for a fee per line.",
          },
          { kind: "heading", text: "The honest options" },
          {
            kind: "list",
            items: [
              "Say nothing about the cause. 'Died unexpectedly at home on the 4th.' Complete, true, and nobody's business.",
              "Say it plainly. 'Died of an overdose.' 'Died by suicide.' Some parents find this is the moment the shame stops running the rest of their life, and other bereaved parents will find them because of it.",
              "Say it sideways, and truthfully. 'After a long struggle with addiction.' 'After years of fighting an illness that too many families fight alone.'",
              "Ask for donations to a relevant cause instead of flowers. It says the thing without saying it, and it gives the people who loved them somewhere to put it.",
            ],
          },
          {
            kind: "warn",
            text: "Whatever you write, someone will find out anyway — a scanner post, a court listing, a cousin. That is a reason to choose deliberately, not a reason to confess. Choose what you can live with people knowing, not what you can survive this week.",
          },
          {
            kind: "p",
            text: "Their death is not their life, and it is not a verdict on your parenting. An overdose is a cause of death like a heart attack is a cause of death. You are allowed to write an obituary that is entirely about who they were and mentions nothing about how they left.",
          },
          {
            kind: "note",
            text: "You can also publish nothing. There is no requirement to publish an obituary at all, and no one is counting.",
          },
        ],
      },
      {
        id: "split-families",
        title: "Divorced, separated, and who gets to decide",
        summary:
          "Who has legal authority over the body and the funeral when the parents are not together — and how to survive it when it is not you.",
        body: [
          {
            kind: "p",
            text: "This is the cruelty nobody sees coming: at the worst moment of your life, being told that the decision about your own child is not yours.",
          },
          { kind: "heading", text: "How the law generally works" },
          {
            kind: "law",
            state: "Varies by state",
            text: "Every state has a priority order for who controls a body and the funeral arrangements — the 'right of disposition'. For an unmarried minor, that is normally both parents, and where they disagree, some states say the parent with custody decides, some require agreement, and some send it to a judge. For an adult child, the surviving spouse comes first, then any adult children, then the parents. Custody orders and parenting plans generally end at death and do not decide this. Ask a lawyer in your state, quickly, if there is a real dispute — this is one of the few things in the first week that genuinely cannot wait.",
          },
          {
            kind: "p",
            text: "A funeral home caught between two parents will usually refuse to proceed until they agree or a court says otherwise. That is not them taking a side; they carry the liability.",
          },
          { kind: "heading", text: "When the decision is not yours" },
          {
            kind: "list",
            items: [
              "Ask for what is separable rather than fighting the whole thing. A lock of hair. A fingerprint. Some of the ashes. Half an hour alone with them before the service. These are usually granted even when nothing else is.",
              "Ask the funeral director to be your intermediary. It is a normal part of their job and they are far better at it than either of you is this week.",
              "Hold your own memorial. Your own service, your own people, on your own day. Nobody can prevent that, and it is often the one that mattered.",
              "Write down what you asked for and what was refused. Not for a lawyer — for you, in two years, when you are trying to work out what actually happened in that week.",
            ],
          },
          { kind: "heading", text: "Stepparents, partners, and the people with no standing" },
          {
            kind: "p",
            text: "A stepparent who raised them for a decade may have no legal say at all, and may also not be listed anywhere, invited to anything, or acknowledged. If you are the one with authority, you can choose to include them. If you are the one without, ask for the separable things above, and hold your own thing.",
          },
          {
            kind: "warn",
            text: "Grief and old grievance are almost impossible to tell apart in the first week, and things said now get remembered for decades by the children who are still here. If you can put one conversation off for a month, put off that one.",
          },
        ],
      },
    ],
  },
];
