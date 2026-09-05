import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { BudgetsPage } from "@/components/finance/budgets-page";

export const metadata = { title: "Budgets" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BudgetsPage />
    </Suspense>
  );
}
