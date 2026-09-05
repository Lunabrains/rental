import { RenovationPage } from "@/components/operations/renovation-page";

export const metadata = { title: "Renovation project" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RenovationPage renovationId={decodeURIComponent(id)} />;
}
