import { cn } from "@/lib/utils";

interface SectionCardProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Remove body padding — for tables and lists that manage their own. */
  flush?: boolean;
}

export function SectionCard({ title, description, action, children, className, bodyClassName, flush }: SectionCardProps) {
  return (
    <section className={cn("rounded-lg border bg-card shadow-xs", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold leading-tight">{title}</h2>}
            {description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cn(!flush && "px-4 pb-4", !title && !action && !flush && "pt-4", bodyClassName)}>{children}</div>
    </section>
  );
}
