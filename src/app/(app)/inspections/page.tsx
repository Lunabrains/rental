import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { InspectionsPage } from "@/components/operations/inspections-page";

export const metadata = { title: "Inspections" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <InspectionsPage />
    </Suspense>
  );
}
