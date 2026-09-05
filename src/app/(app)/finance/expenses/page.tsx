import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { ExpensesPage } from "@/components/finance/expenses-page";

export const metadata = { title: "Expenses" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ExpensesPage />
    </Suspense>
  );
}
