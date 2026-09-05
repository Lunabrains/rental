import {
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  Car,
  ClipboardCheck,
  ClipboardList,
  Hammer,
  KeyRound,
  Truck,
  CreditCard,
  Receipt,
  FileText,
  FolderOpen,
  Gauge,
  Layers,
  LayoutDashboard,
  PiggyBank,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Matches nested routes too (e.g. /properties/xyz). */
  match?: (pathname: string) => boolean;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

const startsWith = (prefix: string) => (pathname: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, match: startsWith("/dashboard") },
      { href: "/properties", label: "Properties", icon: Building2, match: startsWith("/properties") },
      { href: "/assets", label: "Assets", icon: ClipboardList, match: startsWith("/assets") },
      { href: "/tenants", label: "Tenants", icon: Users, match: startsWith("/tenants") },
      { href: "/contracts", label: "Contracts", icon: FileText, match: startsWith("/contracts") },
      { href: "/alerts", label: "Alerts", icon: Bell, match: startsWith("/alerts") },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/finance/rent-roll", label: "Rent roll", icon: Receipt, match: startsWith("/finance/rent-roll") },
      { href: "/payments", label: "Payments", icon: CreditCard, match: startsWith("/payments") },
      { href: "/finance/expenses", label: "Expenses", icon: Wallet, match: startsWith("/finance/expenses") },
      { href: "/finance/budgets", label: "Budgets", icon: Target, match: startsWith("/finance/budgets") },
      { href: "/finance/deposits", label: "Deposits", icon: PiggyBank, match: startsWith("/finance/deposits") },
      { href: "/finance/utilities", label: "Utilities", icon: Gauge, match: startsWith("/finance/utilities") },
      { href: "/finance/charges", label: "Common charges", icon: Layers, match: startsWith("/finance/charges") },
    ],
  },
  {
    label: "Maintenance",
    items: [
      { href: "/maintenance", label: "Work orders", icon: Wrench, match: (p) => p === "/maintenance" || (p.startsWith("/maintenance/") && !p.startsWith("/maintenance/preventive")) },
      { href: "/maintenance/preventive", label: "Preventive", icon: CalendarClock, match: startsWith("/maintenance/preventive") },
      { href: "/suppliers", label: "Suppliers", icon: Truck, match: startsWith("/suppliers") },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/inspections", label: "Inspections", icon: ClipboardCheck, match: startsWith("/inspections") },
      { href: "/keys", label: "Keys", icon: KeyRound, match: startsWith("/keys") },
      { href: "/parking", label: "Parking", icon: Car, match: startsWith("/parking") },
      { href: "/renovations", label: "Renovations", icon: Hammer, match: startsWith("/renovations") },
    ],
  },
  {
    label: "Analytics",
    items: [{ href: "/analytics/performance", label: "Performance", icon: TrendingUp, match: startsWith("/analytics/performance") }],
  },
  {
    label: "Library",
    items: [
      { href: "/documents", label: "Documents", icon: FolderOpen, match: startsWith("/documents") },
      { href: "/reports", label: "Reports", icon: BarChart3, match: startsWith("/reports") },
    ],
  },
  {
    label: "Tools",
    items: [
      { href: "/ai", label: "AI Assistant", icon: Sparkles, match: startsWith("/ai") },
      { href: "/settings", label: "Settings", icon: Settings, match: startsWith("/settings") },
    ],
  },
];

export function findNavItem(pathname: string): NavItem | undefined {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if ((item.match ?? startsWith(item.href))(pathname)) return item;
    }
  }
  return undefined;
}
