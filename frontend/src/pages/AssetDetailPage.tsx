import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Copy, Eye, EyeOff, ImageOff } from "lucide-react";
import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { AssetForm, type AssetFormValues } from "@/components/AssetForm";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge, StatusPill } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { AssetOut, AssetPhotoOut, CheckOut, CheckResultOut, SiteOut } from "@/lib/types";

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
  const photosRef = useRef<PhotosSectionHandle>(null);
  const monitoringRef = useRef<MonitoringSectionHandle>(null);

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
      <Link to="/assets" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Ativos
      </Link>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{asset.name}</h1>
          <StatusPill status={asset.status} />
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              scrollToSection("photos-section");
              photosRef.current?.openUpload();
            }}
          >
            Adicionar foto
          </Button>
          <Button variant="outline" size="sm" onClick={() => scrollToSection("backup-section")}>
            Backup
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              scrollToSection("monitoring-section");
              monitoringRef.current?.startEditing();
            }}
          >
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
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-muted-foreground">RTT</div>
            <div className="font-mono text-2xl tracking-tight">
              {asset.last_rtt_ms != null ? asset.last_rtt_ms : "—"}
              {asset.last_rtt_ms != null && <span className="ml-1 text-sm text-muted-foreground">ms</span>}
            </div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Packet loss</div>
            <div className="font-mono text-2xl tracking-tight">
              {asset.packet_loss != null ? asset.packet_loss : "—"}
              {asset.packet_loss != null && <span className="ml-1 text-sm text-muted-foreground">%</span>}
            </div>
          </div>
        </div>
        <div className="text-sm">
          {asset.status === "up" ? (
            <div className="text-muted-foreground">Online</div>
          ) : asset.status === "warning" || asset.status === "down" ? (
            <>
              <div className="text-muted-foreground">Última vez online</div>
              <div>{asset.status_since ? relativeTime(asset.status_since) : "Nunca"}</div>
            </>
          ) : (
            <>
              <div className="text-muted-foreground">Último check</div>
              <div>{asset.last_check_at ? relativeTime(asset.last_check_at) : "Nunca"}</div>
            </>
          )}
        </div>
      </div>

      {assetId && <HistorySection assetId={assetId} />}
      {assetId && <PhotosSection ref={photosRef} assetId={assetId} canManage={canManage} />}
      {assetId && <BackupSection assetId={assetId} canManage={canManage} backupNotes={asset.backup_notes} />}
      {assetId && (
        <CredentialsSection
          assetId={assetId}
          canManage={canManage}
          username={asset.credential_username}
          password={asset.credential_password}
          hasCredentials={asset.has_credentials}
        />
      )}
      {assetId && <MonitoringSection ref={monitoringRef} assetId={assetId} canManage={canManage} />}
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

      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      )}
      {isError && <p className="text-sm text-destructive">Não foi possível carregar o histórico.</p>}
      {!isError && data?.length === 0 && <EmptyState title="Nenhuma checagem registrada ainda." />}

      {data && data.length > 0 && (
        <Table>
          <TableHeader>
            <tr>
              <TableHead>Status</TableHead>
              <TableHead>RTT</TableHead>
              <TableHead>Perda</TableHead>
              <TableHead>Mensagem</TableHead>
              <TableHead>Quando</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {data.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>
                  <StatusBadge status={entry.status} />
                </TableCell>
                <TableCell className="font-mono text-xs">{entry.latency_ms != null ? `${entry.latency_ms} ms` : "—"}</TableCell>
                <TableCell className="font-mono text-xs">{entry.packet_loss != null ? `${entry.packet_loss}%` : "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{entry.message ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{relativeTime(entry.checked_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

interface PhotosSectionHandle {
  openUpload: () => void;
}

const PhotosSection = forwardRef<PhotosSectionHandle, { assetId: string; canManage: boolean }>(
  function PhotosSection({ assetId, canManage }, ref) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({
    openUpload: () => fileInputRef.current?.click(),
  }));
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
      {!photosQuery.isError && photos.length === 0 && <EmptyState icon={ImageOff} title="Nenhuma foto ainda." />}

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {photos.map((photo) => (
            <div key={photo.id} className="space-y-1">
              <button type="button" onClick={() => setLightboxPhoto(photo)} className="block w-full">
                <img
                  src={photo.thumbnail_url}
                  alt={photo.caption ?? photo.filename}
                  className={`aspect-square w-full rounded-lg border object-cover transition-opacity hover:opacity-90 ${
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
  },
);

function BackupSection({
  assetId,
  canManage,
  backupNotes,
}: {
  assetId: string;
  canManage: boolean;
  backupNotes: string | null;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<AssetPhotoOut | null>(null);

  const [editingText, setEditingText] = useState(false);
  const [textValue, setTextValue] = useState(backupNotes ?? "");
  const [savingText, setSavingText] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);

  const photosQuery = useQuery({
    queryKey: ["asset-photos", assetId, "backup"],
    queryFn: () => apiFetch<AssetPhotoOut[]>(`/assets/${assetId}/photos?category=backup`),
  });

  async function refreshPhotos() {
    await queryClient.invalidateQueries({ queryKey: ["asset-photos", assetId, "backup"] });
  }

  function startEditText() {
    setTextValue(backupNotes ?? "");
    setTextError(null);
    setEditingText(true);
  }

  async function handleSaveText(event: FormEvent) {
    event.preventDefault();
    setSavingText(true);
    setTextError(null);
    try {
      await apiFetch(`/assets/${assetId}`, {
        method: "PATCH",
        body: JSON.stringify({ backup_notes: textValue.trim() || null }),
      });
      await queryClient.invalidateQueries({ queryKey: ["asset", assetId] });
      setEditingText(false);
    } catch (err) {
      setTextError(err instanceof ApiError ? err.message : "Não foi possível salvar as informações de backup.");
    } finally {
      setSavingText(false);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPhotoError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", "backup");
      await apiFetch(`/assets/${assetId}/photos`, { method: "POST", body: formData });
      await refreshPhotos();
    } catch (err) {
      setPhotoError(err instanceof ApiError ? err.message : "Não foi possível enviar a foto.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDeletePhoto(photo: AssetPhotoOut) {
    if (!window.confirm("Remover esta foto de backup?")) return;
    setPhotoError(null);
    try {
      await apiFetch(`/assets/${assetId}/photos/${photo.id}`, { method: "DELETE" });
      if (lightboxPhoto?.id === photo.id) setLightboxPhoto(null);
      await refreshPhotos();
    } catch (err) {
      setPhotoError(err instanceof ApiError ? err.message : "Não foi possível remover a foto.");
    }
  }

  const photos = photosQuery.data ?? [];

  return (
    <div id="backup-section" className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Backup</h2>
        {canManage && !editingText && (
          <button type="button" onClick={startEditText} className="text-xs text-muted-foreground hover:underline">
            {backupNotes ? "Editar" : "Adicionar informações"}
          </button>
        )}
      </div>

      {editingText ? (
        <form onSubmit={handleSaveText} className="space-y-2">
          <Textarea
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            rows={4}
            placeholder="Local do backup, procedimento de restauração, retenção..."
          />
          {textError && <p className="text-sm text-destructive">{textError}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={savingText}>
              {savingText ? "Salvando..." : "Salvar"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setEditingText(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
          {backupNotes || "Nenhuma informação de backup registrada."}
        </p>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Fotos do backup</span>
        {canManage && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="hidden"
              id="backup-photo-upload-input"
            />
            <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? "Enviando..." : "Adicionar foto"}
            </Button>
          </>
        )}
      </div>

      {photoError && <p className="text-sm text-destructive">{photoError}</p>}
      {photosQuery.isError && <p className="text-sm text-destructive">Não foi possível carregar as fotos.</p>}
      {!photosQuery.isError && photos.length === 0 && <EmptyState icon={ImageOff} title="Nenhuma foto de backup ainda." />}

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {photos.map((photo) => (
            <div key={photo.id} className="space-y-1">
              <button type="button" onClick={() => setLightboxPhoto(photo)} className="block w-full">
                <img
                  src={photo.thumbnail_url}
                  alt={photo.caption ?? photo.filename}
                  className="aspect-square w-full rounded-lg border border-border object-cover transition-opacity hover:opacity-90"
                />
              </button>
              {photo.caption && <div className="truncate text-xs text-muted-foreground">{photo.caption}</div>}
              {canManage && (
                <button
                  type="button"
                  onClick={() => handleDeletePhoto(photo)}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  Excluir
                </button>
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

function CredentialsSection({
  assetId,
  canManage,
  username,
  password,
  hasCredentials,
}: {
  assetId: string;
  canManage: boolean;
  username: string | null;
  password: string | null;
  hasCredentials: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [usernameValue, setUsernameValue] = useState("");
  const [passwordValue, setPasswordValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copiedField, setCopiedField] = useState<"user" | "pass" | null>(null);

  function startEdit() {
    setUsernameValue(username ?? "");
    setPasswordValue("");
    setError(null);
    setEditing(true);
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, string | null> = {
        credential_username: usernameValue.trim() || null,
      };
      // Campo em branco = mantém a senha atual; só troca quando o usuário digita algo novo.
      if (passwordValue) payload.credential_password = passwordValue;
      await apiFetch(`/assets/${assetId}`, { method: "PATCH", body: JSON.stringify(payload) });
      await queryClient.invalidateQueries({ queryKey: ["asset", assetId] });
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar as credenciais.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!window.confirm("Remover as credenciais de acesso deste ativo?")) return;
    setError(null);
    try {
      await apiFetch(`/assets/${assetId}`, {
        method: "PATCH",
        body: JSON.stringify({ credential_username: null, credential_password: null }),
      });
      await queryClient.invalidateQueries({ queryKey: ["asset", assetId] });
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível remover as credenciais.");
    }
  }

  async function handleCopy(value: string, field: "user" | "pass") {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      // clipboard indisponível (ex.: contexto sem permissão) — ignorar silenciosamente
    }
  }

  return (
    <div id="credentials-section" className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Credenciais de acesso</h2>
        {canManage && !editing && (
          <button type="button" onClick={startEdit} className="text-xs text-muted-foreground hover:underline">
            {hasCredentials ? "Editar" : "Adicionar credenciais"}
          </button>
        )}
      </div>

      {editing ? (
        <form onSubmit={handleSave} className="max-w-sm space-y-3">
          <div className="space-y-1">
            <label htmlFor="cred-username" className="text-sm">
              Usuário
            </label>
            <Input id="cred-username" value={usernameValue} onChange={(e) => setUsernameValue(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label htmlFor="cred-password" className="text-sm">
              Senha
            </label>
            <Input
              id="cred-password"
              type="password"
              value={passwordValue}
              onChange={(e) => setPasswordValue(e.target.value)}
              placeholder={hasCredentials ? "Deixe em branco para manter a atual" : ""}
              autoComplete="new-password"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            {hasCredentials && (
              <Button type="button" variant="outline" size="sm" onClick={handleRemove}>
                Remover credenciais
              </Button>
            )}
          </div>
        </form>
      ) : !hasCredentials ? (
        <p className="text-sm text-muted-foreground">Nenhuma credencial registrada.</p>
      ) : (
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Usuário</dt>
            <dd className="flex items-center gap-1.5 font-mono text-xs">
              {username ?? "—"}
              {username && (
                <button
                  type="button"
                  onClick={() => handleCopy(username, "user")}
                  className="text-muted-foreground hover:text-foreground"
                  title="Copiar usuário"
                >
                  {copiedField === "user" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </button>
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Senha</dt>
            <dd className="flex items-center gap-1.5 font-mono text-xs">
              {!canManage ? (
                <span className="text-muted-foreground">Restrito ao seu papel</span>
              ) : password ? (
                <>
                  {revealed ? password : "••••••••"}
                  <button
                    type="button"
                    onClick={() => setRevealed((v) => !v)}
                    className="text-muted-foreground hover:text-foreground"
                    title={revealed ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopy(password, "pass")}
                    className="text-muted-foreground hover:text-foreground"
                    title="Copiar senha"
                  >
                    {copiedField === "pass" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </button>
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

interface MonitoringSectionHandle {
  startEditing: () => void;
}

const MonitoringSection = forwardRef<MonitoringSectionHandle, { assetId: string; canManage: boolean }>(
  function MonitoringSection({ assetId, canManage }, ref) {
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

  useImperativeHandle(ref, () => ({
    startEditing: startEdit,
  }));

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
              <Input
                id="check-interval"
                type="number"
                min={10}
                max={3600}
                value={intervalSeconds}
                onChange={(e) => setIntervalSeconds(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="check-timeout" className="text-sm">
                Timeout (s)
              </label>
              <Input
                id="check-timeout"
                type="number"
                min={1}
                max={60}
                value={timeoutSeconds}
                onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="check-packets" className="text-sm">
                Pacotes
              </label>
              <Input
                id="check-packets"
                type="number"
                min={1}
                max={10}
                value={packets}
                onChange={(e) => setPackets(Number(e.target.value))}
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
  },
);
