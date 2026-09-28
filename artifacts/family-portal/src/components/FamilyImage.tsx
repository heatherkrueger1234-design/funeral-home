import { useEffect, useState } from "react";

/**
 * An image the family portal has to authenticate for.
 *
 * Everything on this side of the API is reached with the token from a texted
 * link, sent as a bearer header — and `<img src="…">` cannot send a header.
 * So the bytes are fetched by the caller (where the token getter applies)
 * and turned into an object URL here.
 *
 * The obvious shortcut is to put the token in the image URL instead. It is
 * not worth it: the portal takes care to get the token out of the address
 * bar so a screenshot of a phone on a kitchen table is not a working link,
 * and threading it through every image request would undo that in every
 * referrer header and proxy log on the way.
 *
 * Both states that are not "a picture" are designed. While it loads there is
 * a quiet block the right shape, so the page does not jump when it arrives.
 * If it never arrives there is nothing at all — an item is still a name, a
 * description and a price, and a broken-image icon beside somebody's urn
 * would be worse than no picture.
 */
export function FamilyImage({
  uploadId,
  fetcher,
  alt,
  className,
  placeholderClassName,
}: {
  /** Which upload. The one thing that decides whether to fetch again. */
  uploadId: number;
  fetcher: (uploadId: number) => Promise<Blob>;
  alt: string;
  className?: string;
  placeholderClassName?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;

    void fetcher(uploadId)
      .then((blob) => {
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (live) setFailed(true);
      });

    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uploadId, fetcher]);

  if (failed) return null;

  if (url === null) {
    return (
      <div
        className={placeholderClassName ?? className}
        aria-hidden="true"
        style={{ background: "var(--accent-soft)" }}
      />
    );
  }

  return <img src={url} alt={alt} className={className} />;
}
