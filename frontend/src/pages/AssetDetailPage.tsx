import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { AssetForm, type AssetFormValues } from "@/components/AssetForm";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { AssetOut, AssetPhotoOut, CheckOut, CheckResultOut, SiteOut } from "@/lib/types";

const fieldClass =
  "rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring";

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `há ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  return `há ${Math.floor(hours / 24)}d`;
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function AssetDetailPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const navigate = useNavigate();
  const { currentMembership } = useAuth();
  const canManage =
    currentMembership?.role === "owner" || currentMembership?.role === "admin" || currentMembership?.role === "operator";
  const queryClient = useQueryClient();

  const [editingAsset, setEditingAsset] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const assetQuery = useQuery({
    queryKey: ["asset", assetId],
    queryFn: () => apiFetch<AssetOut>(`/assets/${assetId}`),
    enabled: Boolean(assetId),
  });
  const sitesQuery = useQuery({
    queryKey: ["sites", "__asset_detail"],
    queryFn: () => apiFetch<SiteOut[]>("/sites"),
    enabled: canManage,
  });

  async function refreshAsset() {
    await queryClient.invalidateQueries({ queryKey: ["asset", assetId] });
  }

  async function handleAssetFormSubmit(values: AssetFormValues) {
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
      await apiFetch(`/assets/${assetId}`, { method: "PATCH", body: JSON.stringify(payload) });
      setEditingAsset(false);
      await refreshAsset();
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleEnabled() {
    if (!assetQuery.data) return;
    setActionError(null);
    try {
      await apiFetch(`/assets/${assetId}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !assetQuery.data.enabled }),
      });
      await refreshAsset();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Não foi possível alterar o ativo.");
    }
  }

  async function handleDelete() {
    if (!assetQuery.data) return;
    if (!window.confirm(`Excluir o ativo "${assetQuery.data.name}"? Essa ação não pode ser desfeita.`)) return;
    setActionError(null);
    try {
      await apiFetch(`/assets/${assetId}`, { method: "DELETE" });
      navigate("/assets", { replace: true });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Não foi possível excluir o ativo.");
    }
  }

  if (assetQuery.isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (assetQuery.isError || !assetQuery.data) return <p className="text-sm text-destructive">Ativo não encontrado.</p>;

  const asset = assetQuery.data;

  return (
    <div className="max-w-2xl space-y-6">
      <Link to="/assets" className="text-sm text-muted-foreground hover:underline">
        ← Ativos
      </Link>

      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{asset.name}</h1>
          <StatusBadge status={asset.status} className="text-sm" />
        </div>
        <p className="font-mono text-sm text-muted-foreground">
          {asset.ip_address ?? asset.hostname} · {asset.site_name}
        </p>
        {asset.parent_asset_id && <ParentAssetLine parentAssetId={asset.parent_asset_id} />}
      </div>

      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditingAsset((v) => !v)}>
            {editingAsset ? "Cancelar edição" : "Editar ativo"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => scrollToSection("photos-section")}>
            Adicionar foto
          </Button>
          <Button variant="outline" size="sm" onClick={() => scrollToSection("monitoring-section")}>
            Editar monitoramento
          </Button>
          <Button variant="outline" size="sm" onClick={handleToggleEnabled}>
            {asset.enabled ? "Desativar" : "Ativar"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDelete}>
            Excluir
          </Button>
        </div>
      )}

      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      {editingAsset && canManage ? (
        <AssetForm
          title="Editar ativo"
          sites={sitesQuery.data ?? []}
          initialValues={{
            name: asset.name,
            site_id: asset.site_id,
            hostname: asset.hostname ?? "",
            ip_address: asset.ip_address ?? "",
            description: asset.description ?? "",
            enabled: asset.enabled,
            parent_asset_id: asset.parent_asset_id ?? "",
          }}
          onSubmit={handleAssetFormSubmit}
          onCancel={() => setEditingAsset(false)}
          submitting={saving}
          submitLabel="Salvar"
          excludeAssetId={asset.id}
        />
      ) : (
        asset.description && <p className="text-sm">{asset.description}</p>
      )}

      <div className="space-y-3 border-t border-border pt-4">
        <h2 className="text-sm font-medium">Status atual</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">RTT</div>
            <div className="font-mono">{asset.last_rtt_ms != null ? `${asset.last_rtt_ms} ms` : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Packet loss</div>
            <div className="font-mono">{asset.packet_loss != null ? `${asset.packet_loss}%` : "—"}</div>
          </div>
        </div>
        <div className="text-sm">
          <div className="text-muted-foreground">Último check</div>
          <div>{asset.last_check_at ? relativeTime(asset.last_check_at) : "Nunca"}</div>
        </div>
      </div>

      {assetId && <HistorySection assetId={assetId} />}
      {assetId && <PhotosSection assetId={assetId} canManage={canManage} />}
      {assetId && <MonitoringSection assetId={assetId} canManage={canManage} />}
    </div>
  );
}

