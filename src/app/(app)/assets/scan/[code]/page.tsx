import { AssetScanPage } from "@/components/maintenance/asset-scan";

export const metadata = { title: "Scanned asset" };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <AssetScanPage code={decodeURIComponent(code)} />;
}
