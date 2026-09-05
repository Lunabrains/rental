import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { ImportPage } from "@/components/import/import-page";

export const metadata = { title: "Data Import" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ImportPage />
    </Suspense>
  );
}
