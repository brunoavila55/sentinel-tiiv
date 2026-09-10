import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { OrganizationOut } from "@/lib/types";

export function OrganizationSettingsPage() {
  const { currentOrganizationId, currentMembership } = useAuth();
  const queryClient = useQueryClient();
  const canManage = currentMembership?.role === "owner";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["organization", currentOrganizationId],
    queryFn: () => apiFetch<OrganizationOut>("/organizations/current"),
    enabled: Boolean(currentOrganizationId),
  });

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setName(data.name);
  }, [data]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await apiFetch<OrganizationOut>("/organizations/current", {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      await queryClient.invalidateQueries({ queryKey: ["organization", currentOrganizationId] });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="max-w-xl space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (isError || !data) return <p className="text-sm text-destructive">Não foi possível carregar a organização.</p>;

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Organização</h1>
        <p className="font-mono text-sm text-muted-foreground">{data.slug}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="org-name" className="text-sm font-medium">
            Nome
          </label>
          <Input id="org-name" value={name} disabled={!canManage} onChange={(e) => setName(e.target.value)} />
          {!canManage && (
            <p className="text-xs text-muted-foreground">Somente o owner pode editar o nome da organização.</p>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-border pt-4 text-sm">
          <span className="text-muted-foreground">Plano atual</span>
          <span className="font-mono uppercase">{data.plan}</span>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {saved && <p className="text-sm text-muted-foreground">Salvo.</p>}

        {canManage && (
          <Button type="submit" disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        )}
      </form>

      <div className="space-y-4 border-t border-border pt-6">
        <div>
          <h2 className="text-sm font-medium">Identidade visual</h2>
          <p className="text-xs text-muted-foreground">
            Exibidos na barra lateral e na aba do navegador.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <BrandingImageField
            label="Logo (modo claro)"
            hint="Usada quando o tema do navegador é claro. PNG, JPEG ou WebP."
            imageUrl={data.logo_light_url}
            canManage={canManage}
            uploadPath="/organizations/current/logo-light"
            deletePath="/organizations/current/logo-light"
            imageClassName="h-16 w-16 rounded-md object-contain"
            previewClassName="bg-muted/40"
          />
          <BrandingImageField
            label="Logo (modo escuro)"
            hint="Usada quando o tema do navegador é escuro. PNG, JPEG ou WebP."
            imageUrl={data.logo_dark_url}
            canManage={canManage}
            uploadPath="/organizations/current/logo-dark"
            deletePath="/organizations/current/logo-dark"
            imageClassName="h-16 w-16 rounded-md object-contain"
            previewClassName="bg-[#121314]"
          />
          <BrandingImageField
            label="Favicon"
            hint="Ícone quadrado, de preferência 64×64."
            imageUrl={data.favicon_url}
            canManage={canManage}
            uploadPath="/organizations/current/favicon"
            deletePath="/organizations/current/favicon"
            imageClassName="h-10 w-10 rounded-md object-contain"
            previewClassName="bg-muted/40"
          />
        </div>
      </div>
    </div>
  );
}

function BrandingImageField({
  label,
  hint,
  imageUrl,
  canManage,
  uploadPath,
  deletePath,
  imageClassName,
  previewClassName,
}: {
  label: string;
  hint: string;
  imageUrl: string | null;
  canManage: boolean;
  uploadPath: string;
  deletePath: string;
  imageClassName: string;
  previewClassName: string;
}) {
  const { currentOrganizationId } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["organization", currentOrganizationId] });
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await apiFetch(uploadPath, { method: "POST", body: formData });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível enviar a imagem.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setError(null);
    setBusy(true);
    try {
      await apiFetch(deletePath, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível remover a imagem.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-border ${previewClassName}`}
        >
          {imageUrl ? (
            <img src={imageUrl} alt={label} className={imageClassName} />
          ) : (
            <span className="text-[10px] text-muted-foreground">Sem imagem</span>
          )}
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>

      {canManage && (
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            {busy ? "Enviando..." : imageUrl ? "Trocar" : "Enviar"}
          </Button>
          {imageUrl && (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void handleRemove()}>
              Remover
            </Button>
          )}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
