import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { StatusBadge, StatusShape } from "@/components/StatusBadge";
import { apiFetch } from "@/lib/api";
import type { AssetStatus } from "@/lib/types";

interface DashboardTotals {
  total: number;
  up: number;
  warning: number;
  down: number;
  unknown: number;
}

interface DashboardSiteHealth {
  site_id: string;
  site_name: string;
  total_assets: number;
  up_percentage: number | null;
}

interface DashboardActivityEntry {
  asset_id: string;
  asset_name: string;
  status: AssetStatus;
  checked_at: string;
}

interface DashboardProblem {
  asset_id: string;
  asset_name: string;
  site_name: string;
  status: AssetStatus;
  status_since: string | null;
}

interface DashboardResponse {
  totals: DashboardTotals;
  sites: DashboardSiteHealth[];
  problems: DashboardProblem[];
  recent_activity: DashboardActivityEntry[];
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "agora mesmo";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  return `há ${Math.floor(hours / 24)}d`;
}

export function DashboardPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiFetch<DashboardResponse>("/dashboard"),
    refetchInterval: 20000,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (isError || !data) return <p className="text-sm text-destructive">Não foi possível carregar a visão geral.</p>;

  const { totals, sites, problems, recent_activity: activity } = data;

  if (totals.total === 0) {
    return (
      <div className="max-w-md space-y-2">
        <h1 className="text-lg font-semibold">Visão geral</h1>
        <p className="text-sm text-muted-foreground">
          Nenhum ativo cadastrado ainda.{" "}
          <Link to="/assets" className="underline underline-offset-2">
            Cadastre o primeiro ativo
          </Link>{" "}
          para começar a monitorar.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border p-6">
        <p className="text-sm text-muted-foreground">Estado geral</p>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="text-4xl font-semibold tracking-tight">{totals.total}</span>
          <span className="text-muted-foreground">ativos monitorados</span>
        </p>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <StatusShape status="up" size={9} />
            <span className="font-mono">{totals.up}</span> online
          </span>
          <span className="inline-flex items-center gap-1.5">
            <StatusShape status="warning" size={9} />
            <span className="font-mono">{totals.warning}</span> em alerta
          </span>
          <span className="inline-flex items-center gap-1.5">
            <StatusShape status="down" size={9} />
            <span className="font-mono">{totals.down}</span> offline
          </span>
          {totals.unknown > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <StatusShape status="unknown" size={9} />
              <span className="font-mono">{totals.unknown}</span> sem checagem ainda
            </span>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-medium">Problemas atuais</h2>
            {problems.length > 0 && (
              <Link to="/problems" className="text-xs text-muted-foreground hover:underline">
                Ver todos
              </Link>
            )}
          </div>
          {problems.length === 0 ? (
            <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
              Nenhum problema no momento.
            </p>
          ) : (
            <div className="divide-y divide-border rounded-md border border-border">
              {problems.map((problem) => (
                <Link
                  key={problem.asset_id}
                  to={`/assets/${problem.asset_id}`}
                  className="flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/50"
                >
                  <span className="flex items-center gap-2">
                    <StatusShape status={problem.status} />
                    <span>{problem.asset_name}</span>
                    <span className="text-xs text-muted-foreground">{problem.site_name}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {problem.status_since ? relativeTime(problem.status_since) : "—"}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="lg:col-span-2">
          <h2 className="mb-2 text-sm font-medium">Sites</h2>
          <div className="divide-y divide-border rounded-md border border-border">
            {sites.map((site) => (
              <div key={site.site_id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{site.site_name}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {site.up_percentage != null ? `${site.up_percentage}%` : `${site.total_assets} ativos`}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Atividade recente</h2>
        <div className="divide-y divide-border rounded-md border border-border">
          {activity.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">Nenhuma checagem registrada ainda.</p>
          )}
          {activity.map((entry, index) => (
            <div key={`${entry.asset_id}-${index}`} className="flex items-center justify-between px-3 py-1.5 text-sm">
              <span className="flex items-center gap-2">
                <StatusBadge status={entry.status} className="text-xs" />
                <span className="text-muted-foreground">{entry.asset_name}</span>
              </span>
              <span className="text-xs text-muted-foreground">{relativeTime(entry.checked_at)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
