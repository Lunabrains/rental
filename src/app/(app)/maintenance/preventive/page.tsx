import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { PreventivePage } from "@/components/maintenance/preventive-page";

export const metadata = { title: "Preventive maintenance" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PreventivePage />
    </Suspense>
  );
}
