import { cn } from "@/lib/utils";
import { labelize } from "@/lib/format";
import type { AlertSeverity, ContractStatus, PaymentStatus, UnitStatus } from "@/types";

const SEVERITY_DOT: Record<AlertSeverity, string> = {
  critical: "bg-critical",
  warning: "bg-warning",
  attention: "bg-warning/60",
  info: "bg-info",
};

const SEVERITY_BADGE: Record<AlertSeverity, string> = {
  critical: "bg-critical-muted text-critical border-critical/20",
  warning: "bg-warning-muted text-warning-foreground border-warning/30",
  attention: "bg-warning-muted/60 text-warning-foreground border-warning/20",
  info: "bg-info-muted text-info border-info/20",
};

export function SeverityDot({ severity, className }: { severity: AlertSeverity; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", SEVERITY_DOT[severity], className)}
    />
  );
}

function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[11px] font-medium leading-none",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function SeverityBadge({ severity, className }: { severity: AlertSeverity; className?: string }) {
  return <Pill className={cn(SEVERITY_BADGE[severity], className)}>{labelize(severity)}</Pill>;
}

const UNIT_STATUS: Record<UnitStatus, string> = {
  available: "bg-unit-available text-unit-available-foreground border-unit-available-border",
  rented: "bg-unit-rented text-unit-rented-foreground border-unit-rented-border",
  reserved: "bg-info-muted text-info border-info/20",
  maintenance: "bg-warning-muted text-warning-foreground border-warning/30",
  renovation: "bg-warning-muted text-warning-foreground border-warning/30",
  unavailable: "bg-muted text-muted-foreground border-border",
};

export function UnitStatusBadge({ status, className }: { status: UnitStatus; className?: string }) {
  return <Pill className={cn(UNIT_STATUS[status], className)}>{labelize(status)}</Pill>;
}

const CONTRACT_STATUS: Record<ContractStatus, string> = {
  active: "bg-success-muted text-success border-success/20",
  notice_given: "bg-warning-muted text-warning-foreground border-warning/30",
  expired: "bg-critical-muted text-critical border-critical/20",
  renewed: "bg-muted text-muted-foreground border-border",
  terminated: "bg-muted text-muted-foreground border-border",
};

export function ContractStatusBadge({ status, className }: { status: ContractStatus; className?: string }) {
  return <Pill className={cn(CONTRACT_STATUS[status], className)}>{labelize(status)}</Pill>;
}

const PAYMENT_STATUS: Record<PaymentStatus, string> = {
  paid: "bg-success-muted text-success border-success/20",
  partial: "bg-warning-muted text-warning-foreground border-warning/30",
  overdue: "bg-critical-muted text-critical border-critical/20",
  due: "bg-info-muted text-info border-info/20",
  scheduled: "bg-muted text-muted-foreground border-border",
  waived: "bg-muted text-muted-foreground border-border line-through",
};

export function PaymentStatusBadge({
  status,
  daysLate,
  className,
}: {
  status: PaymentStatus;
  daysLate?: number;
  className?: string;
}) {
  let label = labelize(status);
  if (status === "paid" && daysLate && daysLate > 0) label = `Paid · ${daysLate}d late`;
  if (status === "overdue" && daysLate) label = `Overdue · ${daysLate}d`;
  return <Pill className={cn(PAYMENT_STATUS[status], className)}>{label}</Pill>;
}

export function NeutralPill({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Pill className={cn("bg-muted text-muted-foreground border-border", className)}>{children}</Pill>;
}
