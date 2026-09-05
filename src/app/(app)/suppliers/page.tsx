import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { SuppliersPage } from "@/components/maintenance/suppliers-page";

export const metadata = { title: "Suppliers" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SuppliersPage />
    </Suspense>
  );
}
