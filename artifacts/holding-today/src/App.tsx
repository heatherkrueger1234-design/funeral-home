import { type ComponentType } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { toast } from "@/hooks/use-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider, isSessionQuery, isUnauthorized, useSession } from "@/lib/session";
import { CrisisButton } from "@/components/CrisisHelp";
import NotFound from "@/pages/not-found";
import SignIn from "@/pages/SignIn";
import Welcome from "@/pages/Welcome";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import Privacy from "@/pages/Privacy";
import Terms from "@/pages/Terms";
import Account from "@/pages/Account";
import Support from "@/pages/Support";

import Home from "@/pages/Home";
import Profile from "@/pages/Profile";
import Memories from "@/pages/Memories";
import Albums from "@/pages/Albums";
import Album from "@/pages/Album";
import Journal from "@/pages/Journal";
import Letters from "@/pages/Letters";
import Documents from "@/pages/Documents";
import SpiritSigns from "@/pages/SpiritSigns";
import Affirmations from "@/pages/Affirmations";
import Creative from "@/pages/Creative";
import Quotes from "@/pages/Quotes";
import Tribute from "@/pages/Tribute";
import Todos from "@/pages/Todos";
import Milestones from "@/pages/Milestones";
import Stories from "@/pages/Stories";
import Healing from "@/pages/Healing";
import Groups from "@/pages/Groups";
import FirstDays from "@/pages/FirstDays";
import PublicOrCriminal from "@/pages/PublicOrCriminal";
import MoneyAndPaperwork from "@/pages/MoneyAndPaperwork";
import ForFamilyAndFriends from "@/pages/ForFamilyAndFriends";
import Belongings from "@/pages/Belongings";
import Contacts from "@/pages/Contacts";
import ObituaryBuilder from "@/pages/ObituaryBuilder";
import MemorialPlanner from "@/pages/MemorialPlanner";
import SharedMemory from "@/pages/SharedMemory";
import Community from "@/pages/Community";
import Moderation from "@/pages/Moderation";

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message || "Please check your connection and try again.";
}

// Without these, a failed request is invisible: a failed save looks like
// nothing happened, and a failed load renders the "nothing here yet" empty
// state as though the data really were empty.
//
// Two exceptions. A 401 means the session ended, which the guard below already
// handles by showing the front door — toasting it is noise on top of a screen
// that already explains itself. And the session check itself never toasts at
// all, whatever it fails with: it runs on the public welcome page, and someone
// arriving here days after losing their child should not be met with a red
// error box because the API happened to be unreachable.
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (isUnauthorized(error) || isSessionQuery(query.queryKey)) return;
      toast({
        title: "Couldn't load this page",
        description: describeError(error),
        variant: "destructive",
      });
    },
  }),
  mutationCache: new MutationCache({
    // A screen that shows the failure itself says `shownInPlace` in its meta,
    // and gets no toast on top. Sign-in is the case that matters: "Couldn't
    // save that" floating in a corner is the wrong answer to a password that
    // was refused, and the form can say it better right under the box.
    onError: (error, _variables, _context, mutation) => {
      if (isUnauthorized(error) || mutation.meta?.shownInPlace === true) return;
      toast({
        title: "Couldn't save that",
        description: describeError(error),
        variant: "destructive",
      });
    },
  }),
});

/**
 * The written guides. These are readable without an account, because the
 * parent who needs the chapter on viewing a body is standing in a hospital
 * corridor and is not going to register for anything first. They are listed
 * once and mounted in both routers so the two can never drift apart — a guide
 * that works signed in and 404s signed out is the failure mode that matters
 * here.
 */
const GUIDE_ROUTES: { path: string; component: ComponentType }[] = [
  { path: "/first-days", component: FirstDays },
  { path: "/healing", component: Healing },
  { path: "/public-or-criminal", component: PublicOrCriminal },
  { path: "/money", component: MoneyAndPaperwork },
  { path: "/for-family-and-friends", component: ForFamilyAndFriends },
];

/**
 * Returned as an array rather than wrapped in a fragment: `Switch` walks its
 * direct children looking for routes to match, and a fragment would hide all
 * five from it.
 */
function guideRoutes() {
  return GUIDE_ROUTES.map(({ path, component }) => (
    <Route key={path} path={path} component={component} />
  ));
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/profile" component={Profile} />
      <Route path="/memories" component={Memories} />
      <Route path="/albums" component={Albums} />
      <Route path="/albums/:id" component={Album} />
      <Route path="/journal" component={Journal} />
      <Route path="/letters" component={Letters} />
      <Route path="/documents" component={Documents} />
      <Route path="/spirit" component={SpiritSigns} />
      <Route path="/affirmations" component={Affirmations} />
      <Route path="/creative" component={Creative} />
      <Route path="/quotes" component={Quotes} />
      <Route path="/tribute" component={Tribute} />
      <Route path="/todos" component={Todos} />
      <Route path="/belongings" component={Belongings} />
      <Route path="/contacts" component={Contacts} />
      <Route path="/obituary" component={ObituaryBuilder} />
      <Route path="/memorial" component={MemorialPlanner} />
      <Route path="/milestones" component={Milestones} />
      <Route path="/stories" component={Stories} />
      {guideRoutes()}
      <Route path="/groups" component={Groups} />
      <Route path="/room" component={Community} />
      <Route path="/moderation" component={Moderation} />
      <Route path="/shared/:token" component={SharedMemory} />
      <Route path="/account" component={Account} />
      <Route path="/support" component={Support} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route component={NotFound} />
    </Switch>
  );
}

/**
 * What someone who is not signed in is allowed to see: the front door, and
 * the form. Anything else sends them to the front door rather than 404ing —
 * a bereaved parent following a link should land somewhere gentle, not on an
 * error.
 */
function PublicRouter() {
  return (
    <Switch>
      <Route path="/signin" component={SignIn} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/shared/:token" component={SharedMemory} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      {guideRoutes()}
      <Route component={Welcome} />
    </Switch>
  );
}

/**
 * Nothing inside `Router` renders until we know who is asking. Every page
 * below reads someone's private writing, so "signed in" is checked once here
 * rather than page by page.
 */
function Gate() {
  const { user, isLoading } = useSession();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
      </div>
    );
  }

  return user ? <Router /> : <PublicRouter />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <SessionProvider>
            <Gate />
          </SessionProvider>
        </WouterRouter>
        {/*
          Outside the gate on purpose. The moment this button exists for is
          not one where somebody signs in first, so it renders on the welcome
          page and the sign-in form as much as on a private journal — every
          page, signed in or not, one tap.
        */}
        <CrisisButton />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
