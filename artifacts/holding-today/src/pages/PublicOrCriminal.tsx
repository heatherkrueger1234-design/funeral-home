import { GuideLayout } from "@/components/layout/GuideLayout";
import { ChapterGroups } from "@/components/Chapters";
import { GuideSearch } from "@/components/GuideSearch";
import {
  publicOrCriminalGroups,
  publicOrCriminalIntro,
} from "@/content/public-or-criminal";

export default function PublicOrCriminal() {
  return (
    <GuideLayout
      title="If it was public, or criminal"
      intro={publicOrCriminalIntro}
      crisisLine
    >
      <GuideSearch />

      <ChapterGroups groups={publicOrCriminalGroups} />

      <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Nothing here is legal advice, and victims' rights, compensation
          deadlines and limitation periods differ in every state. The one person
          who can answer all of it for your case, for free, is the victim
          advocate attached to the prosecutor's office. If nobody has offered you
          one, ask for one by name.
        </p>
      </div>
    </GuideLayout>
  );
}
