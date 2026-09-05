import { WorkOrderPage } from "@/components/maintenance/work-order-page";

export const metadata = { title: "Work order" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkOrderPage workOrderId={decodeURIComponent(id)} />;
}
