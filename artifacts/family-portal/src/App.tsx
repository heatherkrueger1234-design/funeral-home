import { lazy, Suspense } from "react";
import { Switch, Route, Router } from "wouter";
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
import { BASE_PATH } from "@/lib/base-path";
import { Loading } from "@/components/page";
import Hub from "@/pages/Hub";
import Start from "@/pages/Start";
import NotFound from "@/pages/NotFound";

/*
 * The two screens anybody lands on — the hub a texted link opens, and the
 * home's public front door — are in the first download. Everything else is
 * fetched when it is first opened. The family reads this on a phone, often on
 * mobile data in a hospital car park, and the first screen should not wait
 * on the code for a death-certificate form they may never open.
 */
const Photos = lazy(() => import("@/pages/Photos"));
const Obituary = lazy(() => import("@/pages/Obituary"));
const Selections = lazy(() => import("@/pages/Selections"));
const Timeline = lazy(() => import("@/pages/Timeline"));
const ServiceTime = lazy(() => import("@/pages/ServiceTime"));
const Messages = lazy(() => import("@/pages/Messages"));
const Aftercare = lazy(() => import("@/pages/Aftercare"));
const Belongings = lazy(() => import("@/pages/Belongings"));
const Local = lazy(() => import("@/pages/Local"));
const Vitals = lazy(() => import("@/pages/Vitals"));
const Proofs = lazy(() => import("@/pages/Proofs"));

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
          <Router base={BASE_PATH}>
            {/*
            The home's public front door sits outside PortalShell entirely.
            The shell's whole job is to frame a case the reader has a link to;
            this is read by people who have no link and, in the pre-need case,
            no bereavement either, so it carries none of that furniture.
          */}
            <Switch>
              <Route path="/start/:slug" component={Start} />
              <Route>
                <PortalShell>
                  <Suspense fallback={<Loading />}>
                    <Switch>
                      <Route path="/" component={Hub} />
                      {/* The link's own URL, before it is rewritten to "/". */}
                      <Route path="/f/:token" component={Hub} />
                      <Route path="/photos" component={Photos} />
                      <Route path="/obituary" component={Obituary} />
                      <Route path="/service" component={Selections} />
                      <Route path="/timeline" component={Timeline} />
                      <Route path="/service-time" component={ServiceTime} />
                      <Route path="/messages" component={Messages} />
                      <Route path="/aftercare" component={Aftercare} />
                      <Route path="/belongings" component={Belongings} />
                      <Route path="/local" component={Local} />
                      <Route path="/certificate" component={Vitals} />
                      <Route path="/proofs" component={Proofs} />
                      <Route component={NotFound} />
                    </Switch>
                  </Suspense>
                </PortalShell>
              </Route>
            </Switch>
          </Router>
          <Toaster />
        </LinkProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
