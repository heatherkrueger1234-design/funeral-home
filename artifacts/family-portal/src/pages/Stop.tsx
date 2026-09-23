import { useEffect } from "react";
import {
  useAftercareUnsubscribe,
  useGetAftercareUnsubscribe,
  getGetAftercareUnsubscribeQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

/**
 * Where "stop these notes" at the foot of a grief check-in lands.
 *
 * Outside the portal shell, like the public front door, because the person
 * arriving here may not have a working link any more — the anniversary note
 * comes long after the texted one has expired — and does not need one: the
 * signed token in this address is enough to stop these notes and nothing else.
 *
 * It asks before it acts, rather than stopping on arrival, because mail
 * scanners and link previews open every address in a message and a note
 * must not be stopped by a robot. One button, no persuasion, and the answer
 * is final, exactly as a "no" in the portal is.
 */

function tokenFromQuery(): string {
  try {
    return new URLSearchParams(window.location.search).get("token") ?? "";
  } catch {
    return "";
  }
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh grid place-items-center px-5 py-16">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-[var(--elevation-2)] sm:p-9">
        {children}
      </div>
    </div>
  );
}

export default function Stop() {
  const token = tokenFromQuery();

  useEffect(() => {
    document.title = "Stop the check-in notes";
  }, []);

  const state = useGetAftercareUnsubscribe(
    { token },
    {
      query: {
        queryKey: getGetAftercareUnsubscribeQueryKey({ token }),
        enabled: token.length > 0,
        retry: false,
      },
    },
  );

  const stop = useAftercareUnsubscribe();

  if (!token || state.isError) {
    return (
      <Frame>
        <h1 className="font-display text-[1.6rem] leading-tight">
          We could not find these notes
        </h1>
        <p className="mt-3 text-muted-foreground">
          They may already have been stopped. If they keep arriving, telephone
          the funeral home or reply to one of the notes, and they will stop
          them for you.
        </p>
      </Frame>
    );
  }

  if (state.isPending) {
    return (
      <Frame>
        <div className="animate-pulse space-y-3" role="status" aria-label="Loading">
          <div className="h-7 w-2/3 rounded-md bg-[var(--muted)]" />
          <div className="h-4 w-full rounded-md bg-[var(--muted)]/70" />
        </div>
      </Frame>
    );
  }

  const homeName = stop.data?.homeName ?? state.data.homeName;
  const stopped = stop.isSuccess || state.data.stopped;

  if (stopped) {
    return (
      <Frame>
        <h1 className="font-display text-[1.6rem] leading-tight" role="status">
          That's stopped
        </h1>
        <p className="mt-3 text-muted-foreground">
          You won't receive any more of these notes. {homeName} is still there
          if you ever need them.
        </p>
      </Frame>
    );
  }

  return (
    <Frame>
      <h1 className="font-display text-[1.6rem] leading-tight">
        Stop the notes from {homeName}?
      </h1>
      <p className="mt-3 text-muted-foreground">
        These are the short check-ins over the year after the funeral. If you
        stop them, none of the rest will be sent, and you won't be asked again.
      </p>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="mt-6 w-full"
        disabled={stop.isPending}
        onClick={() => stop.mutate({ params: { token } })}
      >
        {stop.isPending && <Loader2 className="size-4 animate-spin" />}
        Stop these notes
      </Button>
    </Frame>
  );
}
