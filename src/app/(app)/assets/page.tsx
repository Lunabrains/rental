import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { AssetsPage } from "@/components/maintenance/assets-page";

export const metadata = { title: "Assets" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AssetsPage />
    </Suspense>
  );
}
