import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_PORTRAIT_ZOOM,
  PORTRAIT_ASPECT,
  cropImageStyle,
  cropOf,
  panCrop,
  startingCrop,
  toCropFields,
  visibleRect,
  zoomCrop,
  zoomOf,
  type CasePhoto,
  type Crop,
} from "@workspace/api-client-react";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AuthedImage } from "@/components/AuthedImage";

/**
 * The main photograph, framed the way the family framed it.
 *
 * The crop is stored as instructions (see `portrait-crop.ts` in the API
 * client, which both apps and — in its own words — the print renderer
 * follow), so this draws the whole photograph inside a frame and moves it,
 * rather than asking the server for a cut copy. The frame can be any shape:
 * a 4:5 card shows exactly what was framed, a square thumbnail the middle of
 * it, which is what the square register page prints too.
 */
export function CroppedPhoto({
  photo,
  alt,
  frameAspect = PORTRAIT_ASPECT,
  className = "",
}: {
  photo: Pick<CasePhoto, "uploadId" | "cropX" | "cropY" | "cropWidth" | "cropHeight">;
  alt: string;
  frameAspect?: number;
  className?: string;
}) {
  const [imageAspect, setImageAspect] = useState<number | null>(null);
  const rect = imageAspect ? visibleRect(cropOf(photo), imageAspect, frameAspect) : null;

  return (
    <div
      className={`relative overflow-hidden bg-[var(--muted)] ${className}`}
      style={{ aspectRatio: frameAspect }}
    >
      <AuthedImage
        uploadId={photo.uploadId}
        alt={alt}
        className="absolute inset-0 h-full w-full"
        // Hidden for the moment between the bytes arriving and their shape
        // being known, so the photograph never flashes up unframed.
        imgStyle={rect ? cropImageStyle(rect) : { opacity: 0 }}
        onNaturalSize={(width, height) => setImageAspect(width / height)}
      />
    </div>
  );
}

/** Arrow-key steps, as a share of the frame. */
const NUDGE = 0.02;
const NUDGE_FAR = 0.1;
const ZOOM_STEP = 0.1;

/**
 * Framing the main photograph.
 *
 * This is the face on the prayer card, the order of service and the cover of
 * the memory book, and the photograph the family loves is usually a snapshot
 * with their mother somewhere off to one side of it. So: a fixed 4:5 frame —
 * the shape of the cards — and the picture moved behind it, by a finger, two
 * fingers, a mouse wheel, or the keyboard. The editor never cuts anything: it
 * produces the four numbers the server stores, and the original stays whole.
 *
 * Written on pointer events rather than a gesture library, because the whole
 * of it is "one pointer pans, two pointers pinch" and a dependency for that
 * is more to load on a phone in a hospital car park than it saves.
 *
 * The keyboard is a first-class way in, not a fallback: the frame takes
 * focus and the arrow keys move the picture (Shift for bigger steps), plus and
 * minus zoom, and the zoom is also an ordinary slider with a label.
 */
