import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { PortfolioAnalyticsPage } from "@/components/analytics/portfolio-page";

export const metadata = { title: "Portfolio analytics" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PortfolioAnalyticsPage />
    </Suspense>
  );
}
