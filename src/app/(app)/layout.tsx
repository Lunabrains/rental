import { ActionsProvider } from "@/components/actions/action-provider";
import { AppShell } from "@/components/shell/app-shell";
import { StoreProvider } from "@/lib/data/store-context";

/**
 * App shell. The in-memory store loads the seed workbook once per session and
 * every screen underneath reads from it through the query layer. Actions
 * (alert buttons, write flows) dispatch through one provider.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <StoreProvider>
      <ActionsProvider>
        <AppShell>{children}</AppShell>
      </ActionsProvider>
    </StoreProvider>
  );
}
