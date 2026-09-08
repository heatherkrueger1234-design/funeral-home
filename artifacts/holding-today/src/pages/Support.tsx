import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Donate } from "@/components/Donate";

export default function Support() {
  return (
    <PageLayout>
      <PageHeader
        title="Support this place"
        description="Holding Today is free, and it stays free."
      />
      <div className="max-w-3xl">
        <Donate />
      </div>
    </PageLayout>
  );
}
