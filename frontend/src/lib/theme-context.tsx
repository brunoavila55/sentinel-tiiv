import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "sentinel-theme";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): Theme {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/**
 * Claro é o padrão do produto — nunca deriva do prefers-color-scheme do
 * sistema. Só muda para escuro por escolha explícita do usuário, persistida
 * em localStorage (aplicada também antes do React montar, via script inline
 * em index.html, para não piscar o tema errado).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // localStorage indisponível (modo privado etc.): segue sem persistir.
    }
  }, [theme]);

  function toggleTheme() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

/**
 * Sem provider (ex.: testes que montam páginas isoladamente), cai para o
 * padrão claro com toggle inerte em vez de lançar — o tema não é crítico
 * para o comportamento testado nessas páginas.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  return ctx ?? { theme: "light", toggleTheme: () => {} };
}
