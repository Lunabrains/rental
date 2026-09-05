"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Field, FlowDialog } from "@/components/flows/flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createReminder } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { addDaysISO, today } from "@/lib/date";
import { formatDate } from "@/lib/format";
import type { AlertEntityType } from "@/types";

export interface ReminderTarget {
  entityType: AlertEntityType | null;
  entityId: string | null;
  /** Shown in the dialog, e.g. "Karim Daher · BH-403-01". */
  label: string;
  /** Suggested title. */
  title?: string;
  dueDate?: string;
}

const QUICK = [
  { label: "Tomorrow", days: 1 },
  { label: "In 3 days", days: 3 },
  { label: "Next week", days: 7 },
  { label: "In 2 weeks", days: 14 },
];

/** Creates a dated reminder that surfaces as a manual alert when it falls due. */
export function ReminderDialog({ target, onClose }: { target: ReminderTarget; onClose: () => void }) {
  const { run } = useStoreContext();
  const [title, setTitle] = useState(target.title ?? "");
  const [dueDate, setDueDate] = useState(target.dueDate ?? addDaysISO(today(), 3));
  const [note, setNote] = useState("");
  const valid = title.trim().length > 0 && dueDate >= today();

  function submit() {
    if (!valid) return;
    const { result, undo } = run(createReminder({ title, note, dueDate, entityType: target.entityType, entityId: target.entityId }));
    toast.success(`Reminder set for ${formatDate(result.dueDate)}`, { description: result.title, action: undo ? { label: "Undo", onClick: undo } : undefined });
    onClose();
  }

  return (
    <FlowDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Create reminder"
      description={target.label}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid}>
            Set reminder
          </Button>
        </>
      }
    >
      <Field label="What to do" htmlFor="rm-title">
        <Input id="rm-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call the tenant about the renewal" autoFocus />
      </Field>
      <Field label="When" htmlFor="rm-date">
        <div className="flex flex-wrap items-center gap-2">
          <Input id="rm-date" type="date" value={dueDate} min={today()} onChange={(e) => setDueDate(e.target.value)} className="w-44" />
          {QUICK.map((q) => (
            <Button key={q.days} type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setDueDate(addDaysISO(today(), q.days))}>
              {q.label}
            </Button>
          ))}
        </div>
      </Field>
      <Field label="Note" htmlFor="rm-note">
        <Textarea id="rm-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
      </Field>
    </FlowDialog>
  );
}
