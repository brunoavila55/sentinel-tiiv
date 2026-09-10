import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Network,
  Server,
  Settings,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, NavLink, Outlet } from "react-router-dom";

import { Select } from "@/components/ui/select";
import { ThemeToggle } from "@/components/ThemeToggle";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import type { OrganizationOut } from "@/lib/types";

const DEFAULT_FAVICON = "/favicon.svg";

// A escolha da variante segue o tema do próprio app (useTheme), não o
// prefers-color-scheme do sistema operacional — o app mantém tema próprio,
// independente do SO (ver theme-context.tsx). Se só uma variante existir,
// ela serve de fallback para os dois modos.
function OrganizationLogo({
  logoLightUrl,
  logoDarkUrl,
}: {
  logoLightUrl: string | null | undefined;
  logoDarkUrl: string | null | undefined;
}) {
  const { theme } = useTheme();
  const src = (theme === "dark" ? logoDarkUrl : logoLightUrl) || logoLightUrl || logoDarkUrl;
  if (!src) return null;

  return <img src={src} alt="" className="h-6 w-6 shrink-0 rounded-sm object-contain" />;
}

function useOrganizationFavicon(faviconUrl: string | null | undefined) {
  useEffect(() => {
    const link =
      document.querySelector<HTMLLinkElement>("link[rel='icon']") ??
      (() => {
        const created = document.createElement("link");
        created.rel = "icon";
        document.head.appendChild(created);
        return created;
      })();
    link.href = faviconUrl || DEFAULT_FAVICON;
  }, [faviconUrl]);
}

const navGroups = [
  {
    label: "Monitoramento",
    items: [
      { to: "/", label: "Visão geral", icon: LayoutDashboard },
      { to: "/topology", label: "Topologia", icon: Network },
      { to: "/assets", label: "Ativos", icon: Server },
      { to: "/sites", label: "Sites", icon: Building2 },
      { to: "/problems", label: "Problemas", icon: AlertTriangle },
    ],
  },
  {
    label: "Administração",
    items: [
      { to: "/settings/members", label: "Usuários", icon: Users },
      { to: "/settings/organization", label: "Organização", icon: Settings },
    ],
  },
];

// Auditoria é trilha administrativa — só quem já gerencia usuários vê o
// link (o backend também recusa 403 pra quem não é owner/admin).
const ADMIN_NAV_ITEM = { to: "/settings/audit-logs", label: "Auditoria", icon: History };

function initialsOf(name: string | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

export function AppLayout() {
  const { status, user, memberships, currentOrganizationId, currentMembership, selectOrganization, logout } =
    useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const canSeeAudit = currentMembership?.role === "owner" || currentMembership?.role === "admin";
  const groups = canSeeAudit
    ? [...navGroups.slice(0, 1), { ...navGroups[1], items: [...navGroups[1].items, ADMIN_NAV_ITEM] }]
    : navGroups;

  const organizationQuery = useQuery({
    queryKey: ["organization", currentOrganizationId],
    queryFn: () => apiFetch<OrganizationOut>("/organizations/current"),
    enabled: Boolean(currentOrganizationId) && status === "authenticated",
  });

  useOrganizationFavicon(organizationQuery.data?.favicon_url);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Carregando...
      </div>
    );
  }

  if (status === "anonymous") {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-20 bg-foreground/20 md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-60 shrink-0 flex-col border-r border-border bg-sidebar transition-transform md:static md:translate-x-0 ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <OrganizationLogo logoLightUrl={organizationQuery.data?.logo_light_url} logoDarkUrl={organizationQuery.data?.logo_dark_url} />
            <span className="font-mono text-sm font-medium tracking-tight">sentinel</span>
          </div>
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setMobileNavOpen(false)}
            className="text-muted-foreground md:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {memberships.length > 1 && (
          <div className="px-3 pb-3">
            <Select
              value={currentOrganizationId ?? ""}
              onChange={(e) => selectOrganization(e.target.value)}
              aria-label="Organização atual"
            >
              {memberships.map((m) => (
                <option key={m.organization_id} value={m.organization_id}>
                  {m.organization_name}
                </option>
              ))}
            </Select>
          </div>
        )}

        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 pt-1 pb-3">
          {groups.map((group) => (
            <div key={group.label} className="space-y-0.5">
              <p className="px-2 pb-1 text-[11px] text-muted-foreground">{group.label}</p>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  onClick={() => setMobileNavOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
                      isActive
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`
                  }
                >
                  <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="flex items-center gap-2.5 border-t border-border p-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
            {initialsOf(user?.name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm leading-tight">{user?.name}</p>
            <p className="truncate text-xs leading-tight text-muted-foreground">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            aria-label="Sair"
            title="Sair"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
          <button
            type="button"
            aria-label="Abrir menu"
            onClick={() => setMobileNavOpen(true)}
            className="text-muted-foreground md:hidden"
          >
            <Menu className="h-4 w-4" />
          </button>

          <span className="text-sm text-muted-foreground">{currentMembership?.organization_name}</span>

          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-x-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
