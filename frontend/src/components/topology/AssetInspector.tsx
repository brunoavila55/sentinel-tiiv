import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Check,
  ChevronRight,
  Copy,
  Crosshair,
  ExternalLink,
  Eye,
  EyeOff,
  GitBranch,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { buttonVariants } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { AssetOut, AssetPhotoOut, AssetStatus } from "@/lib/types";

const CHECKMK_STATUS_BANNER: Record<AssetStatus, { text: string; bg: string }> = {
  up: { text: "HOST UP • ONLINE", bg: "bg-emerald-600 text-white" },
  warning: { text: "HOST WARNING • LATÊNCIA ALTA", bg: "bg-amber-500 text-white" },
  down: { text: "HOST DOWN • CRITICAL", bg: "bg-red-600 text-white" },
  unknown: { text: "HOST UNKNOWN • SEM DADOS", bg: "bg-slate-600 text-white" },
};

export function AssetInspector({
  assetId,
  onClose,
  onSelectAsset,
  onFocusAsset,
}: {
  assetId: string;
  onClose: () => void;
  onSelectAsset?: (id: string) => void;
  onFocusAsset?: (id: string) => void;
}) {
  const { currentMembership } = useAuth();
  const canRevealCredentials =
    currentMembership?.role === "owner" || currentMembership?.role === "admin" || currentMembership?.role === "operator";

  const assetQuery = useQuery({
    queryKey: ["asset", assetId],
    queryFn: () => apiFetch<AssetOut>(`/assets/${assetId}`),
  });
  const photosQuery = useQuery({
    queryKey: ["asset-photos", assetId],
    queryFn: () => apiFetch<AssetPhotoOut[]>(`/assets/${assetId}/photos`),
  });
  const backupPhotosQuery = useQuery({
    queryKey: ["asset-photos", assetId, "backup"],
    queryFn: () => apiFetch<AssetPhotoOut[]>(`/assets/${assetId}/photos?category=backup`),
  });

  const parentQuery = useQuery({
    queryKey: ["asset", assetQuery.data?.parent_asset_id],
    queryFn: () =>
      assetQuery.data?.parent_asset_id ? apiFetch<AssetOut>(`/assets/${assetQuery.data.parent_asset_id}`) : null,
    enabled: Boolean(assetQuery.data?.parent_asset_id),
  });

  const [copied, setCopied] = useState(false);
  const [lightboxPhoto, setLightboxPhoto] = useState<AssetPhotoOut | null>(null);
  const [backupTextExpanded, setBackupTextExpanded] = useState(false);
  const [passwordRevealed, setPasswordRevealed] = useState(false);
  const [copiedCredential, setCopiedCredential] = useState<"user" | "pass" | null>(null);

  const asset = assetQuery.data;
  const mainPhoto = photosQuery.data?.[0];
  const backupPhotos = backupPhotosQuery.data ?? [];
  const hasBackupInfo = Boolean(asset?.backup_notes) || backupPhotos.length > 0;
  const address = asset?.ip_address ?? asset?.hostname ?? null;

  const handleCopyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard indisponível
    }
  };

  const handleCopyCredential = async (value: string, field: "user" | "pass") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedCredential(field);
      setTimeout(() => setCopiedCredential(null), 1500);
    } catch {
      // clipboard indisponível
    }
  };

  const banner = asset ? CHECKMK_STATUS_BANNER[asset.status] : CHECKMK_STATUS_BANNER.unknown;

  return (
    <aside className="flex h-full w-84 shrink-0 flex-col border-l border-border bg-card shadow-lg">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <Activity className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold tracking-tight">Painel de Dispositivo</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          ✕
        </button>
      </div>

      {assetQuery.isLoading && <p className="p-4 text-sm text-muted-foreground">Carregando...</p>}
      {assetQuery.isError && <p className="p-4 text-sm text-destructive">Não foi possível carregar o ativo.</p>}

      {asset && (
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {/* Banner de Estado Checkmk */}
          <div
            className={`flex items-center justify-between rounded-md px-3 py-1.5 text-xs font-bold shadow-sm ${banner.bg}`}
          >
            <span>{banner.text}</span>
            <span className="text-[10px] font-normal opacity-90">Checkmk Engine</span>
          </div>

          {mainPhoto && (
            <img
              src={mainPhoto.url}
              alt={mainPhoto.caption ?? asset.name}
              className="aspect-video w-full rounded-lg border border-border object-cover"
            />
          )}

          <div>
            <h2 className="text-base font-bold leading-tight tracking-tight">{asset.name}</h2>
            <p className="font-mono text-xs text-muted-foreground">{address ?? "Sem endereço configurado"}</p>
          </div>

          {/* Ações Rápidas */}
          <div className="grid grid-cols-2 gap-2">
            {onFocusAsset && (
              <button
                type="button"
                onClick={() => onFocusAsset(asset.id)}
                className="flex items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-xs font-medium hover:border-primary hover:text-primary"
              >
                <Crosshair className="h-3.5 w-3.5" />
                <span>Centralizar</span>
              </button>
            )}
            {address && (
              <button
                type="button"
                onClick={handleCopyAddress}
                className="flex items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-xs font-medium hover:border-primary hover:text-primary"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? "Copiado!" : "Copiar IP"}</span>
              </button>
            )}
          </div>

          {/* Métricas de Desempenho e Saúde */}
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Métricas ICMP</span>

            {/* Barra de Latência */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Latência RTT:</span>
                <span className="font-mono font-semibold">
                  {asset.last_rtt_ms != null ? `${asset.last_rtt_ms} ms` : "—"}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                <div
                  className={`h-full ${
                    (asset.last_rtt_ms ?? 0) > 100
                      ? "bg-red-500"
                      : (asset.last_rtt_ms ?? 0) > 40
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                  }`}
                  style={{
                    width: `${Math.min(100, ((asset.last_rtt_ms ?? 0) / 200) * 100)}%`,
                  }}
                />
              </div>
            </div>

            {/* Barra de Perda de Pacotes */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Perda de Pacotes:</span>
                <span className="font-mono font-semibold">
                  {asset.packet_loss != null ? `${asset.packet_loss}%` : "—"}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                <div
                  className={`h-full ${(asset.packet_loss ?? 0) > 0 ? "bg-red-500" : "bg-emerald-500"}`}
                  style={{ width: `${Math.min(100, asset.packet_loss ?? 0)}%` }}
                />
              </div>
            </div>

            <div className="flex justify-between border-t border-border/60 pt-2 text-[11px]">
              <span className="text-muted-foreground">Última checagem:</span>
              <span className="text-foreground">
                {asset.last_check_at ? new Date(asset.last_check_at).toLocaleTimeString("pt-BR") : "Nunca"}
              </span>
            </div>
          </div>

          {/* Dispositivo Pai na Hierarquia */}
          {parentQuery.data && (
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <GitBranch className="h-3.5 w-3.5 text-primary" />
                <span>Dispositivo Pai (Upstream)</span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold leading-tight">{parentQuery.data.name}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {parentQuery.data.ip_address ?? parentQuery.data.hostname ?? "—"}
                  </p>
                </div>
                {onSelectAsset && (
                  <button
                    type="button"
                    onClick={() => {
                      if (parentQuery.data) onSelectAsset(parentQuery.data.id);
                    }}
                    className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-medium hover:bg-muted"
                  >
                    <span>Ir ao Pai</span>
                    <ChevronRight className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {asset.description && (
            <p className="line-clamp-3 border-t border-border pt-3 text-xs text-muted-foreground">
              {asset.description}
            </p>
          )}

          {/* Backup Notes & Fotos */}
          {hasBackupInfo && (
            <div className="space-y-2 border-t border-border pt-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Procedimento de Backup</span>
              </div>
              {asset.backup_notes && (
                <div className="space-y-1">
                  <p className={`whitespace-pre-wrap text-xs ${backupTextExpanded ? "" : "line-clamp-3"}`}>
                    {asset.backup_notes}
                  </p>
                  {asset.backup_notes.length > 160 && (
                    <button
                      type="button"
                      onClick={() => setBackupTextExpanded((v) => !v)}
                      className="text-xs text-primary hover:underline"
                    >
                      {backupTextExpanded ? "Ver menos" : "Ver mais"}
                    </button>
                  )}
                </div>
              )}
              {backupPhotos.length > 0 && (
                <div className="grid grid-cols-4 gap-1.5">
                  {backupPhotos.slice(0, 4).map((photo) => (
                    <button key={photo.id} type="button" onClick={() => setLightboxPhoto(photo)} className="block">
                      <img
                        src={photo.thumbnail_url}
                        alt={photo.caption ?? photo.filename}
                        className="aspect-square w-full rounded-md border border-border object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Credenciais de Acesso */}
          {asset.has_credentials && (
            <div className="space-y-2 border-t border-border pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Credenciais de Acesso
              </h3>
              <dl className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Usuário</dt>
                  <dd className="flex items-center gap-1.5 font-mono text-xs">
                    {asset.credential_username ?? "—"}
                    {asset.credential_username && (
                      <button
                        type="button"
                        onClick={() => handleCopyCredential(asset.credential_username as string, "user")}
                        className="text-muted-foreground hover:text-foreground"
                        title="Copiar usuário"
                      >
                        {copiedCredential === "user" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      </button>
                    )}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Senha</dt>
                  <dd className="flex items-center gap-1.5 font-mono text-xs">
                    {!canRevealCredentials ? (
                      <span className="text-muted-foreground">Restrito</span>
                    ) : asset.credential_password ? (
                      <>
                        {passwordRevealed ? asset.credential_password : "••••••••"}
                        <button
                          type="button"
                          onClick={() => setPasswordRevealed((v) => !v)}
                          className="text-muted-foreground hover:text-foreground"
                          title={passwordRevealed ? "Ocultar senha" : "Mostrar senha"}
                        >
                          {passwordRevealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopyCredential(asset.credential_password as string, "pass")}
                          className="text-muted-foreground hover:text-foreground"
                          title="Copiar senha"
                        >
                          {copiedCredential === "pass" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        </button>
                      </>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          <Link
            to={`/assets/${asset.id}`}
            className={buttonVariants({ size: "sm", className: "w-full flex items-center justify-center gap-1.5" })}
          >
            <span>Ver Registro Completo</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {lightboxPhoto && (
        <button
          type="button"
          aria-label="Fechar imagem ampliada"
          onClick={() => setLightboxPhoto(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
        >
          <img
            src={lightboxPhoto.url}
            alt={lightboxPhoto.caption ?? lightboxPhoto.filename}
            className="max-h-full max-w-full rounded-md object-contain"
          />
        </button>
      )}
    </aside>
  );
}
