import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/ThemeToggle";

/** Três nós conectados — remete à topologia de rede que o produto monitora, não é um glifo decorativo genérico. */
function BrandMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" className="shrink-0 text-primary">
      <line x1="4" y1="15" x2="16" y2="5" stroke="currentColor" strokeWidth="1.4" opacity="0.45" />
      <line x1="4" y1="15" x2="10.5" y2="17.5" stroke="currentColor" strokeWidth="1.4" opacity="0.45" />
      <circle cx="16" cy="5" r="2.3" fill="currentColor" />
      <circle cx="4" cy="15" r="2.3" fill="currentColor" />
      <circle cx="10.5" cy="17.5" r="1.8" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main
      className="relative flex min-h-screen items-center justify-center bg-background p-4 text-foreground"
      style={{
        backgroundImage:
          "radial-gradient(color-mix(in oklch, var(--border), transparent 15%) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
    >
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <div className="flex items-center gap-2">
          <BrandMark />
          <span className="font-mono text-sm font-medium tracking-tight">sentinel</span>
        </div>
        {children}
      </div>
    </main>
  );
}
