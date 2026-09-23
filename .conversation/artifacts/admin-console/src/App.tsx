import { useCallback } from "react";
import { Route, Switch, useParams, Link } from "wouter";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, isForbidden, isUnauthorized } from "@/lib/api";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { SignIn } from "@/pages/SignIn";
import { Overview } from "@/pages/Overview";
import { Homes } from "@/pages/Homes";
import { HomeDetail } from "@/pages/HomeDetail";
import { Audit } from "@/pages/Audit";

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

type Session = { user: { email: string } };

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

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries();
  }, [queryClient]);

  if (session.isPending) return null;

  if (!session.data) return <SignIn onSignedIn={refresh} />;

  return (
    <Shell signedInAs={session.data.user.email} onSignedOut={refresh}>
      <Switch>
        <Route path="/" component={Overview} />
        <Route path="/homes" component={Homes} />
        <Route path="/homes/:homeId" component={HomeRoute} />
        <Route path="/audit" component={Audit} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function HomeRoute() {
  const { homeId } = useParams<{ homeId: string }>();
  const parsed = Number(homeId);

  if (!Number.isInteger(parsed) || parsed <= 0) return <NotFound />;

  return <HomeDetail homeId={parsed} />;
}

function NotFound() {
  return (
    <Card>
      <h1 className="font-display text-xl">That page isn't here</h1>
      <p className="mt-2 max-w-prose text-[var(--muted-foreground)]">
        The address may have changed, or the home may have been removed.
      </p>
      <Link href="/homes" className="mt-4 inline-block underline">
        Back to the homes
      </Link>
    </Card>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Gate />
    </QueryClientProvider>
  );
}
