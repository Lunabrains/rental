import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { ExpenseAnalyticsPage } from "@/components/analytics/expense-analytics-page";

export const metadata = { title: "Expense analytics" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ExpenseAnalyticsPage />
    </Suspense>
  );
}
