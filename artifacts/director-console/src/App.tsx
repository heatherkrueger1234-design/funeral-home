import { lazy, Suspense } from "react";
import { Switch, Route, Router, useLocation } from "wouter";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { toast } from "@/hooks/use-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import {
  SessionProvider,
  isSessionQuery,
  isUnauthorized,
  useSession,
} from "@/lib/session";
import { ConsoleShell } from "@/components/ConsoleShell";
import SignIn from "@/pages/SignIn";
import { Loading } from "@/components/page";
import { BASE_PATH } from "@/lib/base";
/*
 * Eager, unlike every other screen below, and on purpose: these two are where
 * an emailed link lands. Somebody who has forgotten their password, or who is
 * confirming an address on a phone they have never signed in on, should not
 * wait on a second download to get in — and both pages are small enough that
 * deferring them would save nothing worth having.
 */
import ChoosePassword from "@/pages/ChoosePassword";
import VerifyEmail from "@/pages/VerifyEmail";
import Dashboard from "@/pages/Dashboard";
import NotFound from "@/pages/NotFound";

/*
 * The sign-in page and the morning dashboard are in the first download;
 * every other screen is fetched the first time it is opened. The case page
 * alone carries the print proofs, the vitals form and the photo tools, and a
 * director opening the console to see who is waiting should not have to
 * download all of that first.
 */
const Inbox = lazy(() => import("@/pages/Inbox"));
const Storefront = lazy(() => import("@/pages/Storefront"));
const PriceList = lazy(() => import("@/pages/PriceList"));
const Cases = lazy(() => import("@/pages/Cases"));
const CaseDetail = lazy(() => import("@/pages/CaseDetail"));
const Settings = lazy(() => import("@/pages/Settings"));
const Vendors = lazy(() => import("@/pages/Vendors"));
const Requests = lazy(() => import("@/pages/Requests"));

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message || "Please check your connection and try again.";
}

/*
 * A 401 anywhere but the session check means the session has gone — it
 * expired overnight, or the owner took this person's access away. Re-reading
 * the session puts the sign-in page in front of them. Before this, every
 * screen quietly rendered empty and stayed that way until somebody reloaded.
 */
function sessionEnded() {
  void queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // A 401 is handled by showing the sign-in page; the session check
      // itself never toasts, because it runs on the sign-in page too.
      if (isSessionQuery(query.queryKey)) return;
      if (isUnauthorized(error)) return sessionEnded();
      toast({
        title: "Couldn't load that",
        description: describeError(error),
        variant: "destructive",
      });
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (isUnauthorized(error)) return sessionEnded();
      /*
       * A screen that handles its own failure says so in its own words — the
       * sign-in form, the print studio. Toasting here as well put two
       * messages about one mistake on screen, one of them generic.
       */
      if (mutation.options.onError) return;
      toast({
        title: "That didn't save",
        description: describeError(error),
        variant: "destructive",
      });
    },
  }),
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 15_000 },
  },
});

/**
 * The gate. A director who is not signed in sees the front door on every
 * route, rather than a flash of an empty case list.
 */
function Routes() {
  const { session, isPending } = useSession();
  const [path] = useLocation();

  if (isPending) return null;

  /*
   * The two screens an email link lands on, above the gate.
   *
   * These have to come before the session check, and for a while they did not
   * exist at all — which meant the three emails pointing at `/reset-password`
   * showed a sign-in form instead. A director could not reset their password,
   * and every staff invitation silently went nowhere.
   *
   * Above it rather than inside it because the person holding the link usually
   * has no session: they have forgotten their password, or they have never had
   * an account here, or they are reading the email on a phone they have never
   * signed in on. The token in the URL is the credential, and each one is
   * single-use.
   */
  if (path === "/reset-password") return <ChoosePassword />;
  if (path === "/verify-email") return <VerifyEmail />;

  if (!session) return <SignIn />;

  return (
    <ConsoleShell>
      <Suspense fallback={<Loading />}>
        <Switch>
          {/*
          The home's own page is the landing screen, and the case list moved
          one click away. A director arriving in the morning needs to know
          what is waiting on them before they need a list of everyone they
          have ever buried.
        */}
          <Route path="/" component={Dashboard} />
          <Route path="/cases" component={Cases} />
          <Route path="/cases/:caseId" component={CaseDetail} />
          <Route path="/inbox" component={Inbox} />
          <Route path="/requests" component={Requests} />
          <Route path="/vendors" component={Vendors} />
          <Route path="/storefront" component={Storefront} />
          <Route path="/prices" component={PriceList} />
          <Route path="/settings" component={Settings} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </ConsoleShell>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SessionProvider>
          <Router base={BASE_PATH}>
            <Routes />
          </Router>
          <Toaster />
        </SessionProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
