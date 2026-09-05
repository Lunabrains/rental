import { InspectionPage } from "@/components/operations/inspection-page";

export const metadata = { title: "Inspection" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InspectionPage inspectionId={decodeURIComponent(id)} />;
}
