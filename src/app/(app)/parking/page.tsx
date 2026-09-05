import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { ParkingPage } from "@/components/operations/parking-page";

export const metadata = { title: "Parking" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ParkingPage />
    </Suspense>
  );
}
