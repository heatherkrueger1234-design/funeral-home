import { useState } from "react";
import {
  PORTRAIT_ASPECT,
  cropImageStyle,
  cropOf,
  visibleRect,
  type CasePhoto,
} from "@workspace/api-client-react";

/**
 * A photograph drawn through its stored crop, the way the family framed it
 * in the portal and the way the print renderer cuts it for the cards.
 *
 * The arithmetic is the shared `visibleRect` in the API client, so the three
 * cannot drift apart: a director looking at the portrait here is looking at
 * the face that will be on the prayer card, not at the whole snapshot it
 * was framed from.
 */
export function CroppedImg({
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
      className={`relative overflow-hidden bg-muted ${className}`}
      style={{ aspectRatio: frameAspect }}
    >
      <img
        src={`/api/uploads/${photo.uploadId}`}
        alt={alt}
        loading="lazy"
        className="absolute inset-0 h-full w-full"
        style={rect ? cropImageStyle(rect) : { opacity: 0 }}
        onLoad={(event) =>
          setImageAspect(
            event.currentTarget.naturalWidth / event.currentTarget.naturalHeight,
          )
        }
      />
    </div>
  );
}
