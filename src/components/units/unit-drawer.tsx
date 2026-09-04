"use client";

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";

import { useActions, type DrawerTab } from "@/components/actions/action-provider";
import { SeverityDot, UnitStatusBadge } from "@/components/common/badges";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityTab } from "@/components/units/activity-tab";
import { AvailablePanel } from "@/components/units/available-panel";
import { ContractTab } from "@/components/units/contract-tab";
import { DocumentsTab } from "@/components/units/documents-tab";
import { DocumentPreview } from "@/components/documents/document-preview";
import { PaymentsTab } from "@/components/units/payments-tab";
import { TenantTab } from "@/components/units/tenant-tab";
import { useStore } from "@/lib/data/store-context";
import { getUnitDetails, getUnitTimeline } from "@/lib/queries";
import type { StoredDocument } from "@/types";

interface UnitDrawerProps {
  unitId: string | null;
  tab: DrawerTab;
  onTabChange: (tab: DrawerTab) => void;
  onClose: () => void;
}

const TABS: { key: DrawerTab; label: string }[] = [
  { key: "tenant", label: "Tenant" },
  { key: "contract", label: "Contract" },
  { key: "payments", label: "Payments" },
  { key: "documents", label: "Documents" },
  { key: "activity", label: "Activity" },
];

/**
 * Right-side drawer for one unit. Non-modal so the building stays visible
 * and clicking another square switches units without closing.
 */
export function UnitDrawer({ unitId, tab, onTabChange, onClose }: UnitDrawerProps) {
  const store = useStore();
  const { openTenant } = useActions();
  const [preview, setPreview] = useState<StoredDocument | null>(null);

  const details = useMemo(() => (unitId ? getUnitDetails(store, unitId) : null), [store, unitId]);
  const timeline = useMemo(() => (unitId ? getUnitTimeline(store, unitId) : []), [store, unitId]);

  const open = unitId !== null && details !== null;
  const rented = details?.unit.status === "rented" && details.tenant !== null;

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && onClose()} modal={false}>
        <SheetContent
          side="right"
          className="w-full gap-0 overflow-hidden p-0 shadow-2xl data-[side=right]:sm:max-w-[34rem]"
          onInteractOutside={(e) => e.preventDefault()}
        >
          {details && (
            <div className="flex h-full flex-col">
              <SheetHeader className="border-b px-5 pb-4 pt-5">
                <div className="flex items-start justify-between gap-3 pr-8">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <SheetTitle className="tabular text-xl font-semibold">{details.unit.unitNumber}</SheetTitle>
                      <UnitStatusBadge status={details.unit.status} />
                    </div>
                    <SheetDescription className="mt-0.5 truncate">
                      {details.property.name} · {details.unit.bedrooms} BR · {details.unit.sizeSqm} m²
                      {rented && details.tenant ? ` · ${details.tenant.fullName}` : ""}
                    </SheetDescription>
                  </div>
                </div>
                {details.alerts.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {details.alerts.slice(0, 4).map((a) => (
                      <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full border bg-muted/60 px-2 py-0.5 text-[11px] font-medium">
                        <SeverityDot severity={a.severity} />
                        {a.title.split(" — ")[0]}
                      </span>
                    ))}
                  </div>
                )}
              </SheetHeader>

              {rented ? (
                <Tabs value={tab} onValueChange={(v) => onTabChange(v as DrawerTab)} className="flex min-h-0 flex-1 flex-col gap-0">
                  <div className="border-b px-3">
                    <TabsList variant="line" className="h-10 w-full justify-start gap-1 bg-transparent p-0">
                      {TABS.map((t) => (
                        <TabsTrigger key={t.key} value={t.key} className="px-2.5 text-xs sm:text-sm">
                          {t.label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <TabsContent value="tenant" className="m-0 p-5">
                      <TenantTab details={details} />
                    </TabsContent>
                    <TabsContent value="contract" className="m-0 p-5">
                      <ContractTab details={details} onPreview={setPreview} />
                    </TabsContent>
                    <TabsContent value="payments" className="m-0 p-5">
                      <PaymentsTab details={details} />
                    </TabsContent>
                    <TabsContent value="documents" className="m-0 p-5">
                      <DocumentsTab details={details} onPreview={setPreview} />
                    </TabsContent>
                    <TabsContent value="activity" className="m-0 p-5">
                      <ActivityTab events={timeline} />
                    </TabsContent>
                  </div>
                  {details.tenant && (
                    <div className="border-t bg-card px-5 py-3">
                      <Button variant="outline" className="w-full" onClick={() => openTenant(details.tenant!.id)}>
                        Open full profile
                        <ExternalLink className="size-4" />
                      </Button>
                    </div>
                  )}
                </Tabs>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                  <AvailablePanel details={details} />
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
      <DocumentPreview doc={preview} onClose={() => setPreview(null)} />
    </>
  );
}
