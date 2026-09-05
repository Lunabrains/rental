import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { UtilitiesPage } from "@/components/finance/utilities-page";

export const metadata = { title: "Utilities" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <UtilitiesPage />
    </Suspense>
  );
}
