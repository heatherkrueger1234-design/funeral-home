import { Switch, Route } from "wouter";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { toast } from "@/hooks/use-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LinkProvider, isUnauthorized } from "@/lib/link";
import { PortalShell } from "@/components/PortalShell";
import Hub from "@/pages/Hub";
import Photos from "@/pages/Photos";
import Obituary from "@/pages/Obituary";
import Selections from "@/pages/Selections";
import Timeline from "@/pages/Timeline";
import Messages from "@/pages/Messages";
import Aftercare from "@/pages/Aftercare";
import Belongings from "@/pages/Belongings";
import Local from "@/pages/Local";
import NotFound from "@/pages/NotFound";

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message || "Please check your connection and try again.";
}

/**
 * A failed request must never be invisible: a failed photo upload that looks
 * like nothing happened is how a family ends up sending the same forty
 * pictures to the director by email anyway.
 *
 * The exception is a 401, which means the link has stopped working. The shell
 * already replaces the whole screen with an explanation in that case, and a
 * red error box on top of it would only add noise.
 */
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (isUnauthorized(error)) return;
      toast({
        title: "Couldn't load this",
        description: describeError(error),
        variant: "destructive",
      });
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      if (isUnauthorized(error)) return;
      toast({
        title: "That didn't save",
        description: describeError(error),
        variant: "destructive",
      });
    },
  }),
  defaultOptions: {
    queries: {
      // These screens are read on a phone on mobile data. Refetching on every
      // window focus costs the family bandwidth for data that changes when
      // their director gets round to it, not by the second.
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LinkProvider>
          <PortalShell>
            <Switch>
              <Route path="/" component={Hub} />
              {/* The link's own URL, before it is rewritten to "/". */}
              <Route path="/f/:token" component={Hub} />
              <Route path="/photos" component={Photos} />
              <Route path="/obituary" component={Obituary} />
              <Route path="/service" component={Selections} />
              <Route path="/timeline" component={Timeline} />
              <Route path="/messages" component={Messages} />
              <Route path="/aftercare" component={Aftercare} />
              <Route path="/belongings" component={Belongings} />
              <Route path="/local" component={Local} />
              <Route component={NotFound} />
            </Switch>
          </PortalShell>
          <Toaster />
        </LinkProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
