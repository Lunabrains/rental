"use client";

import { Trash2 } from "lucide-react";

import { useAssistant } from "@/components/ai/assistant-context";
import { AssistantChat } from "@/components/ai/chat";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";

export function AiPage() {
  const { turns, clear, busy } = useAssistant();
  return (
    <div className="flex h-[calc(100vh-8.5rem)] min-h-[480px] flex-col space-y-4">
      <PageHeader
        title="AI Assistant"
        description="Ask about payments, contracts, buildings, tenants or what changed — answers come straight from the same data as the screens."
        actions={
          turns.length > 0 ? (
            <Button variant="outline" size="sm" onClick={clear} disabled={busy}>
              <Trash2 className="size-4" /> Clear
            </Button>
          ) : undefined
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-background shadow-xs">
        <AssistantChat />
      </div>
    </div>
  );
}
