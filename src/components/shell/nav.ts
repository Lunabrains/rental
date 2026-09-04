import {
  BarChart3,
  Bell,
  Building2,
  CreditCard,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Settings,
  Sparkles,
  Users,
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
      { href: "/tenants", label: "Tenants", icon: Users, match: startsWith("/tenants") },
      { href: "/contracts", label: "Contracts", icon: FileText, match: startsWith("/contracts") },
      { href: "/payments", label: "Payments", icon: CreditCard, match: startsWith("/payments") },
      { href: "/alerts", label: "Alerts", icon: Bell, match: startsWith("/alerts") },
    ],
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
