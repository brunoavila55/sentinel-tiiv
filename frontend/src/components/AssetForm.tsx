import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import type { AssetListResponse, SiteOut } from "@/lib/types";

export interface AssetFormValues {
  name: string;
  site_id: string;
  hostname: string;
  ip_address: string;
  description: string;
  enabled: boolean;
  parent_asset_id: string;
}

export const emptyAssetForm: AssetFormValues = {
  name: "",
  site_id: "",
  hostname: "",
  ip_address: "",
  description: "",
  enabled: true,
  parent_asset_id: "",
};

const fieldClass =
  "rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring";

export function AssetForm({
  title,
  sites,
  initialValues,
  onSubmit,
  onCancel,
  submitting,
  submitLabel,
  excludeAssetId,
}: {
  title: string;
  sites: SiteOut[];
  initialValues: AssetFormValues;
  onSubmit: (values: AssetFormValues) => Promise<void>;
  onCancel: () => void;
  submitting: boolean;
  submitLabel: string;
  /** Ao editar, o próprio ativo não pode aparecer como opção de pai. */
  excludeAssetId?: string;
}) {
  const [form, setForm] = useState<AssetFormValues>(initialValues);
  const [error, setError] = useState<string | null>(null);

  const parentOptionsQuery = useQuery({
    queryKey: ["assets", "__parent_options", form.site_id],
    queryFn: () => apiFetch<AssetListResponse>(`/assets?site_id=${form.site_id}&limit=200`),
    enabled: Boolean(form.site_id),
  });
  const parentOptions = (parentOptionsQuery.data?.items ?? []).filter((a) => a.id !== excludeAssetId);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!form.hostname.trim() && !form.ip_address.trim()) {
      setError("Informe pelo menos um: hostname ou IP.");
      return;
    }
    try {
      await onSubmit(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar o ativo.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-3 rounded-md border border-border p-4">
      <h2 className="text-sm font-medium">{title}</h2>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="asset-name" className="text-sm">
            Nome
          </label>
          <input
            id="asset-name"
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={`${fieldClass} w-full`}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="asset-site" className="text-sm">
            Site
          </label>
          <select
            id="asset-site"
            required
            value={form.site_id}
            onChange={(e) => setForm((f) => ({ ...f, site_id: e.target.value, parent_asset_id: "" }))}
            className={`${fieldClass} w-full`}
          >
            <option value="" disabled>
              Selecione
            </option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="asset-parent" className="text-sm">
            Ativo pai
          </label>
          <select
            id="asset-parent"
            value={form.parent_asset_id}
            onChange={(e) => setForm((f) => ({ ...f, parent_asset_id: e.target.value }))}
            className={`${fieldClass} w-full`}
            disabled={!form.site_id}
          >
            <option value="">Nenhum (raiz da topologia)</option>
            {parentOptions.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="asset-hostname" className="text-sm">
            Hostname
          </label>
          <input
            id="asset-hostname"
            value={form.hostname}
            onChange={(e) => setForm((f) => ({ ...f, hostname: e.target.value }))}
            className={`${fieldClass} w-full`}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="asset-ip" className="text-sm">
            Endereço IP
          </label>
          <input
            id="asset-ip"
            value={form.ip_address}
            onChange={(e) => setForm((f) => ({ ...f, ip_address: e.target.value }))}
            className={`${fieldClass} w-full`}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Informe pelo menos um: hostname ou IP.</p>

      <div className="space-y-1">
        <label htmlFor="asset-description" className="text-sm">
          Descrição
        </label>
        <textarea
          id="asset-description"
          rows={2}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          className={`${fieldClass} w-full`}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
        />
        Habilitado
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting} size="sm">
          {submitting ? "Salvando..." : submitLabel}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
