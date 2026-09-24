# The craft standard

Every component is held to this. It is not decoration — it is the product. A
director shows this to a family on the worst week of their life, and it has to
look like it was made by people who took that seriously.

## What "very well funded, a year of work" actually looks like

It is worth being precise, because the instinct is wrong. A well-funded team
with a year does not ship *more*. It ships **less, finished**.

What it actually produces:

- **One** way to do each thing, not three.
- Every state designed — not just the happy one.
- Copy written by someone who cared about each sentence.
- Consistency so tight it stops being visible.
- Restraint. No gradient because gradients exist. No animation because the
  library had one.

What it never produces: a novel visual idea per screen, decoration in place of
hierarchy, or a feature nobody asked for sitting next to a broken empty state.

**So: if you are choosing between a new flourish and finishing an existing
screen properly, finish the screen. Every time.**

## Typography — settled, do not relitigate

Already chosen, already right, now locked:

- **Lora** (serif) for headings and anything that should feel like a printed
  order of service. `--font-display`.
- **Source Sans 3** (sans) for interface and body. `--font-sans`. Self-hosted
  through `@fontsource-variable`, in all four front ends.
- Two families. Not three. Never a third.
- Body text never below 16px on the family portal — it is read on a phone, at
  arm's length, by someone in their seventies, possibly crying.
- Measure caps at ~66 characters. Long paragraphs get `max-w-prose`.
- Numerals in tables and prices: `font-variant-numeric: tabular-nums`.

## Colour — tokens only

- **Never hardcode a hex in a component.** Every colour comes from the tokens
  in `index.css`. If you need a colour that does not exist, add a token and say
  why in a comment.
- `--accent` is **the funeral home's own colour**, injected at runtime. Your UI
  must look correct with a deep green, a navy, a burgundy and a muted gold.
  Test with at least two before you call it done.
- Red (`--destructive`) is for destructive confirmation only. **Never** for a
  deadline, an overdue task, or anything in the family portal. A red badge
  telling a widow she is late with her mother's obituary is unforgivable.
  Overdue is communicated in words, calmly.
- No dark mode in the family portal. The director console may have one later;
  it is not in scope for anybody now.

## Space, rhythm, shape

- Spacing is the 4px scale, via Tailwind. No arbitrary `px` values.
- Radii from the tokens: `--radius-sm/md/lg`. Nothing else.
- Shadows: at most two levels, both soft. This is a product about dignity, not
  a dashboard about growth.
- Generous whitespace. Crowding reads as cheap, and cheap here reads as
  disrespectful.

## Motion

- 150–250ms, ease-out. Nothing longer, nothing bouncy, nothing that draws
  attention to itself.
- Motion may confirm (a row settling after it saves) or orient (a panel sliding
  from the edge it belongs to). It may never entertain.
- Honour `prefers-reduced-motion`. Always.
- Nothing on this site celebrates. No confetti, no checkmark that pops, no
  progress bar that fills triumphantly. Somebody died.

## Tone and copy — the compassion rules

The writing is most of the compassion. These are rules, not preferences:

- **Plain, warm, unhurried.** "When you're ready" not "Action required".
- **Never cheerful.** No exclamation marks in the family portal. No "Great
  job!", no "You're all set!", no emoji.
- **Never urgent.** No countdown timers, no "only 2 days left", no red.
  Deadlines are stated once, kindly, with what happens if they slip.
- **Never gamified.** No streaks, no percentage complete as a score, no badges.
  A progress indicator may show *what is left*, never *how well they are doing*.
- **Name the person.** "Margaret's photographs", not "Case #4417 assets".
- **Say what happens next.** Every action's copy answers "and then what?"
- **Never blame.** No "You failed to…", no "Invalid input". Say what is needed.
- Buttons are verbs describing the outcome: "Send the link", not "Submit".
- British spelling in comments and internal prose; **US spelling in anything a
  family or director reads** — these are American funeral homes.

## "Everything they need before they know they need it"

This is the hardest requirement and the one that separates this from ordinary
software. Concretely, it means:

- **Never ask twice.** If the case knows the date of birth, no form asks for it
  again. Anything derivable is derived and shown as already filled, editable.
- **Arrive filled.** Print templates, obituary drafts and forms open populated
  from what the case already knows. The user's job is to correct, not to type.
- **One next thing, always visible.** Every screen makes the single most likely
  next action obvious without hunting. Not a wall of equal buttons.
- **Surface the thing they were about to go looking for.** On the day of a
  service, the director wants the order of service and the family's phone
  number — put them there, that day, without being asked.
- **Right defaults, quietly.** The standard schedule applies itself. Aftercare
  dates propose themselves. The user confirms rather than constructs.
- **Never a dead end.** Every empty state says what this is for and offers the
  one action that fills it. Every error says what to do next. Every "no results"
  offers the way out.

## Every state is designed

A screen is not done when the happy path renders. It is done when all of these
exist and have been looked at:

**empty · loading · partial · error · success · offline · too much data · the
longest realistic name · the shortest**

Loading is skeletons that match the real layout, never a spinner in a void.
"Too much data" means 1,000 photographs and a 40-person family, and it must not
degrade into a scroll of doom.

## Self-explanatory

- **No onboarding tour.** If a screen needs a tour, the screen is wrong.
- **No icon-only buttons** anywhere a family can reach. Icons accompany labels,
  they do not replace them.
- **No tooltip carries required information.** Tooltips do not exist on touch.
- A director who has never been trained must be able to open a case and text a
  family without asking anyone. That is the test.

## Accessibility, as a floor

- WCAG AA contrast, checked, including against every brand accent.
- Full keyboard operation, visible focus rings — never `outline: none` without
  a replacement.
- Real labels on every input. Form errors announced, tied to their field.
- Touch targets 44px minimum. Half these users are on a phone, in a car park,
  outside a hospital.
- Test at 200% browser zoom. Older eyes.

## Clean code, held to the same bar

- **Match the surrounding code.** This codebase has a voice: comments explain
  *why*, especially where a decision looks wrong at first glance. Read
  `lib/db/src/schema/family-contacts.ts` before writing your first comment.
- Name things after what they mean to a funeral director, not to a programmer.
- No dead code, no commented-out blocks, no `any`, no `@ts-ignore` without a
  sentence saying why.
- If it is hard to explain, it is probably wrong. Simplify rather than comment
  around it.
- Tests for the things that would actually break: the wrong rows coming back,
  the wrong tenant, the wrong person seeing something.
- Leave every file you touch cleaner than you found it — but do not reformat
  files you did not otherwise change. Noise in a diff costs everyone.
