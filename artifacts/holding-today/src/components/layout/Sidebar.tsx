import { useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useGetProfile } from "@workspace/api-client-react";
import {
  Heart, BookOpen, Image as ImageIcon, Mail, FileText,
  PenTool, Music, Quote, CheckSquare, Sparkles,
  Map, Users, Activity, Feather, LifeBuoy, Menu, X, UserCircle,
  Package, Church, Sunrise, Scale, Banknote, HeartHandshake, MessagesSquare, HandHeart,
  Images
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Yesterday, today, tomorrow.
 *
 * The app had grown to eighteen flat items, then more, presented to someone
 * who may be three days into the worst thing that will ever happen to them.
 * Grouping by *when* rather than by feature turns "which of these twenty-four
 * things do I need" into a question a person in shock can actually answer:
 * what you keep of them, what is in front of you today, and what is coming.
 *
 * The guides sit under Tomorrow because that is what they are for — the
 * decisions that have not been made yet.
 */
const navGroups: { heading: string | null; blurb?: string; items: NavItem[] }[] = [
  {
    heading: null,
    items: [{ href: "/", label: "Home", icon: Heart }],
  },
  {
    heading: "Yesterday",
    blurb: "Them, and what you keep",
    items: [
      { href: "/profile", label: "Their profile", icon: Sparkles },
      { href: "/memories", label: "Memory wall", icon: ImageIcon },
      { href: "/albums", label: "Albums", icon: Images },
      { href: "/quotes", label: "Quotes & songs", icon: Music },
      { href: "/spirit", label: "Spirit & signs", icon: Activity },
      { href: "/stories", label: "Shared stories", icon: Users },
      { href: "/tribute", label: "Tribute & honors", icon: Feather },
    ],
  },
  {
    heading: "Today",
    blurb: "What is in front of you",
    items: [
      { href: "/journal", label: "My journal", icon: BookOpen },
      { href: "/letters", label: "Letters", icon: Mail },
      { href: "/creative", label: "Creative work", icon: PenTool },
      { href: "/affirmations", label: "Affirmations", icon: Quote },
      { href: "/todos", label: "To-do list", icon: CheckSquare },
      { href: "/documents", label: "Important records", icon: FileText },
      { href: "/contacts", label: "People to tell", icon: Users },
      { href: "/belongings", label: "Their things", icon: Package },
      { href: "/obituary", label: "The obituary", icon: FileText },
      { href: "/memorial", label: "The memorial", icon: Church },
    ],
  },
  {
    heading: "Tomorrow",
    blurb: "What is coming, and what nobody tells you",
    items: [
      { href: "/milestones", label: "The calendar", icon: Map },
      { href: "/first-days", label: "The first days", icon: Sunrise },
      { href: "/healing", label: "What to expect", icon: LifeBuoy },
      { href: "/money", label: "Money & paperwork", icon: Banknote },
      { href: "/public-or-criminal", label: "If it was public", icon: Scale },
      { href: "/for-family-and-friends", label: "For family & friends", icon: HeartHandshake },
      { href: "/groups", label: "Grief groups", icon: Users },
      { href: "/room", label: "The room", icon: MessagesSquare },
    ],
  },
  {
    heading: null,
    items: [
      { href: "/account", label: "Your account", icon: UserCircle },
      { href: "/support", label: "Support this place", icon: HandHeart },
    ],
  },
];

type NavItem = { href: string; label: string; icon: typeof Heart };

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();

  return (
    <div className="flex-1 overflow-y-auto py-4 px-3">
      {navGroups.map((group, groupIndex) => (
        <div key={group.heading ?? `group-${groupIndex}`} className={groupIndex > 0 ? "mt-6" : ""}>
          {group.heading && (
            <div className="px-4 mb-2">
              <p className="text-[11px] uppercase tracking-[0.16em] text-primary/60">
                {group.heading}
              </p>
              {group.blurb && (
                <p className="text-[11px] text-muted-foreground/45 mt-0.5">
                  {group.blurb}
                </p>
              )}
            </div>
          )}
          <div className="space-y-1">
            {group.items.map((item) => {
              const isActive = location === item.href;
              return (
                <Link key={item.href} href={item.href} className="block" onClick={onNavigate}>
                  <div className={cn(
                    "flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 group cursor-pointer relative",
                    isActive
                      ? "bg-primary/20 text-primary shadow-[inset_0_0_12px_rgba(14,165,233,0.2)]"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  )}>
                    <item.icon className={cn("w-5 h-5 flex-shrink-0 transition-colors", isActive ? "text-primary" : "text-muted-foreground group-hover:text-primary/70")} />
                    <span className="font-medium text-sm">{item.label}</span>
                    {isActive && (
                      <motion.div
                        layoutId="sidebar-active"
                        className="absolute left-0 w-1 h-8 bg-primary rounded-r-full"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                      />
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProfileHeader() {
  const { data: profile } = useGetProfile();
  return (
    <div className="p-6 flex flex-col items-center border-b border-white/5 flex-shrink-0">
      <div className="w-20 h-20 rounded-full overflow-hidden bg-secondary border-2 border-primary/30 flex items-center justify-center mb-4 shadow-[0_0_15px_rgba(14,165,233,0.3)]">
        {profile?.photoUrl ? (
          <img src={profile.photoUrl} alt={profile.childName} className="w-full h-full object-cover" />
        ) : (
          <Heart className="w-8 h-8 text-primary/60" />
        )}
      </div>
      <h2 className="font-display text-lg font-medium text-center text-foreground">
        {profile?.childName ? `For ${profile.childName}` : "Holding Today"}
      </h2>
    </div>
  );
}

export function MobileHeader() {
  const [open, setOpen] = useState(false);
  const { data: profile } = useGetProfile();

  return (
    <>
      {/* Mobile top bar */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3 bg-background/95 backdrop-blur-md border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full overflow-hidden bg-secondary border border-primary/30 flex items-center justify-center">
            {profile?.photoUrl ? (
              <img src={profile.photoUrl} alt={profile.childName} className="w-full h-full object-cover" />
            ) : (
              <Heart className="w-4 h-4 text-primary/60" />
            )}
          </div>
          <span className="font-display text-sm font-medium text-foreground">
            {profile?.childName ? `For ${profile.childName}` : "Holding Today"}
          </span>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 text-foreground active:bg-white/10"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
      </header>

      {/* Mobile drawer overlay */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/60 z-50 md:hidden"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="fixed top-0 left-0 bottom-0 w-72 z-50 md:hidden flex flex-col bg-[hsl(220,40%,8%)] border-r border-white/10"
            >
              <div className="flex items-center justify-between px-4 py-4 border-b border-white/10 flex-shrink-0">
                <span className="font-display text-base text-foreground font-medium">Navigation</span>
                <button
                  onClick={() => setOpen(false)}
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 text-muted-foreground active:bg-white/10"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ProfileHeader />
              <NavList onNavigate={() => setOpen(false)} />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

export function Sidebar() {
  return (
    <div className="w-64 h-screen fixed left-0 top-0 bg-[hsl(220,40%,7%)] border-r border-white/10 flex-col hidden md:flex z-40">
      <ProfileHeader />
      <NavList />
    </div>
  );
}
