"use client";

import Link from "next/link";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ImportEntity } from "@/lib/import/template";

/** What each section expects in a spreadsheet, and where to send the owner back afterwards. */
export const IMPORT_SECTIONS: Record<string, { label: string; entities: ImportEntity[]; back: string; hint: string }> = {
  properties: { label: "Properties", entities: ["properties", "units"], back: "/properties", hint: "One tab of buildings and one of units — or a single tab of units with a building column; buildings are created from it." },
  tenants: { label: "Tenants", entities: ["tenants", "contracts"], back: "/tenants", hint: "A tab of tenants (name and phone) and, if you have them, their contracts with building, unit, rent and start date." },
  contracts: { label: "Contracts", entities: ["contracts"], back: "/contracts", hint: "Building, unit, tenant, rent, start and either an end date or a duration in months." },
  assets: { label: "Assets", entities: ["assets", "plans"], back: "/assets", hint: "Equipment per building: type, name, brand, model, serial, installation date, warranty." },
  suppliers: { label: "Suppliers", entities: ["suppliers"], back: "/suppliers", hint: "Company or name, trade, phone, email." },
  expenses: { label: "Expenses", entities: ["expenses"], back: "/finance/expenses", hint: "Building, date, amount, category, description, paid or not, invoice number." },
};

export type ImportSection = keyof typeof IMPORT_SECTIONS;

/** "Import" entry point shown in a section header; opens the importer pointed at that kind of record. */
export function ImportButton({ section, label = "Import", variant = "outline" }: { section: ImportSection; label?: string; variant?: "outline" | "ghost" }) {
  return (
    <Button variant={variant} asChild>
      <Link href={`/settings/import?for=${section}`}>
        <Upload className="size-4" /> {label}
      </Link>
    </Button>
  );
}
