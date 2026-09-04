"use client";

import { Search, X } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type StatusFilter = "all" | "available" | "rented";

interface GridToolbarProps {
  query: string;
  onQuery: (q: string) => void;
  matchCount: number | null;
  floors: number[];
  floor: number | null;
  onFloor: (f: number | null) => void;
  status: StatusFilter;
  onStatus: (s: StatusFilter) => void;
}

export function GridToolbar({ query, onQuery, matchCount, floors, floor, onFloor, status, onStatus }: GridToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Find a tenant or unit…"
          aria-label="Find a tenant or unit"
          className="h-9 w-full rounded-md border border-input bg-card pl-8 pr-16 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
        />
        {query && (
          <span className="tabular absolute right-8 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {matchCount === null ? "" : `${matchCount} match${matchCount === 1 ? "" : "es"}`}
          </span>
        )}
        {query && (
          <button type="button" onClick={() => onQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <Select value={floor === null ? "all" : String(floor)} onValueChange={(v) => onFloor(v === "all" ? null : Number(v))}>
        <SelectTrigger className="w-32">
          <SelectValue placeholder="Floor" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All floors</SelectItem>
          {floors.map((f) => (
            <SelectItem key={f} value={String(f)}>
              {f === 0 ? "Ground floor" : `Floor ${f}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex rounded-md border bg-card p-0.5 text-xs">
        {(["all", "rented", "available"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onStatus(s)}
            className={cn(
              "rounded px-2.5 py-1 capitalize transition-colors",
              status === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {s === "all" ? "All" : s === "available" ? "Available only" : "Rented only"}
          </button>
        ))}
      </div>
    </div>
  );
}
