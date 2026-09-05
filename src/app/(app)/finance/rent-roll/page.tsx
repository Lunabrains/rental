import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { RentRollPage } from "@/components/finance/rent-roll-page";

export const metadata = { title: "Rent roll" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RentRollPage />
    </Suspense>
  );
}
