import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-6 py-10 text-center ${className ?? ""}`}>
      {Icon && (
        <div className="mb-1 flex h-9 w-9 items-center justify-center rounded-full bg-muted">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}
