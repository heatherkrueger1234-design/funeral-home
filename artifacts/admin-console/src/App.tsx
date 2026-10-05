import { useCallback, useState } from "react";
import { Route, Router, Switch, useLocation, useParams } from "wouter";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, isUnauthorized, worthRetrying } from "@/lib/api";
import { gateScreen, type Session } from "@/lib/gate";
import { Shell } from "@/components/Shell";
import { CrashBoundary } from "@/components/CrashBoundary";
import { Button, Card, ErrorState, Missing, usePageTitle } from "@/components/ui";
import { SignIn } from "@/pages/SignIn";
import { Overview } from "@/pages/Overview";
import { Homes } from "@/pages/Homes";
import { HomeDetail } from "@/pages/HomeDetail";
import { Audit } from "@/pages/Audit";
import { Groups } from "@/pages/Groups";
import { GroupDetail } from "@/pages/GroupDetail";
import { Admins } from "@/pages/Admins";
import { Plans } from "@/pages/Plans";
import { BASE_PATH } from "@/lib/base";

/** The gate's own two questions, which answer a 401 by themselves. */
const GATE_QUERIES = new Set(["session", "platform-access"]);

/*
 * A 401 from any panel means the session has gone -- it expired with the
 * console open overnight, or the admin was taken off the access list -- so
 * the gate asks again, and the sign-in form replaces the console. Before
 * this, each panel failed on its own with "Sign in again", and the console's
 * navigation stayed up around the failures until somebody reloaded.
 */
function sessionEnded() {
  void queryClient.invalidateQueries({ queryKey: ["session"] });
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (GATE_QUERIES.has(String(query.queryKey[0]))) return;
      if (isUnauthorized(error)) sessionEnded();
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      if (isUnauthorized(error)) sessionEnded();
    },
  }),
  defaultOptions: {
    queries: {
      retry: worthRetrying,
      /*
       * Off, because nearly every read in this console is an audited read.
       * Switching back to this tab used to re-open the home on screen, and
       * each re-open was another "Opened a home" in the log a customer is
       * shown -- a dozen lines for one look. The server now folds repeats
       * together too, but the console should not be the thing making them.
       * "Try again" and the saves that change a page still refetch it.
       */
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
  },
});

/**
 * The gate, and the two things that can be wrong.
 *
 * Signed out is the ordinary case and gets the front door. Signed in but not
 * a platform admin is the case that matters: it is a director who followed a
 * link, and what they get told is short, final, and gives away nothing about
 * what is on the other side.
 */
function Gate() {
  const queryClient = useQueryClient();
  const [location] = useLocation();

  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api.get<Session>("/auth/me"),
    retry: false,
  });

  // Asked once, before anything is drawn. Signed in is not the same as
  // allowed in, and finding that out by failing to load the overview used to
  // show a director the whole console's navigation around an error.
  const access = useQuery({
    queryKey: ["platform-access"],
    queryFn: () => api.get<{ email: string }>("/admin/me"),
    enabled: session.data !== undefined,
    retry: false,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries();
  }, [queryClient]);

  /*
   * Signing out resets every query rather than invalidating it. An
   * invalidated query that then fails keeps its *previous* data, so the
   * session query went on holding the signed-out user and "Sign out" left the
   * console on screen with every panel failing -- the sign-in form never
   * came back without a reload.
   */
  const signedOut = useCallback(() => {
    void queryClient.resetQueries();
  }, [queryClient]);

  const gate = gateScreen(session, access);

  if (gate.screen === "nothing") return null;

  if (gate.screen === "error") {
    return (
      <main className="mx-auto grid min-h-dvh max-w-md place-items-center px-6 py-12">
        <div className="w-full">
          <h1 className="sr-only">Continuum Aftercare platform console</h1>
          <ErrorState
            error={session.error}
            onRetry={() => void session.refetch()}
          />
        </div>
      </main>
    );
  }

  if (gate.screen === "sign-in") return <SignIn onSignedIn={refresh} />;

  if (gate.screen === "not-for-you") {
    return (
      <NotForYou
        unconfirmed={gate.unconfirmed}
        forbidden={gate.forbidden}
        onRetry={() => void access.refetch()}
        onSignedOut={signedOut}
      />
    );
  }

  return (
    <Shell signedInAs={gate.signedInAs} onSignedOut={signedOut}>
      {/* Keyed on the address, so the next screen clears a failed one and
          the navigation never goes with it. */}
      <CrashBoundary key={location}>
        <Switch>
          <Route path="/" component={Overview} />
          <Route path="/homes" component={Homes} />
          <Route path="/homes/:homeId" component={HomeRoute} />
          <Route path="/groups" component={Groups} />
          <Route path="/groups/:groupId" component={GroupRoute} />
          <Route path="/audit" component={Audit} />
          <Route path="/admins" component={Admins} />
          <Route path="/plans" component={Plans} />
          <Route component={NotFound} />
        </Switch>
      </CrashBoundary>
    </Shell>
  );
}

