import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { KeysPage } from "@/components/operations/keys-page";

export const metadata = { title: "Keys & access" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <KeysPage />
    </Suspense>
  );
}
