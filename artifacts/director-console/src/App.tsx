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
import {
  SessionProvider,
  isSessionQuery,
  isUnauthorized,
  useSession,
} from "@/lib/session";
import { ConsoleShell } from "@/components/ConsoleShell";
import SignIn from "@/pages/SignIn";
import Cases from "@/pages/Cases";
import CaseDetail from "@/pages/CaseDetail";
import Settings from "@/pages/Settings";
import Vendors from "@/pages/Vendors";
import Requests from "@/pages/Requests";
import NotFound from "@/pages/NotFound";

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message || "Please check your connection and try again.";
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // A 401 is handled by showing the sign-in page; the session check
      // itself never toasts, because it runs on the sign-in page too.
      if (isUnauthorized(error) || isSessionQuery(query.queryKey)) return;
      toast({
        title: "Couldn't load that",
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
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 15_000 },
  },
});

/**
 * The gate. A director who is not signed in sees the front door on every
 * route, rather than a flash of an empty case list.
 */
function Routes() {
  const { session, isPending } = useSession();

  if (isPending) return null;
  if (!session) return <SignIn />;

  return (
    <ConsoleShell>
      <Switch>
        <Route path="/" component={Cases} />
        <Route path="/cases/:caseId" component={CaseDetail} />
        <Route path="/requests" component={Requests} />
        <Route path="/vendors" component={Vendors} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </ConsoleShell>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SessionProvider>
          <Routes />
          <Toaster />
        </SessionProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
