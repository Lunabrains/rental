import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { UnitPage } from "@/components/units/unit-page";

export const metadata = { title: "Unit" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<PageSkeleton />}>
      <UnitPage unitId={decodeURIComponent(id)} />
    </Suspense>
  );
}
