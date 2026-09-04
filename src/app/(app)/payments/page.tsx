import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { PaymentsPage } from "@/components/payments/payments-page";

export const metadata = { title: "Payments" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PaymentsPage />
    </Suspense>
  );
}
