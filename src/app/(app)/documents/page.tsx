import { Suspense } from "react";

import { PageSkeleton } from "@/components/common/states";
import { DocumentsPage } from "@/components/documents/documents-page";

export const metadata = { title: "Documents" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DocumentsPage />
    </Suspense>
  );
}
