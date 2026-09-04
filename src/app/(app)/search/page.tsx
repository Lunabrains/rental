import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { SearchPage } from "@/components/search/search-page";

export const metadata = { title: "Search" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SearchPage />
    </Suspense>
  );
}
