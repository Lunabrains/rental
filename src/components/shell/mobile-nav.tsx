"use client";

import { useState } from "react";
import { Menu } from "lucide-react";

import { Brand, OwnerCard } from "@/components/shell/sidebar";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

interface MobileNavProps {
  companyName: string;
  ownerName: string;
  alertCount: number;
}

/** Hamburger + left sheet for screens narrower than the fixed sidebar. */
export function MobileNav({ companyName, ownerName, alertCount }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setOpen(true)}>
        <Menu className="size-5" />
      </Button>
      <SheetContent side="left" className="flex w-72 flex-col gap-0 p-0" showCloseButton={false}>
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <Brand companyName={companyName} />
        <SidebarNav alertCount={alertCount} onNavigate={() => setOpen(false)} />
        <OwnerCard ownerName={ownerName} />
      </SheetContent>
    </Sheet>
  );
}
