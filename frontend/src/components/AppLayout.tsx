import { useState } from "react";
import { Navigate, NavLink, Outlet } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

const navItems = [
  { to: "/", label: "Visão geral" },
  { to: "/topology", label: "Topologia" },
  { to: "/assets", label: "Ativos" },
  { to: "/sites", label: "Sites" },
  { to: "/problems", label: "Problemas" },
  { to: "/settings/members", label: "Usuários" },
  { to: "/settings/organization", label: "Organização" },
];

// Auditoria é trilha administrativa — só quem já gerencia usuários vê o
// link (o backend também recusa 403 pra quem não é owner/admin).
const ADMIN_NAV_ITEM = { to: "/settings/audit-logs", label: "Auditoria" };

export function AppLayout() {
  const { status, user, memberships, currentOrganizationId, currentMembership, selectOrganization, logout } =
    useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const canSeeAudit = currentMembership?.role === "owner" || currentMembership?.role === "admin";
  const visibleNavItems = canSeeAudit ? [...navItems, ADMIN_NAV_ITEM] : navItems;

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
        className={`fixed inset-y-0 left-0 z-30 flex w-56 shrink-0 flex-col border-r border-border bg-sidebar transition-transform md:static md:translate-x-0 ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-4 py-4">
          <span className="font-mono text-sm font-medium tracking-tight">sentinel</span>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-2">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={() => setMobileNavOpen(false)}
              className={({ isActive }) =>
                `border-l-2 px-3 py-1.5 text-sm ${
                  isActive
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-border p-3">
          <p className="truncate text-sm">{user?.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => void logout()}>
            Sair
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
          <button
            type="button"
            aria-label="Abrir menu"
            onClick={() => setMobileNavOpen(true)}
            className="text-sm text-muted-foreground md:hidden"
          >
            Menu
          </button>

          {memberships.length > 1 ? (
            <select
              value={currentOrganizationId ?? ""}
              onChange={(e) => selectOrganization(e.target.value)}
              className="rounded-md border border-border bg-transparent px-2 py-1 text-sm"
              aria-label="Organização atual"
            >
              {memberships.map((m) => (
                <option key={m.organization_id} value={m.organization_id}>
                  {m.organization_name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-sm text-muted-foreground">{currentMembership?.organization_name}</span>
          )}
        </header>

        <main className="min-w-0 flex-1 overflow-x-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
