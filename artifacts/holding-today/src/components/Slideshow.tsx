import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Music, Pause, Play, VolumeX, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The memory wall, one photograph at a time, filling the screen.
 *
 * Two rules, both of which come from the site's own guides.
 *
 * It never starts playing by itself. The guide on ambushes tells people to
 * switch off photo memory notifications, because being shown your dead child
 * unexpectedly is a different thing from going to look on purpose. A slideshow
 * that begins advancing the moment it opens is that same ambush with a nicer
 * name. It opens on one picture and waits. Advancing is a decision, every
 * time, until the person chooses otherwise by pressing play.
 *
 * And it never crops. `object-contain`, always — a slideshow that fills the
 * frame edge to edge will sooner or later cut off the top of someone's head,
 * and there is no version of that which is acceptable here.
 *
 * Music follows the same rule as the pictures. It starts when the person
 * presses play and stops when they pause or close. It is never the thing that
 * announces itself first: nobody should open this to look at one photograph
 * and have their child's song start playing at them.
 */

const ADVANCE_MS = 6000;

export type Slide = {
  id: number;
  imageUrl: string;
  title: string;
  description?: string | null;
  dateTaken?: string | null;
};

/**
 * `dateTaken` is free text, because people type "summer 1998" and "his last
 * birthday" as often as they type a date. Anything that parses as a real date
 * is shown long-form; everything else is shown exactly as it was written.
 */
export function formatWhen(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const parsed = new Date(`${raw.slice(0, 10)}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }
  }
  return raw;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function Slideshow({
  slides,
  startAt = 0,
  musicUrl,
  onClose,
}: {
  slides: Slide[];
  startAt?: number;
  musicUrl?: string | null;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(startAt, 0), Math.max(slides.length - 1, 0)),
  );
  const [playing, setPlaying] = useState(false);
  const [captionShown, setCaptionShown] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<Element | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [musicBlocked, setMusicBlocked] = useState(false);

  const count = slides.length;
  const go = useCallback(
    (delta: number) => setIndex((i) => (count === 0 ? 0 : (i + delta + count) % count)),
    [count],
  );

  // Focus moves into the overlay so the arrow keys reach it, and goes back
  // where it came from on close rather than to the top of the page.
  useEffect(() => {
    returnFocusTo.current = document.activeElement;
    containerRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (returnFocusTo.current instanceof HTMLElement) {
        returnFocusTo.current.focus();
      }
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          onClose();
          break;
        case "ArrowRight":
          event.preventDefault();
          setPlaying(false);
          go(1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          setPlaying(false);
          go(-1);
          break;
        case " ":
          event.preventDefault();
          setPlaying((p) => !p);
          break;
        case "c":
          setCaptionShown((c) => !c);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  useEffect(() => {
    if (!playing || count < 2) return;
    const timer = window.setTimeout(() => go(1), ADVANCE_MS);
    return () => window.clearTimeout(timer);
  }, [playing, index, go, count]);

  /**
   * The song is tied to the play button and to nothing else.
   *
   * A browser may still refuse to start audio if it decides the gesture was
   * not close enough to the play. That is caught rather than thrown away, so
   * the slideshow keeps running silently and says so, instead of the person
   * wondering why their child's song did not come on.
   */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (playing) {
      audio.play().then(
        () => setMusicBlocked(false),
        () => setMusicBlocked(true),
      );
    } else {
      audio.pause();
    }
  }, [playing]);

  // The next picture is fetched while this one is being looked at, so
  // advancing does not land on an empty frame.
  useEffect(() => {
    if (count < 2) return;
    const next = slides[(index + 1) % count];
    if (next?.imageUrl) {
      const preload = new Image();
      preload.src = next.imageUrl;
    }
  }, [index, slides, count]);

  if (count === 0) return null;

  const slide = slides[index]!;
  const when = formatWhen(slide.dateTaken);
  const still = prefersReducedMotion();

  return createPortal(
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Slideshow, ${index + 1} of ${count}`}
      className="fixed inset-0 z-[100] bg-black outline-none flex flex-col"
    >
      <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between p-4 md:p-5 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-white/50 tabular-nums">
            {index + 1} / {count}
          </span>
          {musicUrl && (
            <span
              className="flex items-center gap-1.5 text-xs text-white/40"
              title={
                musicBlocked
                  ? "Your browser would not start the music on its own"
                  : "Music plays while the slideshow is playing"
              }
            >
              {musicBlocked ? (
                <>
                  <VolumeX className="w-3.5 h-3.5" />
                  <span>press play again for sound</span>
                </>
              ) : (
                <Music className="w-3.5 h-3.5" />
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCaptionShown((c) => !c)}
            className="px-3 py-2 text-xs text-white/60 hover:text-white transition-colors"
          >
            {captionShown ? "Hide words" : "Show words"}
          </button>
          {count > 1 && (
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              aria-label={playing ? "Pause" : "Play automatically"}
              className="p-2.5 text-white/60 hover:text-white transition-colors"
            >
              {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the slideshow"
            className="p-2.5 text-white/60 hover:text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      {musicUrl && (
        <audio ref={audioRef} src={musicUrl} loop preload="auto" aria-hidden="true" />
      )}

      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        <img
          key={slide.id}
          src={slide.imageUrl}
          alt={slide.title}
          className={cn(
            "max-h-full max-w-full object-contain",
            !still && "animate-in fade-in duration-700",
          )}
        />

        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                go(-1);
              }}
              aria-label="Previous photograph"
              className="absolute left-0 inset-y-0 w-1/5 flex items-center justify-start pl-3 md:pl-5 text-white/0 hover:text-white/70 transition-colors"
            >
              <ChevronLeft className="w-9 h-9" />
            </button>
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                go(1);
              }}
              aria-label="Next photograph"
              className="absolute right-0 inset-y-0 w-1/5 flex items-center justify-end pr-3 md:pr-5 text-white/0 hover:text-white/70 transition-colors"
            >
              <ChevronRight className="w-9 h-9" />
            </button>
          </>
        )}
      </div>

      {captionShown && (slide.title || when || slide.description) && (
        <div className="relative z-20 px-5 pb-7 pt-10 md:px-10 md:pb-10 bg-gradient-to-t from-black via-black/85 to-transparent">
          <div className="max-w-3xl mx-auto text-center">
            {slide.title && (
              <h2 className="font-display text-2xl md:text-3xl text-white mb-1.5 text-balance">
                {slide.title}
              </h2>
            )}
            {/* The date line is not uppercased. This field takes free text, and
                people write "his last birthday" in it — shouting that back at
                them is the wrong register for the one line on the screen that
                is in their own words. */}
            {when && (
              <p className="text-xs tracking-wide text-white/45 mb-3">
                {when}
              </p>
            )}
            {slide.description && (
              <p className="text-white/70 leading-relaxed text-sm md:text-base max-w-2xl mx-auto">
                {slide.description}
              </p>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
