import { PlaceholderPage } from "@/components/common/placeholder";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlaceholderPage title={`Tenant ${id}`} description="Full tenant profile." phase={9} />;
}
