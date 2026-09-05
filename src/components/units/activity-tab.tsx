import { Timeline } from "@/components/common/timeline";
import type { TimelineEvent } from "@/lib/queries";

export function ActivityTab({ events }: { events: TimelineEvent[] }) {
  return <Timeline events={events} />;
}
