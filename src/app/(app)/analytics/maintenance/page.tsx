import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { MaintenanceAnalyticsPage } from "@/components/analytics/maintenance-analytics-page";

export const metadata = { title: "Maintenance analytics" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MaintenanceAnalyticsPage />
    </Suspense>
  );
}
