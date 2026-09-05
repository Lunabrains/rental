import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { ChargesPage } from "@/components/finance/charges-page";

export const metadata = { title: "Common charges" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ChargesPage />
    </Suspense>
  );
}
