import { useState } from "react";
import { Check, Music, Plus } from "lucide-react";

/**
 * "We have no idea what music to have."
 *
 * Said at nearly every arrangement, and the honest reason is that almost
 * nobody has thought about their own funeral, let alone somebody else's.
 * The family is handed a blank line marked *Music* and goes quiet, and what
 * fills it a week later is whatever the director suggested, which is how
 * three funerals in a row end up with the same hymn.
 *
 * So: pick the feeling first. A family that cannot name a song can nearly
 * always name a room — whether this is church or a bar afterwards, whether
 * they want everyone in tears or everyone laughing — and from there the list
 * does the remembering for them. Most families take one from here and bring
 * two of their own, which is exactly the point: this is a way in, not a menu.
 *
 * **On shipping this at all.** `schema/print.ts` refuses to seed the verse
 * library, because a product that ships two hundred poems to two hundred
 * funeral homes is publishing them. That reasoning does not reach here and
 * the difference is not a technicality: a title and the name of whoever
 * recorded it is a reference to a work, not a copy of one. There are no
 * lyrics in this file and there must never be.
 *
 * What a home still owns is whether a recording can actually be played in
 * their chapel or the church up the road, which is a licensing question with
 * a different answer in every building. Hence the line at the bottom: ask
 * them. It is one sentence and it saves a family finding out on the day.
 */

type Suggestion = {
  title: string;
  /** Whoever a family would recognise it by. */
  by?: string;
  /** Sung by everyone, or played while they sit. It decides which list it joins. */
  kind: "hymn" | "music";
};

type Mood = {
  key: string;
  label: string;
  /** What this actually sounds like in the room, in a director's words. */
  blurb: string;
  songs: readonly Suggestion[];
};

const MOODS: readonly Mood[] = [
  {
    key: "traditional",
    label: "Proper and traditional",
    blurb:
      "A church service, an organ, and everybody standing up to sing. The safest ground there is, and nobody has ever regretted it.",
    songs: [
      { title: "Amazing Grace", kind: "hymn" },
      { title: "How Great Thou Art", kind: "hymn" },
      { title: "The Old Rugged Cross", kind: "hymn" },
      { title: "It Is Well With My Soul", kind: "hymn" },
      { title: "Be Thou My Vision", kind: "hymn" },
      { title: "On Eagle's Wings", kind: "hymn" },
      { title: "Abide With Me", kind: "hymn" },
      { title: "The Lord's My Shepherd", by: "Crimond", kind: "hymn" },
      { title: "Ave Maria", by: "Schubert", kind: "music" },
    ],
  },
  {
    key: "quiet",
    label: "Quiet, no words",
    blurb:
      "For coming in, for the pause after the eulogy, and for the walk out. Instrumental music asks nothing of a room that has nothing left to give.",
    songs: [
      { title: "Nimrod", by: "Elgar, from the Enigma Variations", kind: "music" },
      { title: "Clair de Lune", by: "Debussy", kind: "music" },
      { title: "Canon in D", by: "Pachelbel", kind: "music" },
      { title: "Adagio for Strings", by: "Barber", kind: "music" },
      { title: "Gymnopédie No. 1", by: "Satie", kind: "music" },
      { title: "The Swan", by: "Saint-Saëns", kind: "music" },
      { title: "Air on the G String", by: "Bach", kind: "music" },
      { title: "Pie Jesu", by: "Fauré", kind: "music" },
    ],
  },
  {
    key: "tender",
    label: "Tender",
    blurb:
      "The ones that let a room cry rather than holding it in. Usually placed after the eulogy, because nothing needs to be said for a minute afterwards.",
    songs: [
      { title: "Somewhere Over the Rainbow", by: "Israel Kamakawiwoʻole", kind: "music" },
      { title: "Tears in Heaven", by: "Eric Clapton", kind: "music" },
      { title: "Wind Beneath My Wings", by: "Bette Midler", kind: "music" },
      { title: "Bridge Over Troubled Water", by: "Simon & Garfunkel", kind: "music" },
      { title: "Time to Say Goodbye", by: "Andrea Bocelli & Sarah Brightman", kind: "music" },
      { title: "Hallelujah", by: "Leonard Cohen, or Jeff Buckley", kind: "music" },
      { title: "Angels", by: "Robbie Williams", kind: "music" },
      { title: "What a Wonderful World", by: "Louis Armstrong", kind: "music" },
    ],
  },
  {
    key: "sendoff",
    label: "Laid back, a proper send-off",
    blurb:
      "For somebody who would have hated a solemn one. These go at the end, on the way out, and people do sing along — which is usually what was wanted.",
    songs: [
      { title: "Free Bird", by: "Lynyrd Skynyrd", kind: "music" },
      { title: "My Way", by: "Frank Sinatra", kind: "music" },
      { title: "Rocky Mountain High", by: "John Denver", kind: "music" },
      { title: "Sweet Caroline", by: "Neil Diamond", kind: "music" },
      { title: "Take It Easy", by: "Eagles", kind: "music" },
      { title: "(Sittin' On) The Dock of the Bay", by: "Otis Redding", kind: "music" },
      { title: "Don't Stop Me Now", by: "Queen", kind: "music" },
      { title: "Always Look on the Bright Side of Life", by: "Monty Python", kind: "music" },
    ],
  },
  {
    key: "country",
    label: "Country and gospel",
    blurb:
      "Graveside music, and what gets sung when the family sings it themselves rather than an organist doing it for them.",
    songs: [
      { title: "Go Rest High on That Mountain", by: "Vince Gill", kind: "music" },
      { title: "I'll Fly Away", kind: "hymn" },
      { title: "Will the Circle Be Unbroken", kind: "hymn" },
      { title: "Precious Lord, Take My Hand", kind: "hymn" },
      { title: "His Eye Is on the Sparrow", kind: "hymn" },
      { title: "Swing Low, Sweet Chariot", kind: "hymn" },
      { title: "Peace in the Valley", kind: "hymn" },
      { title: "Angel Band", kind: "hymn" },
    ],
  },
  {
    key: "young",
    label: "For someone who died too young",
    blurb:
      "Chosen by the friends as often as by the family, and usually by somebody who has never had to choose anything like this before.",
    songs: [
      { title: "See You Again", by: "Wiz Khalifa & Charlie Puth", kind: "music" },
      { title: "Supermarket Flowers", by: "Ed Sheeran", kind: "music" },
      { title: "Fire and Rain", by: "James Taylor", kind: "music" },
      { title: "Vincent", by: "Don McLean", kind: "music" },
      { title: "Who You'd Be Today", by: "Kenny Chesney", kind: "music" },
      { title: "Forever Young", by: "Bob Dylan", kind: "music" },
      { title: "Somewhere Only We Know", by: "Keane", kind: "music" },
      { title: "I'll Be Missing You", by: "Puff Daddy & Faith Evans", kind: "music" },
    ],
  },
];

