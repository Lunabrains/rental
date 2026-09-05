"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Building2, ClipboardCheck, ClipboardList, FileText, FolderOpen, Gauge, Plus, Receipt, Search, Truck, Users, Wallet, Wrench } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useStore } from "@/lib/data/store-context";
import { formatMoney, labelize } from "@/lib/format";
import { searchAll } from "@/lib/queries";
import { NAV_GROUPS } from "@/components/shell/nav";

/**
 * Global search and command palette (plan §11): ⌘K / Ctrl+K anywhere. Typing
 * finds tenants, units, buildings, contracts, suppliers, work orders, assets
 * and documents and opens them directly; the action list starts the common
 * flows without leaving the page.
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const store = useStore();
  const router = useRouter();
  const { openTenant, openUnit, openProperty, openWorkOrder, openSupplier, openAsset, reviewDocument, addExpense, createWorkOrder, scheduleInspection, addAsset } = useActions();
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const results = useMemo(() => (query.trim().length > 0 ? searchAll(store, query, 5) : null), [store, query]);

  function setOpen(next: boolean) {
    if (!next) setQuery("");
    onOpenChange(next);
  }

  function go(fn: () => void) {
    setOpen(false);
    fn();
  }

  const actions: { label: string; hint: string; icon: typeof Plus; run: () => void }[] = [
    { label: "Record a payment", hint: "Pick the tenant on the payments board", icon: Receipt, run: () => router.push("/payments?status=overdue") },
    { label: "Add an expense", hint: "Invoice, bill or receipt", icon: Wallet, run: () => addExpense({}) },
    { label: "Create a work order", hint: "Repair, complaint or inspection follow-up", icon: Wrench, run: () => createWorkOrder({}) },
    { label: "Add a document", hint: "Upload and file it against the right record", icon: FolderOpen, run: () => router.push("/documents") },
    { label: "Record a utility reading", hint: "Meters and consumption", icon: Gauge, run: () => router.push("/finance/utilities") },
    { label: "Schedule an inspection", hint: "Move-in, move-out, annual or safety", icon: ClipboardCheck, run: () => scheduleInspection({}) },
    { label: "Register an asset", hint: "Elevator, generator, pump…", icon: ClipboardList, run: () => addAsset(null) },
    { label: "Run a report", hint: "Rent roll, balances, P&L, exports", icon: FileText, run: () => router.push("/reports") },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Search and commands</DialogTitle>
        <DialogDescription className="sr-only">Find anything in the portfolio or start an action.</DialogDescription>
        <Command shouldFilter={!results} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground">
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search tenants, units, buildings, suppliers, work orders, assets, documents… or type an action" />
          <CommandList className="max-h-[60vh]">
            <CommandEmpty>Nothing found. Press Enter to search the whole portfolio.</CommandEmpty>
            {results && results.total > 0 && (
              <>
                {results.tenants.length > 0 && (
                  <CommandGroup heading="Tenants">
                    {results.tenants.map(({ tenant, unit, property }) => (
                      <CommandItem key={tenant.id} value={`tenant-${tenant.id}`} onSelect={() => go(() => openTenant(tenant.id))}>
                        <Users className="size-4 text-muted-foreground" />
                        <span className="flex-1 truncate">{tenant.fullName}</span>
                        <span className="text-xs text-muted-foreground">{unit && property ? `${property.name} ${unit.unitNumber}` : "former tenant"}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {results.units.length > 0 && (
                  <CommandGroup heading="Units">
                    {results.units.map(({ unit, property, tenant }) => (
                      <CommandItem key={unit.id} value={`unit-${unit.id}`} onSelect={() => go(() => openUnit(unit.id))}>
                        <Building2 className="size-4 text-muted-foreground" />
                        <span className="flex-1 truncate">{property.name} · {unit.unitNumber}</span>
                        <span className="text-xs text-muted-foreground">{tenant?.fullName ?? labelize(unit.status)}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {results.properties.length > 0 && (
                  <CommandGroup heading="Buildings">
                    {results.properties.map((p) => (
                      <CommandItem key={p.id} value={`property-${p.id}`} onSelect={() => go(() => openProperty(p.id))}>
                        <Building2 className="size-4 text-muted-foreground" />
                        <span className="flex-1 truncate">{p.name}</span>
                        <span className="text-xs text-muted-foreground">{p.district}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {results.contracts.length > 0 && (
                  <CommandGroup heading="Contracts">
                    {results.contracts.map(({ contract, tenant, unit }) => (
                      <CommandItem key={contract.id} value={`contract-${contract.id}`} onSelect={() => go(() => (unit ? openUnit(unit.id, "contract") : router.push("/contracts")))}>
                        <FileText className="size-4 text-muted-foreground" />
                        <span className="flex-1 truncate font-mono text-xs">{contract.contractNumber}</span>
                        <span className="text-xs text-muted-foreground">{tenant?.fullName ?? ""}{unit ? ` · ${unit.unitNumber}` : ""}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {results.suppliers.length > 0 && (
                  <CommandGroup heading="Suppliers">
                    {results.suppliers.map((s) => (
                      <CommandItem key={s.id} value={`supplier-${s.id}`} onSelect={() => go(() => openSupplier(s.id))}>
                        <Truck className="size-4 text-muted-foreground" />
                        <span className="flex-1 truncate">{s.name}</span>
                        <span className="text-xs text-muted-foreground">{labelize(s.category)}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {results.workOrders.length > 0 && (
                  <CommandGroup heading="Work orders">
                    {results.workOrders.map(({ workOrder, property, unit }) => (
                      <CommandItem key={workOrder.id} value={`wo-${workOrder.id}`} onSelect={() => go(() => openWorkOrder(workOrder.id))}>
                        <Wrench className="size-4 text-muted-foreground" />
                        <span className="flex-1 truncate">{workOrder.number} · {workOrder.title}</span>
                        <span className="text-xs text-muted-foreground">{property?.name ?? ""}{unit ? ` ${unit.unitNumber}` : ""} · {labelize(workOrder.status)}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {results.assets.length > 0 && (
                  <CommandGroup heading="Assets">
                    {results.assets.map(({ asset, property }) => (
                      <CommandItem key={asset.id} value={`asset-${asset.id}`} onSelect={() => go(() => openAsset(asset.id))}>
                        <ClipboardList className="size-4 text-muted-foreground" />
                        <span className="flex-1 truncate">{asset.name}</span>
                        <span className="text-xs text-muted-foreground">{property?.name ?? ""} · {labelize(asset.status)}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {results.documents.length > 0 && (
                  <CommandGroup heading="Documents">
                    {results.documents.map(({ document, owner }) => (
                      <CommandItem key={document.id} value={`doc-${document.id}`} onSelect={() => go(() => reviewDocument(document.id))}>
                        <FolderOpen className="size-4 text-muted-foreground" />
                        <span className="flex-1 truncate">{document.title}</span>
                        <span className="text-xs text-muted-foreground">{labelize(document.category)}{owner ? ` · ${owner}` : ""}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem value="search-all" onSelect={() => go(() => router.push(`/search?q=${encodeURIComponent(query.trim())}`))}>
                    <Search className="size-4 text-muted-foreground" />
                    <span className="flex-1">See all results for “{query.trim()}”</span>
                    <CommandShortcut>↵</CommandShortcut>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
            {results && results.total === 0 && (
              <CommandGroup>
                <CommandItem value="search-all" onSelect={() => go(() => router.push(`/search?q=${encodeURIComponent(query.trim())}`))}>
                  <Search className="size-4 text-muted-foreground" />
                  <span className="flex-1">Search the whole portfolio for “{query.trim()}”</span>
                </CommandItem>
              </CommandGroup>
            )}
            {!results && (
              <>
                <CommandGroup heading="Actions">
                  {actions.map((a) => {
                    const Icon = a.icon;
                    return (
                      <CommandItem key={a.label} value={a.label} onSelect={() => go(a.run)}>
                        <Icon className="size-4 text-muted-foreground" />
                        <span className="flex-1">{a.label}</span>
                        <span className="text-xs text-muted-foreground">{a.hint}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="Go to">
                  {NAV_GROUPS.flatMap((g) => g.items).map((item) => {
                    const Icon = item.icon;
                    return (
                      <CommandItem key={item.href} value={`go ${item.label}`} onSelect={() => go(() => router.push(item.href))}>
                        <Icon className="size-4 text-muted-foreground" />
                        <span className="flex-1">{item.label}</span>
                        <span className="text-xs text-muted-foreground">{item.href}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
        <div className="flex items-center justify-between border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          <span>{store.tenants.length} tenants · {store.units.length} units · {store.suppliers.length} suppliers · {store.documents.filter((d) => !d.deleted).length} documents</span>
          <span>{formatMoney(store.payments.filter((p) => p.status === "overdue" || p.status === "partial").reduce((n, p) => n + p.amountDue - p.amountPaid, 0))} outstanding</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
