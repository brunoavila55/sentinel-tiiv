import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme-context";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={toggleTheme}
      className={className}
      aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
      title={isDark ? "Modo claro" : "Modo escuro"}
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  );
}
