import { GuideLayout } from "@/components/layout/GuideLayout";
import { ChapterGroups } from "@/components/Chapters";
import { GuideSearch } from "@/components/GuideSearch";
import { moneyGroups, moneyIntro } from "@/content/money-and-paperwork";

export default function MoneyAndPaperwork() {
  return (
    <GuideLayout title="Money and paperwork after" intro={moneyIntro}>
      <GuideSearch />

      <ChapterGroups groups={moneyGroups} />

      <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Nothing here is legal, tax or financial advice, and the rules differ
          by state. If you do one thing off this page, make it an hour with an
          accountant in the tax year your child died — it routinely pays for
          itself several times over.
        </p>
      </div>
    </GuideLayout>
  );
}
