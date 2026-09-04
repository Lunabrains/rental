import { PlaceholderPage } from "@/components/common/placeholder";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlaceholderPage title={`Building ${id}`} description="Floor grid and unit drawer." phase={5} />;
}
