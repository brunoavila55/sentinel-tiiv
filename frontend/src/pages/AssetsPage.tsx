import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Server } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { AssetForm, emptyAssetForm, type AssetFormValues } from "@/components/AssetForm";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  STATUS_LABELS,
  type AssetListResponse,
  type AssetOut,
  type AssetStatus,
  type SiteOut,
} from "@/lib/types";

const STATUS_OPTIONS: AssetStatus[] = ["unknown", "up", "warning", "down"];
const PAGE_SIZE = 20;

const SORTABLE_COLUMNS: { key: string; label: string; align?: "right" }[] = [
  { key: "name", label: "Nome" },
  { key: "status", label: "Status" },
  { key: "site_name", label: "Site" },
  { key: "last_rtt_ms", label: "RTT", align: "right" },
  { key: "packet_loss", label: "Perda", align: "right" },
  { key: "last_check_at", label: "Última checagem" },
];

export function AssetsPage() {
  const { currentOrganizationId, currentMembership } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const canManage =
    currentMembership?.role === "owner" || currentMembership?.role === "admin" || currentMembership?.role === "operator";

  const [search, setSearch] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<AssetStatus | "">("");
  const [enabledFilter, setEnabledFilter] = useState<"" | "true" | "false">("");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(0);

  function toggleSort(key: string) {
    setPage(0);
    setSort((current) => (current === key ? `-${key}` : key));
  }

  const [showForm, setShowForm] = useState(false);
  const [editingAsset, setEditingAsset] = useState<AssetOut | null>(null);
  const [saving, setSaving] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const sitesQuery = useQuery({
    queryKey: ["sites", currentOrganizationId, "__all_for_filter"],
    queryFn: () => apiFetch<SiteOut[]>("/sites"),
    enabled: Boolean(currentOrganizationId),
  });

  const assetsQuery = useQuery({
    queryKey: ["assets", currentOrganizationId, search, siteFilter, statusFilter, enabledFilter, sort, page],
    queryFn: () => {
      const query = new URLSearchParams();
      if (search) query.set("search", search);
      if (siteFilter) query.set("site_id", siteFilter);
      if (statusFilter) query.set("status", statusFilter);
      if (enabledFilter) query.set("enabled", enabledFilter);
      if (sort) query.set("sort", sort);
      query.set("limit", String(PAGE_SIZE));
      query.set("offset", String(page * PAGE_SIZE));
      return apiFetch<AssetListResponse>(`/assets?${query.toString()}`);
    },
    enabled: Boolean(currentOrganizationId),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["assets", currentOrganizationId] });
  }

  function startCreate() {
    setEditingAsset(null);
    setShowForm(true);
  }

  function startEdit(asset: AssetOut) {
    setEditingAsset(asset);
    setShowForm(true);
  }

  function cancelForm() {
    setEditingAsset(null);
    setShowForm(false);
  }

  async function handleFormSubmit(values: AssetFormValues) {
    setSaving(true);
    try {
      const payload = {
        name: values.name,
        site_id: values.site_id,
        hostname: values.hostname || null,
        ip_address: values.ip_address || null,
        description: values.description || null,
        enabled: values.enabled,
        parent_asset_id: values.parent_asset_id || null,
      };
      if (editingAsset) {
        await apiFetch(`/assets/${editingAsset.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await apiFetch("/assets", { method: "POST", body: JSON.stringify(payload) });
      }
      setShowForm(false);
      setEditingAsset(null);
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(asset: AssetOut) {
    if (!window.confirm(`Remover o ativo "${asset.name}"?`)) return;
    setListError(null);
    try {
      await apiFetch(`/assets/${asset.id}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "Não foi possível remover o ativo.");
    }
  }

  async function handleToggleEnabled(asset: AssetOut) {
    setListError(null);
    try {
      await apiFetch(`/assets/${asset.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !asset.enabled }) });
      await refresh();
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "Não foi possível alterar o ativo.");
    }
  }

  const total = assetsQuery.data?.total ?? 0;
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  const items = assetsQuery.data?.items ?? [];
  const hasNoSites = canManage && sitesQuery.data?.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Ativos</h1>
          <p className="text-sm text-muted-foreground">{total > 0 ? `${total} cadastrados` : "Nenhum ativo cadastrado ainda"}</p>
        </div>
        {canManage && !showForm && <Button size="sm" onClick={startCreate}>Novo ativo</Button>}
      </div>

      <div className="flex flex-wrap gap-2">
        <SearchInput
          placeholder="Buscar por nome, hostname ou IP"
          value={search}
          onChange={(e) => {
            setPage(0);
            setSearch(e.target.value);
          }}
          className="w-64"
        />
        <Select
          value={siteFilter}
          onChange={(e) => {
            setPage(0);
            setSiteFilter(e.target.value);
          }}
          className="w-40"
        >
          <option value="">Todos os sites</option>
          {sitesQuery.data?.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </Select>
        <Select
          value={statusFilter}
          onChange={(e) => {
            setPage(0);
            setStatusFilter(e.target.value as AssetStatus | "");
          }}
          className="w-40"
        >
          <option value="">Todos os status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select
          value={enabledFilter}
          onChange={(e) => {
            setPage(0);
            setEnabledFilter(e.target.value as "" | "true" | "false");
          }}
          className="w-52"
        >
          <option value="">Habilitados e desabilitados</option>
          <option value="true">Só habilitados</option>
          <option value="false">Só desabilitados</option>
        </Select>
      </div>

      {canManage && showForm && (
        <AssetForm
          title={editingAsset ? `Editar ${editingAsset.name}` : "Novo ativo"}
          sites={sitesQuery.data ?? []}
          initialValues={
            editingAsset
              ? {
                  name: editingAsset.name,
                  site_id: editingAsset.site_id,
                  hostname: editingAsset.hostname ?? "",
                  ip_address: editingAsset.ip_address ?? "",
                  description: editingAsset.description ?? "",
                  enabled: editingAsset.enabled,
                  parent_asset_id: editingAsset.parent_asset_id ?? "",
                }
              : { ...emptyAssetForm, site_id: sitesQuery.data?.[0]?.id ?? "" }
          }
          onSubmit={handleFormSubmit}
          onCancel={cancelForm}
          submitting={saving}
          submitLabel={editingAsset ? "Salvar" : "Criar ativo"}
          excludeAssetId={editingAsset?.id}
        />
      )}

      {listError && <p className="text-sm text-destructive">{listError}</p>}

      {assetsQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : assetsQuery.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar os ativos.</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Server}
          title="Nenhum ativo encontrado."
          description={hasNoSites ? "Crie um site antes de cadastrar ativos." : "Ajuste os filtros ou cadastre um novo ativo."}
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <tr>
                {SORTABLE_COLUMNS.map((col) => (
                  <TableHead key={col.key} className={col.align === "right" ? "text-right" : undefined}>
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={`inline-flex items-center gap-1 hover:text-foreground ${col.align === "right" ? "flex-row-reverse" : ""}`}
                    >
                      {col.label}
                      {sort === col.key && <ArrowUp className="h-3 w-3" aria-hidden="true" />}
                      {sort === `-${col.key}` && <ArrowDown className="h-3 w-3" aria-hidden="true" />}
                    </button>
                  </TableHead>
                ))}
                <TableHead>IP / Hostname</TableHead>
                {canManage && <TableHead>Ações</TableHead>}
              </tr>
            </TableHeader>
            <TableBody>
              {items.map((asset) => (
                <TableRow
                  key={asset.id}
                  onClick={() => navigate(`/assets/${asset.id}`)}
                  className="cursor-pointer hover:bg-muted/50"
                >
                  <TableCell>
                    <Link to={`/assets/${asset.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                      {asset.name}
                    </Link>
                    {!asset.enabled && <span className="ml-1 text-xs text-muted-foreground">(desabilitado)</span>}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={asset.status} className="text-xs" />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{asset.site_name}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {asset.last_rtt_ms != null ? `${asset.last_rtt_ms} ms` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {asset.packet_loss != null ? `${asset.packet_loss}%` : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {asset.last_check_at ? new Date(asset.last_check_at).toLocaleString("pt-BR") : "Nunca"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{asset.ip_address ?? asset.hostname}</TableCell>
                  {canManage && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => startEdit(asset)}>
                          Editar
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleToggleEnabled(asset)}>
                          {asset.enabled ? "Desativar" : "Ativar"}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleDelete(asset)}>
                          Excluir
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {total > 0 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Mostrando {from}–{to} de {total}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Anterior
                </Button>
                <Button variant="outline" size="sm" disabled={to >= total} onClick={() => setPage((p) => p + 1)}>
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
