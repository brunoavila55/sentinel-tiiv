import { Search } from "lucide-react";
import { forwardRef, type InputHTMLAttributes } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const SearchInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function SearchInput({ className, ...props }, ref) {
    return (
      <div className={cn("relative", className)}>
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input ref={ref} className="pl-8" {...props} />
      </div>
    );
  },
);
