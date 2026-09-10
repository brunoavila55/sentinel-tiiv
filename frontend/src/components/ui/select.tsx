import { ChevronDown } from "lucide-react";
import { forwardRef, type SelectHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <div className={cn("relative inline-flex", className)}>
      <select
        ref={ref}
        className="h-8 w-full appearance-none rounded-md border border-border bg-background py-1.5 pr-7 pl-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60"
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
});
