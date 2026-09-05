import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { CashFlowPage } from "@/components/finance/cashflow-page";

export const metadata = { title: "Cash flow & forecast" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CashFlowPage />
    </Suspense>
  );
}
