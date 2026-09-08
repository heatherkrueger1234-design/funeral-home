import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { GuideLayout } from "@/components/layout/GuideLayout";
import { ChapterGroups } from "@/components/Chapters";
import { GuideSearch } from "@/components/GuideSearch";
import {
  familyFriendsGroups,
  familyFriendsIntro,
} from "@/content/for-family-and-friends";

/**
 * The page a parent sends to everyone else. The copy-link button is the
 * feature: this page only does its job if it is easy to hand over, and
 * "forward this to people" is a much smaller ask than explaining any of it.
 */
function CopyLink() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused outright. The address bar still has
      // the link, so there is nothing to recover from and nothing worth
      // interrupting the reader about.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-foreground/90 hover:bg-white/10 transition-colors"
    >
      {copied ? (
        <>
          <Check className="w-4 h-4 text-emerald-300" />
          Link copied
        </>
      ) : (
        <>
          <Link2 className="w-4 h-4" />
          Copy the link to this page
        </>
      )}
    </button>
  );
}

export default function ForFamilyAndFriends() {
  return (
    <GuideLayout title="For family and friends" intro={familyFriendsIntro}>
      <div className="mb-8 rounded-2xl border border-primary/20 bg-primary/[0.06] p-5 md:p-6">
        <p className="text-foreground/85 leading-relaxed mb-4">
          If you are the parent: this page needs no account and no sign-in.
          Send it to anyone. You do not have to add anything to it — that is
          the point of it existing.
        </p>
        <CopyLink />
      </div>

      <GuideSearch />

      <ChapterGroups groups={familyFriendsGroups} />
    </GuideLayout>
  );
}
