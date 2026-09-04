import { AppShell } from "@/components/shell/app-shell";
import { StoreProvider } from "@/lib/data/store-context";

/**
 * App shell. The in-memory store loads the seed workbook once per session and
 * every screen underneath reads from it through the query layer.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <StoreProvider>
      <AppShell>{children}</AppShell>
    </StoreProvider>
  );
}
