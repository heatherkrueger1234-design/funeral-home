import { useEffect, useState } from "react";
import { useRenderFamilyPrintItem } from "@workspace/api-client-react";

/**
 * An object URL for a rendered proof, from behind the family link.
 *
 * The family surface is gated by `Authorization: Bearer <token>` — there is
 * no cookie, deliberately, because a family has no account. A plain
 * `<iframe src="/api/family/print/12/render">` (or a bare `<a href>` to the
 * same address) is a request the browser makes on its own, and the browser
 * has nowhere to put that header — the same problem `AuthedImage` solves for
 * photographs. So the HTML is fetched the same way every other family
 * request is, handed to the caller as an object URL, and released when the
 * proof leaves the screen.
 */
export function useAuthedPrintUrl(printItemId: number) {
  const { data: blob, isPending, isError } = useRenderFamilyPrintItem(printItemId, {
    query: {
      queryKey: [`/api/family/print/${printItemId}/render`],
      staleTime: 60_000,
      retry: 1,
    },
    // The response is `text/html`, and `customFetch`'s auto-detection reads
    // any `text/*` type as a string rather than a Blob — forced here because
    // we need the latter to hand the browser an object URL.
    request: { responseType: "blob" },
  });

  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setSrc(null);
      return;
    }

    const url = URL.createObjectURL(blob);
    setSrc(url);

    return () => {
      URL.revokeObjectURL(url);
      setSrc(null);
    };
  }, [blob]);

  return { src, isPending, isError };
}
