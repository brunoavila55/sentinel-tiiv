import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { StatusPill } from "@/components/StatusBadge";
import { buttonVariants } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { AssetOut, AssetPhotoOut } from "@/lib/types";

export function AssetInspector({ assetId, onClose }: { assetId: string; onClose: () => void }) {
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
      // clipboard indisponível (ex.: contexto sem permissão) — ignorar silenciosamente
    }
  };

  const handleCopyCredential = async (value: string, field: "user" | "pass") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedCredential(field);
      setTimeout(() => setCopiedCredential(null), 1500);
    } catch {
      // clipboard indisponível (ex.: contexto sem permissão) — ignorar silenciosamente
    }
  };

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-sm font-medium">Detalhes</span>
        <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">
          Fechar
        </button>
      </div>

      {assetQuery.isLoading && <p className="p-4 text-sm text-muted-foreground">Carregando...</p>}

      {assetQuery.isError && <p className="p-4 text-sm text-destructive">Não foi possível carregar o ativo.</p>}

      {asset && (
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {mainPhoto && (
            <img
              src={mainPhoto.url}
              alt={mainPhoto.caption ?? asset.name}
              className="aspect-video w-full rounded-lg border border-border object-cover"
            />
          )}

          <div className="space-y-1">
            <h2 className="text-base font-semibold">{asset.name}</h2>
            <StatusPill status={asset.status} />
          </div>

          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">IP / Hostname</dt>
              <dd className="flex items-center gap-1.5 font-mono text-xs">
                {address ?? "—"}
                {address && (
                  <button
                    type="button"
                    onClick={handleCopyAddress}
                    className="text-muted-foreground hover:text-foreground"
                    title="Copiar endereço"
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </button>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Site</dt>
              <dd>{asset.site_name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">RTT</dt>
              <dd className="font-mono text-xs">{asset.last_rtt_ms != null ? `${asset.last_rtt_ms} ms` : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Packet loss</dt>
              <dd className="font-mono text-xs">{asset.packet_loss != null ? `${asset.packet_loss}%` : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Última checagem</dt>
              <dd className="text-xs">
                {asset.last_check_at ? new Date(asset.last_check_at).toLocaleString("pt-BR") : "Nunca"}
              </dd>
            </div>
          </dl>

          {asset.description && (
            <p className="line-clamp-3 border-t border-border pt-3 text-sm text-muted-foreground">
              {asset.description}
            </p>
          )}

          {hasBackupInfo && (
            <div className="space-y-2 border-t border-border pt-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Backup</h3>
              {asset.backup_notes && (
                <div className="space-y-1">
                  <p
                    className={`whitespace-pre-wrap text-sm ${backupTextExpanded ? "" : "line-clamp-3"}`}
                  >
                    {asset.backup_notes}
                  </p>
                  {asset.backup_notes.length > 160 && (
                    <button
                      type="button"
                      onClick={() => setBackupTextExpanded((v) => !v)}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      {backupTextExpanded ? "Ver menos" : "Ver mais"}
                    </button>
                  )}
                </div>
              )}
              {backupPhotos.length > 0 && (
                <div className="grid grid-cols-4 gap-1.5">
                  {backupPhotos.slice(0, 4).map((photo) => (
                    <button
                      key={photo.id}
                      type="button"
                      onClick={() => setLightboxPhoto(photo)}
                      className="block"
                    >
                      <img
                        src={photo.thumbnail_url}
                        alt={photo.caption ?? photo.filename}
                        className="aspect-square w-full rounded-lg border border-border object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {asset.has_credentials && (
            <div className="space-y-2 border-t border-border pt-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Credenciais de acesso
              </h3>
              <dl className="space-y-1.5 text-sm">
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
                      <span className="text-muted-foreground">Restrito ao seu papel</span>
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

          <Link to={`/assets/${asset.id}`} className={buttonVariants({ size: "sm", className: "w-full" })}>
            Ver ativo
          </Link>
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
    </aside>
  );
}
