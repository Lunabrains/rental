"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { importData, stampReset, type Command } from "@/lib/commands";
import { parseWorkbook } from "@/lib/import/parse";
import { planImport } from "@/lib/import/validate";
import type { ImportSummary } from "@/lib/import/types";
import type { Store } from "@/types";

import { createEmptyStore } from "./store";

export const SEED_URL = "/seed/portfolio.xlsx";
export const CEDAR_SEED_URL = "/seed/cedar-residence.xlsx";

export type LoadStatus = { state: "loading" } | { state: "ready" } | { state: "error"; message: string };

export interface RunOutcome<T> {
  result: T;
  /** Present when the command can be reversed. */
  undo: (() => void) | null;
}

export interface StoreContextValue {
  store: Store;
  status: LoadStatus;
  seed: { summary: ImportSummary; loadedAt: string } | null;
  /** Apply a command to the current store and re-render. */
  run: <T>(command: Command<T>) => RunOutcome<T>;
  /** Reload the seed workbook from scratch — the "Reset demo data" action. */
  reset: () => Promise<void>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

async function loadSeed(): Promise<{ store: Store; summary: ImportSummary }> {
  const res = await fetch(SEED_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load seed workbook (${res.status})`);
  const buffer = await res.arrayBuffer();
  const parsed = parseWorkbook(buffer, "portfolio.xlsx");
  const plan = planImport(parsed, createEmptyStore());
  if (plan.errorCount > 0) {
    const first = Object.values(plan.rows)
      .flat()
      .flatMap((r) => r.issues.filter((i) => i.level === "error").map((i) => `${r.entity} row ${r.rowNumber}: ${i.message}`))[0];
    console.warn(`Seed workbook has ${plan.errorCount} row errors — first: ${first}`);
  }
  const { store, result } = importData(plan)(createEmptyStore());
  return { store, summary: result };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<Store>(() => createEmptyStore());
  const [status, setStatus] = useState<LoadStatus>({ state: "loading" });
  const [seed, setSeed] = useState<StoreContextValue["seed"]>(null);
  // Commands read the latest snapshot even when several fire in one tick.
  // Every write path below updates the ref alongside state.
  const storeRef = useRef(store);

  const applyLoaded = useCallback((loaded: Store, summary: ImportSummary, isReset: boolean) => {
    const next = isReset ? stampReset()(loaded).store : loaded;
    storeRef.current = next;
    setStore(next);
    setSeed({ summary, loadedAt: next.loadedAt });
    setStatus({ state: "ready" });
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadSeed()
      .then(({ store: loaded, summary }) => {
        if (!cancelled) applyLoaded(loaded, summary, false);
      })
      .catch((err: unknown) => {
        if (!cancelled) setStatus({ state: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [applyLoaded]);

  const run = useCallback(<T,>(command: Command<T>): RunOutcome<T> => {
    const outcome = command(storeRef.current);
    storeRef.current = outcome.store;
    setStore(outcome.store);
    const undo = outcome.undo
      ? () => {
          const reverted = outcome.undo!(storeRef.current);
          storeRef.current = reverted;
          setStore(reverted);
        }
      : null;
    return { result: outcome.result, undo };
  }, []);

  const reset = useCallback(async () => {
    setStatus({ state: "loading" });
    try {
      const { store: loaded, summary } = await loadSeed();
      applyLoaded(loaded, summary, true);
    } catch (err) {
      setStatus({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [applyLoaded]);

  const value = useMemo<StoreContextValue>(() => ({ store, status, seed, run, reset }), [store, status, seed, run, reset]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStoreContext(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStoreContext must be used inside <StoreProvider>");
  return ctx;
}

/** The current store snapshot. Re-renders after every command. */
export function useStore(): Store {
  return useStoreContext().store;
}
