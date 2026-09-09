import { useQuery } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { StatusBadge } from "@/components/StatusBadge";
import { buttonVariants } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import type { AssetOut, AssetPhotoOut } from "@/lib/types";

export function AssetInspector({ assetId, onClose }: { assetId: string; onClose: () => void }) {
  const assetQuery = useQuery({
    queryKey: ["asset", assetId],
    queryFn: () => apiFetch<AssetOut>(`/assets/${assetId}`),
  });
  const photosQuery = useQuery({
    queryKey: ["asset-photos", assetId],
    queryFn: () => apiFetch<AssetPhotoOut[]>(`/assets/${assetId}/photos`),
  });
  const [copied, setCopied] = useState(false);

  const asset = assetQuery.data;
  const mainPhoto = photosQuery.data?.[0];
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
              className="aspect-video w-full rounded-md border border-border object-cover"
            />
          )}

          <div>
            <h2 className="text-base font-semibold">{asset.name}</h2>
            <StatusBadge status={asset.status} className="mt-1 text-sm" />
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

          <Link to={`/assets/${asset.id}`} className={buttonVariants({ size: "sm", className: "w-full" })}>
            Ver ativo
          </Link>
        </div>
      )}
    </aside>
  );
}
