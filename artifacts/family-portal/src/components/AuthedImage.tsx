import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useGetFamilyUpload } from "@workspace/api-client-react";

/**
 * A photograph from behind the family link.
 *
 * The family surface is gated by `Authorization: Bearer <token>` — there is
 * no cookie, deliberately, because a family has no account. A plain
 * `<img src="/api/family/uploads/12">` is a request the browser makes on its
 * own, and the browser has nowhere to put that header. So every image on the
 * family's side of this product asked the server for bytes without a
 * credential, and the server correctly refused.
 *
 * The visible result was that the funeral home's logo never appeared in the
 * header, and not one photograph ever appeared on the photographs page — on a
 * product whose first listed feature is collecting photographs. It was
 * invisible in the tests because the tests send the header themselves, and
 * invisible in review because a broken image in a list of broken images
 * reads as "no photos uploaded yet".
 *
 * The fix that would have been quicker — allowing `?token=` on the image
 * route — is the one thing this portal is built not to do: the token is
 * lifted out of the address bar on arrival precisely so that a phone passed
 * round a kitchen table is not displaying the credential, and so that a
 * screenshot of this screen is not a working link. Putting it back into a URL
 * to save a component would undo that for every picture on the page.
 *
 * So the bytes are fetched the same way every other family request is,
 * handed to the browser as an object URL, and released when the picture
 * leaves the screen.
 */
export function AuthedImage({
  uploadId,
  alt,
  className = "",
  imgStyle,
  onNaturalSize,
  draggable,
}: {
  uploadId: number;
  alt: string;
  className?: string;
  /** Applied to the picture once it has arrived, e.g. a portrait crop. */
  imgStyle?: CSSProperties;
  /** Told the photograph's own proportions, which a crop is drawn from. */
  onNaturalSize?: (width: number, height: number) => void;
  draggable?: boolean;
}) {
  /*
   * Fetched when it is about to be seen, not when the list renders.
   *
   * The bin holds up to a thousand photographs, and every one of them used to
   * be requested the moment the page opened: on a phone on mobile data that
   * is every full-size picture of somebody's mother downloaded at once, most
   * of them into rows nobody scrolled to, and — with each one its own
   * authenticated request — enough of them to run the family's link into its
   * own rate limit before the page had finished drawing. Now a row asks for
   * its picture when it comes within a screen or so of the viewport, and
   * browsers without IntersectionObserver simply load everything as before.
   */
  const holder = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (near) return;
    const element = holder.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);

  const { data: blob, isPending, isError } = useGetFamilyUpload(uploadId, {
    query: {
      queryKey: [`/api/family/uploads/${uploadId}`],
      enabled: near,
      // Rows are never rewritten, only added and deleted, so a photograph
      // fetched once on this screen is good for as long as the tab is open.
      staleTime: Infinity,
      gcTime: 30 * 60_000,
      retry: 1,
    },
  });

  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setSrc(null);
      return;
    }

    const url = URL.createObjectURL(blob);
    setSrc(url);

    // Released on unmount and whenever the picture changes. A family scrolling
    // a bin of several hundred photographs would otherwise hold every one of
    // them in memory until the tab was closed, which on an older phone is the
    // difference between a slow page and a crashed browser.
    return () => {
      URL.revokeObjectURL(url);
      setSrc(null);
    };
  }, [blob]);

  /*
   * One element in all three states, so the picture arriving does not change
   * the height of anything around it. Loading is the paper tone the rest of
   * the product rests on rather than a grey box; a photograph that genuinely
   * cannot be read stays quiet rather than showing a family a broken-image
   * glyph about their mother.
   */
  if (!src) {
    return (
      <div
        ref={holder}
        role="img"
        aria-label={isError ? `${alt} (could not be shown)` : alt}
        aria-busy={isPending || undefined}
        className={`bg-[var(--muted)] ${isPending ? "animate-pulse" : ""} ${className}`}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={imgStyle}
      draggable={draggable}
      onLoad={(event) =>
        onNaturalSize?.(
          event.currentTarget.naturalWidth,
          event.currentTarget.naturalHeight,
        )
      }
    />
  );
}
