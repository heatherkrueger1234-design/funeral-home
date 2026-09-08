import { GuideLayout } from "@/components/layout/GuideLayout";
import { ChapterGroups } from "@/components/Chapters";
import { GuideSearch } from "@/components/GuideSearch";
import { firstDaysGroups, firstDaysIntro } from "@/content/first-days";

export default function FirstDays() {
  return (
    <GuideLayout title="The first days" intro={firstDaysIntro} crisisLine>
      <GuideSearch />

      <ChapterGroups groups={firstDaysGroups} />

      <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Every legal statement here names the state it applies to, because the
          answers genuinely differ across a county line. Nothing on this page is
          legal or medical advice, and the offices named in each chapter — your
          county registrar, the coroner, the state vital records office — are
          the ones who can tell you what is true where you are.
        </p>
      </div>
    </GuideLayout>
  );
}
