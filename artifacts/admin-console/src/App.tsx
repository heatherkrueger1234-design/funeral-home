import { useCallback, useState } from "react";
import { Route, Router, Switch, useParams } from "wouter";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, isForbidden, isUnauthorized } from "@/lib/api";
import { Shell } from "@/components/Shell";
import { Button, Card, Missing } from "@/components/ui";
import { SignIn } from "@/pages/SignIn";
import { Overview } from "@/pages/Overview";
import { Homes } from "@/pages/Homes";
import { HomeDetail } from "@/pages/HomeDetail";
import { Audit } from "@/pages/Audit";
import { Groups } from "@/pages/Groups";
import { GroupDetail } from "@/pages/GroupDetail";
import { Admins } from "@/pages/Admins";
import { BASE_PATH } from "@/lib/base";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 401 or a 403 is an answer, not a failure. Retrying either just
      // makes the sign-in page take four seconds to appear.
      retry: (count, error) =>
        !isUnauthorized(error) && !isForbidden(error) && count < 1,
      refetchOnWindowFocus: true,
      staleTime: 15_000,
    },
  },
});

type Session = { user: { email: string; emailVerified: boolean } };

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

  if (session.isPending) return null;

  if (!session.data || isUnauthorized(session.error)) {
    return <SignIn onSignedIn={refresh} />;
  }

  if (access.isPending) return null;

  if (isUnauthorized(access.error)) return <SignIn onSignedIn={refresh} />;

  if (access.error) {
    return (
      <NotForYou
        unconfirmed={!session.data.user.emailVerified}
        forbidden={isForbidden(access.error)}
        onRetry={() => void access.refetch()}
        onSignedOut={signedOut}
      />
    );
  }

  return (
    <Shell signedInAs={session.data.user.email} onSignedOut={signedOut}>
      <Switch>
        <Route path="/" component={Overview} />
        <Route path="/homes" component={Homes} />
        <Route path="/homes/:homeId" component={HomeRoute} />
        <Route path="/groups" component={Groups} />
        <Route path="/groups/:groupId" component={GroupRoute} />
        <Route path="/audit" component={Audit} />
        <Route path="/admins" component={Admins} />
        <Route component={NotFound} />
      </Switch>
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

  return <HomeDetail homeId={parsed} />;
}

function GroupRoute() {
  const { groupId } = useParams<{ groupId: string }>();
  const parsed = Number(groupId);

  if (!Number.isInteger(parsed) || parsed <= 0) return <NotFound />;

  return <GroupDetail groupId={parsed} />;
}

function NotFound() {
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
