import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { WorkOrdersPage } from "@/components/maintenance/work-orders-page";

export const metadata = { title: "Work orders" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <WorkOrdersPage />
    </Suspense>
  );
}
