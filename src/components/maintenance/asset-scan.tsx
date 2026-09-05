"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { QrCode } from "lucide-react";

import { EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/data/store-context";
import { findAssetByQr } from "@/lib/queries";

/** QR landing: resolves the stable code to the asset and opens its page inside the app. */
export function AssetScanPage({ code }: { code: string }) {
  const store = useStore();
  const router = useRouter();
  const asset = useMemo(() => findAssetByQr(store, code), [store, code]);

  useEffect(() => {
    if (asset) router.replace(`/assets/${asset.id}`);
  }, [asset, router]);

  if (asset) return null;
  return (
    <EmptyState
      icon={QrCode}
      title="Unknown asset code"
      description={`No asset is registered under ${code}. The label may belong to another portfolio or the asset was removed.`}
      action={
        <Button asChild variant="outline">
          <Link href="/assets">Asset registry</Link>
        </Button>
      }
    />
  );
}
