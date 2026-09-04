import { Suspense } from "react";

import { AlertsPage } from "@/components/alerts/alerts-page";
import { PageSkeleton } from "@/components/common/states";

export const metadata = { title: "Alerts" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AlertsPage />
    </Suspense>
  );
}
