import { useQuery } from "@tanstack/react-query";
import { CircleCheck } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import { STATUS_LABELS, type AssetStatus, type ProblemOut, type SiteOut } from "@/lib/types";

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

  const hasFilters = Boolean(siteFilter || statusFilter || search);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Problemas</h1>
        <p className="text-sm text-muted-foreground">Ativos em alerta ou offline no momento.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <SearchInput
          placeholder="Buscar por nome, hostname ou IP"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
        <Select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} className="w-40">
          <option value="">Todos os sites</option>
          {sitesQuery.data?.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as AssetStatus | "")} className="w-40">
          <option value="">Down e warning</option>
          {PROBLEM_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar os problemas.</p>
      ) : data?.length === 0 ? (
        <EmptyState
          icon={CircleCheck}
          title={hasFilters ? "Nenhum problema encontrado com esses filtros." : "Nenhum ativo em warning ou down no momento."}
        />
      ) : (
        <Table>
          <TableHeader>
            <tr>
              <TableHead>Status</TableHead>
              <TableHead>Ativo</TableHead>
              <TableHead>Site</TableHead>
              <TableHead>IP / Hostname</TableHead>
              <TableHead>Problema</TableHead>
              <TableHead>Desde</TableHead>
              <TableHead>Última checagem</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {data?.map((problem) => (
              <TableRow key={problem.asset_id}>
                <TableCell>
                  <StatusBadge status={problem.status} />
                </TableCell>
                <TableCell>
                  <Link to={`/assets/${problem.asset_id}`} className="hover:underline">
                    {problem.asset_name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{problem.site_name}</TableCell>
                <TableCell className="font-mono text-xs">{problem.ip_or_hostname}</TableCell>
                <TableCell className="text-muted-foreground">{problem.message ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDuration(problem.status_since)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {problem.last_check_at ? formatDuration(problem.last_check_at) : "Nunca"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
