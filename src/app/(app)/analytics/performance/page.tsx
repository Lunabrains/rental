import { Suspense } from "react";

import { PerformancePage } from "@/components/analytics/performance-page";
import { PageSkeleton } from "@/components/common/states";

export const metadata = { title: "Portfolio performance" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PerformancePage />
    </Suspense>
  );
}
