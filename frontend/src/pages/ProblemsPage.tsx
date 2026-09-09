import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch } from "@/lib/api";
import { STATUS_LABELS, type AssetStatus, type ProblemOut, type SiteOut } from "@/lib/types";

const fieldClass =
  "rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring";

const PROBLEM_STATUS_OPTIONS: AssetStatus[] = ["down", "warning"];

function formatDuration(since: string | null): string {
  if (!since) return "—";
  const ms = Date.now() - new Date(since).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "agora mesmo";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

export function ProblemsPage() {
  const [siteFilter, setSiteFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<AssetStatus | "">("");
  const [search, setSearch] = useState("");

  const sitesQuery = useQuery({
    queryKey: ["sites", "__problems"],
    queryFn: () => apiFetch<SiteOut[]>("/sites"),
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ["problems", siteFilter, statusFilter, search],
    queryFn: () => {
      const query = new URLSearchParams();
      if (siteFilter) query.set("site_id", siteFilter);
      if (statusFilter) query.set("status", statusFilter);
      if (search) query.set("search", search);
      const qs = query.toString();
      return apiFetch<ProblemOut[]>(`/problems${qs ? `?${qs}` : ""}`);
    },
    refetchInterval: 15000,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Problemas</h1>

      <div className="flex flex-wrap gap-2">
        <input
          placeholder="Buscar por nome, hostname ou IP"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${fieldClass} w-64`}
        />
        <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} className={fieldClass}>
          <option value="">Todos os sites</option>
          {sitesQuery.data?.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as AssetStatus | "")}
          className={fieldClass}
        >
          <option value="">Down e warning</option>
          {PROBLEM_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
      {isError && <p className="text-sm text-destructive">Não foi possível carregar os problemas.</p>}
      {data?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {siteFilter || statusFilter || search
            ? "Nenhum problema encontrado com esses filtros."
            : "Nenhum ativo em warning ou down no momento."}
        </p>
      )}

      {data && data.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Ativo</th>
                <th className="px-3 py-2 font-medium">Site</th>
                <th className="px-3 py-2 font-medium">IP / Hostname</th>
                <th className="px-3 py-2 font-medium">Problema</th>
                <th className="px-3 py-2 font-medium">Desde</th>
                <th className="px-3 py-2 font-medium">Última checagem</th>
              </tr>
            </thead>
            <tbody>
              {data.map((problem) => (
                <tr key={problem.asset_id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <StatusBadge status={problem.status} />
                  </td>
                  <td className="px-3 py-2">
                    <Link to={`/assets/${problem.asset_id}`} className="hover:underline">
                      {problem.asset_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{problem.site_name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{problem.ip_or_hostname}</td>
                  <td className="px-3 py-2 text-muted-foreground">{problem.message ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{formatDuration(problem.status_since)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {problem.last_check_at ? formatDuration(problem.last_check_at) : "Nunca"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
