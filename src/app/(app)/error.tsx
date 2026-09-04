"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/common/states";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      title="This screen hit an error"
      description={error.message || "Something went wrong while rendering. The rest of the app is unaffected."}
      onRetry={reset}
    />
  );
}
