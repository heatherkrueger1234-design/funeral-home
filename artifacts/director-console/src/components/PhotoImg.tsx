import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { photoSources, waitAfterFailure, type PhotoSize } from "@/lib/photo-src";

/**
 * A stored photograph, drawn at the size it is shown (`photo-src.ts`).
 *
 * A plain <img>, which the session cookie travels with, and patient: a
 * thumbnail the server is too busy to make yet arrives as an error, so an
 * error is answered by asking again a little later, a few times. A new
 * element each time, because the same element given the same address does
 * not ask again.
 */
export function PhotoImg({
  uploadId,
  size,
  onError,
  ...rest
}: Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet"> & {
  uploadId: number;
  size: PhotoSize;
}) {
  const [failures, setFailures] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const wait = waitAfterFailure(failures);
    if (wait === null) return;
    const timer = window.setTimeout(() => setAttempt(failures), wait);
    return () => window.clearTimeout(timer);
  }, [failures]);

  return (
    <img
      key={attempt}
      {...photoSources(uploadId, size)}
      {...rest}
      onError={(event) => {
        setFailures((count) => count + 1);
        onError?.(event);
      }}
    />
  );
}
