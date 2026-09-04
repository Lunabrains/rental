"use client";

import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";

/**
 * App shell. Data-backed props (alert counts, bell items) are wired to the
 * in-memory store in Phase 2/3; until then the shell renders with zeros.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const companyName = "Cedar Holdings";
  const ownerName = "George";

  return (
    <div className="min-h-screen bg-background">
      <Sidebar companyName={companyName} ownerName={ownerName} alertCount={0} />
      <div className="lg:pl-60">
        <Topbar ownerName={ownerName} criticalUnread={0} bellAlerts={[]} />
        <main className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
