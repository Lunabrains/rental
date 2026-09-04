import { TenantPage } from "@/components/tenants/tenant-page";

export const metadata = { title: "Tenant" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TenantPage tenantId={decodeURIComponent(id)} />;
}
