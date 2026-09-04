"use client";

import { usePathname } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { Maximize2, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";

import { AssistantContext, type AssistantContextValue } from "@/components/ai/assistant-context";
import { AssistantChat } from "@/components/ai/chat";
import { Button } from "@/components/ui/button";
import { askAssistant } from "@/lib/ai/client";
import type { ChatTurn, PageContext } from "@/lib/ai/types";
import { indexStore } from "@/lib/data/store";
import { useStoreContext } from "@/lib/data/store-context";
import { cn } from "@/lib/utils";

let seq = 0;
const nextId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * The assistant lives above every page: one conversation, aware of the
 * building / tenant / unit on screen, reachable from the floating button or
 * the full /ai page.
 */
export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const { store, status: loadStatus } = useStoreContext();
  const pathname = usePathname();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const storeRef = useRef(store);
  storeRef.current = store;

  const context = useMemo<PageContext>(() => {
    const idx = indexStore(store);
    const ctx: PageContext = { pathname };
    const prop = /^\/properties\/([^/?#]+)/.exec(pathname);
    if (prop) {
      const p = idx.propertyById.get(decodeURIComponent(prop[1]));
      if (p) {
        ctx.propertyId = p.id;
        ctx.propertyName = p.name;
      }
    }
    const tenant = /^\/tenants\/([^/?#]+)/.exec(pathname);
    if (tenant) ctx.tenantId = decodeURIComponent(tenant[1]);
    if (typeof window !== "undefined") {
      const unit = new URLSearchParams(window.location.search).get("unit");
      if (unit && idx.unitById.has(unit)) ctx.unitId = unit;
    }
    return ctx;
  }, [pathname, store]);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || loadStatus.state !== "ready") return;
      const userTurn: ChatTurn = { id: nextId(), role: "user", text: q };
      const pendingId = nextId();
      setTurns((t) => [...t, userTurn, { id: pendingId, role: "assistant", pending: true }]);
      setBusy(true);
      setStatus(null);
      try {
        const answer = await askAssistant({
          question: q,
          history: turns,
          store: storeRef.current,
          context,
          onStatus: setStatus,
        });
        setTurns((t) => t.map((x) => (x.id === pendingId ? { id: pendingId, role: "assistant", answer } : x)));
      } catch (err) {
        setTurns((t) => t.map((x) => (x.id === pendingId ? { id: pendingId, role: "assistant", error: err instanceof Error ? err.message : String(err) } : x)));
      } finally {
        setBusy(false);
        setStatus(null);
      }
    },
    [context, loadStatus.state, turns],
  );

  const clear = useCallback(() => setTurns([]), []);

  const value = useMemo<AssistantContextValue>(
    () => ({ turns, busy, status, contextLabel: context.propertyName ?? null, ask, clear, open, setOpen }),
    [turns, busy, status, context.propertyName, ask, clear, open],
  );

  const onAiPage = pathname === "/ai";

  return (
    <AssistantContext.Provider value={value}>
      {children}
      {!onAiPage && loadStatus.state === "ready" && (
        <>
          {open && (
            <div
              role="dialog"
              aria-label="AI assistant"
              className="fixed bottom-20 right-4 z-40 flex h-[min(640px,calc(100vh-7rem))] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
            >
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <span className="flex size-6 items-center justify-center rounded-md bg-brand text-brand-foreground">
                  <Sparkles className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-tight">Assistant</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{context.propertyName ? `Scoped to ${context.propertyName}` : "Whole portfolio"}</span>
                </span>
                {turns.length > 0 && (
                  <Button size="icon" variant="ghost" className="size-7" aria-label="Clear conversation" onClick={clear}>
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="size-7" aria-label="Open full page" asChild>
                  <Link href="/ai" onClick={() => setOpen(false)}>
                    <Maximize2 className="size-3.5" />
                  </Link>
                </Button>
                <Button size="icon" variant="ghost" className="size-7" aria-label="Close" onClick={() => setOpen(false)}>
                  <X className="size-4" />
                </Button>
              </div>
              <AssistantChat compact />
            </div>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Close assistant" : "Open assistant"}
            aria-expanded={open}
            className={cn(
              "fixed bottom-4 right-4 z-40 flex h-12 items-center gap-2 rounded-full pl-4 pr-5 text-sm font-medium shadow-lg transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              open ? "bg-foreground text-background" : "bg-brand text-brand-foreground",
            )}
          >
            <Sparkles className="size-4" />
            {open ? "Close" : "Ask"}
          </button>
        </>
      )}
    </AssistantContext.Provider>
  );
}
