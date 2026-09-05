import { SupplierPage } from "@/components/maintenance/supplier-page";

export const metadata = { title: "Supplier" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SupplierPage supplierId={decodeURIComponent(id)} />;
}
