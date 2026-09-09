"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { EmptyState } from "@/components/common/states";
import { FEATURE_LABELS, routeFeature, featureOn } from "@/lib/features";

/**
 * Sections switched off in this edition are not reachable: a direct link or an
 * old bookmark lands on the dashboard instead of a half-connected screen.
 */
export function FeatureGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const feature = routeFeature(pathname);
  const blocked = feature !== null && !featureOn(feature);

  useEffect(() => {
    if (blocked) router.replace("/dashboard");
  }, [blocked, router]);

  if (blocked) return <EmptyState title={`${FEATURE_LABELS[feature]} is not part of this edition`} description="Taking you back to the dashboard…" />;
  return <>{children}</>;
}
