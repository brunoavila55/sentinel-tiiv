import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { AssetForm, emptyAssetForm, type AssetFormValues } from "@/components/AssetForm";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  STATUS_LABELS,
  type AssetListResponse,
  type AssetOut,
  type AssetStatus,
  type SiteOut,
} from "@/lib/types";

const fieldClass =
  "rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring";

const STATUS_OPTIONS: AssetStatus[] = ["unknown", "up", "warning", "down"];
const PAGE_SIZE = 20;

const SORTABLE_COLUMNS: { key: string; label: string }[] = [
  { key: "name", label: "Nome" },
  { key: "status", label: "Status" },
  { key: "site_name", label: "Site" },
  { key: "last_rtt_ms", label: "RTT" },
  { key: "packet_loss", label: "Perda" },
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Ativos</h1>
        {canManage && !showForm && (
          <Button size="sm" onClick={startCreate}>
            Novo ativo
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          placeholder="Buscar por nome, hostname ou IP"
          value={search}
          onChange={(e) => {
            setPage(0);
            setSearch(e.target.value);
          }}
          className={`${fieldClass} w-64`}
        />
        <select
          value={siteFilter}
          onChange={(e) => {
            setPage(0);
            setSiteFilter(e.target.value);
          }}
          className={fieldClass}
        >
          <option value="">Todos os sites</option>
          {sitesQuery.data?.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => {
            setPage(0);
            setStatusFilter(e.target.value as AssetStatus | "");
          }}
          className={fieldClass}
        >
          <option value="">Todos os status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          value={enabledFilter}
          onChange={(e) => {
            setPage(0);
            setEnabledFilter(e.target.value as "" | "true" | "false");
          }}
          className={fieldClass}
        >
          <option value="">Habilitados e desabilitados</option>
          <option value="true">Só habilitados</option>
          <option value="false">Só desabilitados</option>
        </select>
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

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-muted-foreground">
            <tr>
              {SORTABLE_COLUMNS.map((col) => (
                <th key={col.key} className="px-3 py-2 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    {col.label}
                    {sort === col.key && <span aria-hidden="true">↑</span>}
                    {sort === `-${col.key}` && <span aria-hidden="true">↓</span>}
                  </button>
                </th>
              ))}
              <th className="px-3 py-2 font-medium">IP / Hostname</th>
              {canManage && <th className="px-3 py-2 font-medium">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {assetsQuery.isLoading && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            )}
            {assetsQuery.isError && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-destructive">
                  Não foi possível carregar os ativos.
                </td>
              </tr>
            )}
            {assetsQuery.data?.items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-muted-foreground">
                  Nenhum ativo encontrado.{" "}
                  {canManage && sitesQuery.data?.length === 0 && "Crie um site antes de cadastrar ativos."}
                </td>
              </tr>
            )}
            {assetsQuery.data?.items.map((asset) => (
              <tr
                key={asset.id}
                onClick={() => navigate(`/assets/${asset.id}`)}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50"
              >
                <td className="px-3 py-2">
                  <Link to={`/assets/${asset.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                    {asset.name}
                  </Link>
                  {!asset.enabled && <span className="ml-1 text-xs text-muted-foreground">(desabilitado)</span>}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={asset.status} className="text-xs" />
                </td>
                <td className="px-3 py-2 text-muted-foreground">{asset.site_name}</td>
                <td className="px-3 py-2 font-mono text-xs">{asset.last_rtt_ms != null ? `${asset.last_rtt_ms} ms` : "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{asset.packet_loss != null ? `${asset.packet_loss}%` : "—"}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {asset.last_check_at ? new Date(asset.last_check_at).toLocaleString("pt-BR") : "Nunca"}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{asset.ip_address ?? asset.hostname}</td>
                {canManage && (
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
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
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
    </div>
  );
}
