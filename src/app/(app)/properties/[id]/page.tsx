import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { BuildingPage } from "@/components/properties/building-page";

export const metadata = { title: "Building" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BuildingPage propertyId={id} />
    </Suspense>
  );
}