function ParentAssetLine({ parentAssetId }: { parentAssetId: string }) {
  const { data } = useQuery({
    queryKey: ["asset", parentAssetId, "__parent_name"],
    queryFn: () => apiFetch<AssetOut>(`/assets/${parentAssetId}`),
  });

  if (!data) return null;

  return (
    <p className="text-sm text-muted-foreground">
      Ativo pai:{" "}
      <Link to={`/assets/${data.id}`} className="hover:underline">
        {data.name}
      </Link>
    </p>
  );
}

function HistorySection({ assetId }: { assetId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["asset-history", assetId],
    queryFn: () => apiFetch<CheckResultOut[]>(`/assets/${assetId}/history?limit=20`),
  });

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h2 className="text-sm font-medium">Histórico de monitoramento</h2>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
      {isError && <p className="text-sm text-destructive">Não foi possível carregar o histórico.</p>}
      {!isError && data?.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma checagem registrada ainda.</p>
      )}

      {data && data.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">RTT</th>
                <th className="px-3 py-2 font-medium">Perda</th>
                <th className="px-3 py-2 font-medium">Mensagem</th>
                <th className="px-3 py-2 font-medium">Quando</th>
              </tr>
            </thead>
            <tbody>
              {data.map((entry) => (
                <tr key={entry.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <StatusBadge status={entry.status} />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{entry.latency_ms != null ? `${entry.latency_ms} ms` : "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{entry.packet_loss != null ? `${entry.packet_loss}%` : "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{entry.message ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{relativeTime(entry.checked_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PhotosSection({ assetId, canManage }: { assetId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<AssetPhotoOut | null>(null);

  const photosQuery = useQuery({
    queryKey: ["asset-photos", assetId],
    queryFn: () => apiFetch<AssetPhotoOut[]>(`/assets/${assetId}/photos`),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["asset-photos", assetId] });
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await apiFetch(`/assets/${assetId}/photos`, { method: "POST", body: formData });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível enviar a foto.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDelete(photo: AssetPhotoOut) {
    if (!window.confirm("Remover esta foto?")) return;
    setError(null);
    try {
      await apiFetch(`/assets/${assetId}/photos/${photo.id}`, { method: "DELETE" });
      if (lightboxPhoto?.id === photo.id) setLightboxPhoto(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível remover a foto.");
    }
  }

  async function handleMakePrimary(photo: AssetPhotoOut) {
    setError(null);
    try {
      await apiFetch(`/assets/${assetId}/photos/${photo.id}`, {
        method: "PATCH",
        body: JSON.stringify({ position: 0 }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível definir como principal.");
    }
  }

  const photos = photosQuery.data ?? [];

  return (
    <div id="photos-section" className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Fotos</h2>
        {canManage && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="hidden"
              id="photo-upload-input"
            />
            <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? "Enviando..." : "Adicionar foto"}
            </Button>
          </>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {photosQuery.isError && <p className="text-sm text-destructive">Não foi possível carregar as fotos.</p>}
      {!photosQuery.isError && photos.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma foto ainda.</p>
      )}

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {photos.map((photo) => (
            <div key={photo.id} className="space-y-1">
              <button type="button" onClick={() => setLightboxPhoto(photo)} className="block w-full">
                <img
                  src={photo.thumbnail_url}
                  alt={photo.caption ?? photo.filename}
                  className={`aspect-square w-full rounded-md border object-cover ${
                    photo.is_primary ? "border-primary" : "border-border"
                  }`}
                />
              </button>
              {photo.is_primary && <div className="text-xs text-muted-foreground">Principal</div>}
              {photo.caption && <div className="truncate text-xs text-muted-foreground">{photo.caption}</div>}
              {canManage && (
                <div className="flex gap-1">
                  {!photo.is_primary && (
                    <button
                      type="button"
                      onClick={() => handleMakePrimary(photo)}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      Tornar principal
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(photo)}
                    className="ml-auto text-xs text-muted-foreground hover:underline"
                  >
                    Excluir
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {lightboxPhoto && (
        <button
          type="button"
          aria-label="Fechar imagem ampliada"
          onClick={() => setLightboxPhoto(null)}
          className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/70 p-8"
        >
          <img
            src={lightboxPhoto.url}
            alt={lightboxPhoto.caption ?? lightboxPhoto.filename}
            className="max-h-full max-w-full rounded-md object-contain"
          />
        </button>
      )}
    </div>
  );
}

function MonitoringSection({ assetId, canManage }: { assetId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [intervalSeconds, setIntervalSeconds] = useState(30);
  const [timeoutSeconds, setTimeoutSeconds] = useState(1);
  const [packets, setPackets] = useState(3);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checksQuery = useQuery({
    queryKey: ["asset-checks", assetId],
    queryFn: () => apiFetch<CheckOut[]>(`/assets/${assetId}/checks`),
  });

  const check = checksQuery.data?.[0];

  function startEdit() {
    if (!check) return;
    setIntervalSeconds(check.interval_seconds);
    setTimeoutSeconds(check.timeout_seconds);
    setPackets(check.packets);
    setEnabled(check.enabled);
    setError(null);
    setEditing(true);
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!check) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/assets/${assetId}/checks/${check.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          interval_seconds: intervalSeconds,
          timeout_seconds: timeoutSeconds,
          packets,
          enabled,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ["asset-checks", assetId] });
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar o monitoramento.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/assets/${assetId}/checks`, { method: "POST", body: JSON.stringify({}) });
      await queryClient.invalidateQueries({ queryKey: ["asset-checks", assetId] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível criar o monitoramento.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div id="monitoring-section" className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Configuração de monitoramento</h2>
        {canManage && check && !editing && (
          <button type="button" onClick={startEdit} className="text-xs text-muted-foreground hover:underline">
            Editar
          </button>
        )}
      </div>

      {checksQuery.isError && (
        <p className="text-sm text-destructive">Não foi possível carregar o monitoramento.</p>
      )}

      {!checksQuery.isError && !check && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Nenhum monitoramento configurado ainda.</p>
          {canManage && (
            <Button size="sm" onClick={handleCreate} disabled={saving}>
              {saving ? "Criando..." : "Criar monitoramento PING"}
            </Button>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}

      {check && !editing && (
        <p className="font-mono text-sm text-muted-foreground">
          {check.type.toUpperCase()} · {check.interval_seconds}s · timeout {check.timeout_seconds}s ·{" "}
          {check.packets} pacotes · {check.enabled ? "ativo" : "inativo"}
        </p>
      )}

      {check && editing && (
        <form onSubmit={handleSave} className="max-w-sm space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label htmlFor="check-interval" className="text-sm">
                Intervalo (s)
              </label>
              <input
                id="check-interval"
                type="number"
                min={10}
                max={3600}
                value={intervalSeconds}
                onChange={(e) => setIntervalSeconds(Number(e.target.value))}
                className={`${fieldClass} w-full`}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="check-timeout" className="text-sm">
                Timeout (s)
              </label>
              <input
                id="check-timeout"
                type="number"
                min={1}
                max={60}
                value={timeoutSeconds}
                onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
                className={`${fieldClass} w-full`}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="check-packets" className="text-sm">
                Pacotes
              </label>
              <input
                id="check-packets"
                type="number"
                min={1}
                max={10}
                value={packets}
                onChange={(e) => setPackets(Number(e.target.value))}
                className={`${fieldClass} w-full`}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Ativo
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
