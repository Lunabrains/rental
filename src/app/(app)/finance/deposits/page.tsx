import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { DepositsPage } from "@/components/finance/deposits-page";

export const metadata = { title: "Security deposits" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DepositsPage />
    </Suspense>
  );
}
