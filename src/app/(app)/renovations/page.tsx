import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { RenovationsPage } from "@/components/operations/renovations-page";

export const metadata = { title: "Renovations & CapEx" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RenovationsPage />
    </Suspense>
  );
}
