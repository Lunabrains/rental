import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { ContractsPage } from "@/components/contracts/contracts-page";

export const metadata = { title: "Contracts" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ContractsPage />
    </Suspense>
  );
}