/**
 * Signed in, and not a platform admin. Short and final.
 *
 * The one extra sentence is for the account that is on the list but has not
 * confirmed its address yet -- which is how the platform's own owner meets
 * this screen on a fresh deployment, and without it they would be looking at
 * "not for you" with no idea why. It tells a director nothing they could use:
 * an unconfirmed account is told to confirm, which every screen of the
 * director console already tells it.
 */
function NotForYou({
  unconfirmed,
  forbidden,
  onRetry,
  onSignedOut,
}: {
  unconfirmed: boolean;
  forbidden: boolean;
  onRetry: () => void;
  onSignedOut: () => void;
}) {
  const [leaving, setLeaving] = useState(false);

  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center px-6 py-12">
      <Card className="w-full">
        <h1 className="font-display text-xl">
          {forbidden
            ? "There is nothing here for this account"
            : "That didn't load"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
          {forbidden
            ? "This is the platform console. If you work at a funeral home, your console is at a different address."
            : "Please check your connection and try again."}
        </p>
        {forbidden && unconfirmed && (
          <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
            If you expected to get in, confirm your email address first, using
            the link we sent when you registered.
          </p>
        )}
        <div className="mt-5 flex gap-3">
          {!forbidden && <Button onClick={onRetry}>Try again</Button>}
          <Button
            variant="plain"
            disabled={leaving}
            onClick={() => {
              setLeaving(true);
              void api
                .post("/auth/logout")
                .catch(() => undefined)
                .finally(onSignedOut);
            }}
          >
            {leaving ? "Signing out…" : "Sign out"}
          </Button>
        </div>
      </Card>
    </main>
  );
}

function HomeRoute() {
  const { homeId } = useParams<{ homeId: string }>();
  const parsed = Number(homeId);

  if (!Number.isInteger(parsed) || parsed <= 0) return <NotFound />;

  // Keyed on the home, so a half-typed suspension reason or an invitation's
  // outcome on one home's page cannot follow somebody to the next home they
  // open from the access log.
  return <HomeDetail key={parsed} homeId={parsed} />;
}

function GroupRoute() {
  const { groupId } = useParams<{ groupId: string }>();
  const parsed = Number(groupId);

  if (!Number.isInteger(parsed) || parsed <= 0) return <NotFound />;

  return <GroupDetail key={parsed} groupId={parsed} />;
}

function NotFound() {
  usePageTitle("Not found");

  return (
    <Missing
      title="That page isn't here"
      detail="The address may have been typed wrong, or it may have changed."
      back={{ href: "/", label: "Back to the overview" }}
    />
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/*
        "" on its own hostname; "/admin" on Replit, where one domain is split
        by path and every <Link href="/homes"> has to resolve beneath it.
        `lib/base` owns the expression, so the three apps cannot disagree.
      */}
      <Router base={BASE_PATH}>
        <Gate />
      </Router>
    </QueryClientProvider>
  );
}