export function PortraitCropper({
  photo,
  open,
  onOpenChange,
  onSave,
  saving,
}: {
  photo: CasePhoto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (fields: ReturnType<typeof toCropFields>) => void;
  saving: boolean;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [imageAspect, setImageAspect] = useState<number | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);

  // Everything the pointer handlers need, without re-binding them per move.
  const live = useRef({ crop, imageAspect });
  live.current = { crop, imageAspect };
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  // A different photograph, or the dialog reopened: start from what is saved.
  useEffect(() => {
    if (!open) return;
    setCrop(null);
    setImageAspect(null);
    pointers.current.clear();
  }, [open, photo?.id]);

  const onNaturalSize = (width: number, height: number) => {
    const aspect = width / height;
    setImageAspect(aspect);
    setCrop((current) => current ?? startingCrop(photo ? cropOf(photo) : null, aspect));
  };

  const zoom = crop && imageAspect ? zoomOf(crop, imageAspect) : 1;

  const setZoom = useCallback(
    (next: number, anchor?: { x: number; y: number }) => {
      const { crop: current, imageAspect: aspect } = live.current;
      if (!current || !aspect) return;
      setCrop(zoomCrop(current, next, aspect, PORTRAIT_ASPECT, anchor));
    },
    [],
  );

  /** A point on the frame, as a point in the photograph (0..1). */
  const toImagePoint = (clientX: number, clientY: number) => {
    const box = frame.current?.getBoundingClientRect();
    const current = live.current.crop;
    if (!box || !current) return undefined;
    return {
      x: current.x + ((clientX - box.left) / box.width) * current.width,
      y: current.y + ((clientY - box.top) / box.height) * current.height,
    };
  };

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const element = frame.current;
    if (!element || !open) return;
    const onWheel = (event: WheelEvent) => {
      const { crop: current, imageAspect: aspect } = live.current;
      if (!current || !aspect) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      setZoom(zoomOf(current, aspect) * factor, toImagePoint(event.clientX, event.clientY));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
    // `imageAspect` so this binds once the frame (and the image) exist.
  }, [open, imageAspect, setZoom]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!live.current.crop) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    const box = frame.current?.getBoundingClientRect();
    const { crop: current, imageAspect: aspect } = live.current;
    if (!previous || !box || !current || !aspect) return;

    const others = [...pointers.current.entries()].filter(([id]) => id !== event.pointerId);
    const next = { x: event.clientX, y: event.clientY };

    if (others.length === 0) {
      // One finger: the photograph follows it, so the crop moves the other way.
      setCrop(
        panCrop(
          current,
          -(next.x - previous.x) / box.width,
          -(next.y - previous.y) / box.height,
        ),
      );
    } else {
      // Two fingers: zoom by how far apart they have moved, about the point
      // between them, so what is under the fingers stays under them.
      const other = others[0]![1];
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(next.x - other.x, next.y - other.y);
      if (before > 0) {
        const mid = toImagePoint((next.x + other.x) / 2, (next.y + other.y) / 2);
        setCrop(
          zoomCrop(current, zoomOf(current, aspect) * (after / before), aspect, PORTRAIT_ASPECT, mid),
        );
      }
    }

    pointers.current.set(event.pointerId, next);
  };

  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = live.current.crop;
    if (!current) return;
    const step = event.shiftKey ? NUDGE_FAR : NUDGE;
    // Arrow keys move the photograph, the way a finger would: "right" slides
    // the picture right, which shows more of its left-hand side.
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setCrop(panCrop(current, move[0], move[1]));
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setZoom(zoom + ZOOM_STEP);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      setZoom(zoom - ZOOM_STEP);
    }
  };

  const rect = crop;

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[100dvh] gap-4 overflow-y-auto p-5 sm:p-7">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            Frame the main photograph
          </DialogTitle>
          <DialogDescription>
            Drag the picture to move it, and pinch or use the slider to come in
            closer. This is how it will sit on the printed cards. The photograph
            itself is kept whole.
          </DialogDescription>
        </DialogHeader>

        {photo && (
          <div
            ref={frame}
            tabIndex={0}
            role="group"
            aria-roledescription="photograph framing"
            aria-label="The photograph in its frame. Use the arrow keys to move it, and plus or minus to zoom."
            aria-describedby="portrait-zoom-value"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onKeyDown={onKeyDown}
            className="relative mx-auto w-full max-w-[16.5rem] cursor-grab touch-none select-none
                       overflow-hidden rounded-lg bg-[var(--muted)] shadow-[var(--elevation-1)]
                       ring-1 ring-inset ring-black/10 active:cursor-grabbing
                       focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]"
            style={{ aspectRatio: PORTRAIT_ASPECT }}
          >
            <AuthedImage
              uploadId={photo.uploadId}
              alt={photo.caption ?? "The main photograph"}
              className="pointer-events-none absolute inset-0 h-full w-full"
              draggable={false}
              imgStyle={rect ? cropImageStyle(rect) : { opacity: 0 }}
              onNaturalSize={onNaturalSize}
            />
            {/* Thirds, faintly: somewhere to put the eyes, not a rule. */}
            <span aria-hidden className="pointer-events-none absolute inset-0">
              <span className="absolute inset-y-0 left-1/3 w-px bg-white/35" />
              <span className="absolute inset-y-0 left-2/3 w-px bg-white/35" />
              <span className="absolute inset-x-0 top-1/3 h-px bg-white/35" />
              <span className="absolute inset-x-0 top-2/3 h-px bg-white/35" />
            </span>
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="portrait-zoom" className="text-sm font-semibold">
              Zoom
            </label>
            <span id="portrait-zoom-value" className="tabular text-sm text-muted-foreground">
              {zoom <= 1.001 ? "The whole picture" : `${Math.round(zoom * 100)}%`}
            </span>
          </div>
          <input
            id="portrait-zoom"
            type="range"
            min={1}
            max={MAX_PORTRAIT_ZOOM}
            step={0.01}
            value={zoom}
            disabled={!crop}
            onChange={(event) => setZoom(Number(event.target.value))}
            aria-valuetext={zoom <= 1.001 ? "The whole picture" : `${Math.round(zoom * 100)} percent`}
            className="h-11 w-full cursor-pointer accent-[var(--accent)]"
          />
        </div>

        <DialogFooter className="flex-row flex-wrap items-center gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mr-auto text-muted-foreground"
            disabled={!imageAspect || saving}
            onClick={() => imageAspect && setCrop(startingCrop(null, imageAspect))}
          >
            <RotateCcw className="size-4" />
            Start again
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Not now
          </Button>
          <Button
            type="button"
            className="w-full sm:w-auto"
            disabled={!crop || saving}
            onClick={() => crop && onSave(toCropFields(crop))}
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Keep this framing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