export function MusicSuggestions({
  chosen,
  onAdd,
}: {
  /** Everything already on the case, lower-cased, so a repeat shows as added. */
  chosen: ReadonlySet<string>;
  onAdd: (song: { kind: "hymn" | "music"; value: string; attribution: string | null }) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const mood = MOODS.find((entry) => entry.key === open) ?? null;

  /*
   * Only worth saying when a list actually mixes the two. On the send-off
   * list every row would read "Played", which is eight repetitions of a fact
   * nobody was in any doubt about — and the eye stops reading a label that
   * is always the same, including on the two lists where it matters.
   */
  const mixed =
    mood !== null &&
    mood.songs.some((song) => song.kind === "hymn") &&
    mood.songs.some((song) => song.kind === "music");

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--elevation-1)]">
      <div className="border-b border-border bg-[var(--sunken)] px-4 py-3">
        <h2 className="flex items-center gap-2 font-display text-base">
          <Music className="size-4 text-[var(--accent)]" strokeWidth={1.75} />
          If you're stuck on music
        </h2>
        <p className="mt-1 text-sm leading-snug text-muted-foreground">
          Almost nobody arrives knowing. Pick the feeling you want in the room
          and see what other families have chosen — then take one, or none.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 p-4">
        {MOODS.map((entry) => {
          const live = entry.key === open;
          return (
            <button
              key={entry.key}
              type="button"
              aria-expanded={live}
              onClick={() => setOpen(live ? null : entry.key)}
              className={`rounded-full border px-3.5 py-2 text-sm font-semibold transition-gentle ${
                live
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-deep)]"
                  : "border-border text-muted-foreground hover:border-[var(--accent)]/50 hover:text-foreground"
              }`}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      {mood && (
        <div className="border-t border-border px-4 py-4">
          <p className="mb-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
            {mood.blurb}
          </p>

          <ul className="space-y-1.5">
            {mood.songs.map((song) => {
              const already = chosen.has(song.title.toLowerCase());

              return (
                <li key={song.title}>
                  <button
                    type="button"
                    disabled={already}
                    onClick={() =>
                      onAdd({
                        kind: song.kind,
                        value: song.title,
                        attribution: song.by ?? null,
                      })
                    }
                    className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-gentle ${
                      already
                        ? "cursor-default border-[var(--accent)]/30 bg-[var(--accent-soft)]"
                        : "border-border hover:border-[var(--accent)] hover:bg-[var(--sunken)]"
                    }`}
                  >
                    {/*
                      Wrapped, not truncated. "Always Look on the Bright Side
                      of Life" came out of a phone-width row as "Always Look
                      on the Bright Si…", and a family scanning for something
                      they half-remember cannot recognise a title they cannot
                      read to the end of. A row that grows by one line is the
                      cheaper failure.
                    */}
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium leading-snug">
                        {song.title}
                      </span>
                      {song.by && (
                        <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">
                          {song.by}
                        </span>
                      )}
                    </span>

                    {/*
                      Which list it lands in, said before it lands there —
                      a family that adds "I'll Fly Away" expecting it under
                      Music and finds it under Hymns thinks the page is
                      broken rather than that it made a distinction.
                    */}
                    {mixed && (
                      <span className="eyebrow shrink-0">
                        {song.kind === "hymn" ? "Hymn" : "Played"}
                      </span>
                    )}

                    {already ? (
                      <Check
                        className="size-4 shrink-0 text-[var(--accent-deep)]"
                        strokeWidth={2.5}
                        aria-label="Already on the list"
                      />
                    ) : (
                      <Plus
                        className="size-4 shrink-0 text-muted-foreground transition-colors duration-200 group-hover:text-[var(--accent)]"
                        aria-hidden
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <p className="mt-4 border-t border-border pt-3 text-sm leading-relaxed text-muted-foreground">
            None of this is a menu — add your own above, in any language, from
            any tradition. If there is a hymn your family has always had, or
            something the church or the crematorium needs to approve before
            the day, tell the funeral home and they will sort it out.
          </p>
        </div>
      )}
    </section>
  );
}
