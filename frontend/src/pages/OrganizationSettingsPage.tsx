import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
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

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando organização...</p>;
  if (isError || !data) return <p className="text-sm text-destructive">Não foi possível carregar a organização.</p>;

  return (
    <div className="max-w-md space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Organização</h1>
        <p className="text-sm text-muted-foreground">{data.slug}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="org-name" className="text-sm font-medium">
            Nome
          </label>
          <input
            id="org-name"
            value={name}
            disabled={!canManage}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          />
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
    </div>
  );
}
