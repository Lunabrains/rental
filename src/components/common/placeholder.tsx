import { Construction } from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/states";

interface PlaceholderPageProps {
  title: string;
  description?: string;
  phase: number;
}

/** Temporary route body until the real screen lands in its build phase. */
export function PlaceholderPage({ title, description, phase }: PlaceholderPageProps) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={Construction}
        title={`${title} arrives in Phase ${phase}`}
        description="The shell is wired; this screen is built in its own phase of the implementation plan."
      />
    </div>
  );
}
