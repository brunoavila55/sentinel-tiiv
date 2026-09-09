import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { SiteOut } from "@/lib/types";

const fieldClass =
  "w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring";

interface SiteFormState {
  name: string;
  description: string;
  address: string;
}

const emptyForm: SiteFormState = { name: "", description: "", address: "" };

export function SitesPage() {
  const { currentOrganizationId, currentMembership } = useAuth();
  const queryClient = useQueryClient();
  const canManage = currentMembership?.role === "owner" || currentMembership?.role === "admin";

  const [search, setSearch] = useState("");
  const [editingSite, setEditingSite] = useState<SiteOut | null>(null);
  const [form, setForm] = useState<SiteFormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const sitesQuery = useQuery({
    queryKey: ["sites", currentOrganizationId, search],
    queryFn: () => {
      const qs = search ? `?search=${encodeURIComponent(search)}` : "";
      return apiFetch<SiteOut[]>(`/sites${qs}`);
    },
    enabled: Boolean(currentOrganizationId),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["sites", currentOrganizationId] });
  }

  function startEdit(site: SiteOut) {
    setEditingSite(site);
    setForm({ name: site.name, description: site.description ?? "", address: site.address ?? "" });
    setError(null);
  }

  function cancelEdit() {
    setEditingSite(null);
    setForm(emptyForm);
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        description: form.description || null,
        address: form.address || null,
      };
      if (editingSite) {
        await apiFetch(`/sites/${editingSite.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await apiFetch("/sites", { method: "POST", body: JSON.stringify(payload) });
      }
      cancelEdit();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar o site.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(site: SiteOut) {
    if (!window.confirm(`Remover o site "${site.name}"?`)) return;
    setError(null);
    try {
      await apiFetch(`/sites/${site.id}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível remover o site.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Sites</h1>
        <input
          placeholder="Buscar por nome"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${fieldClass} w-64`}
        />
      </div>

      {canManage && (
        <form onSubmit={handleSubmit} className="max-w-md space-y-3 rounded-md border border-border p-4">
          <h2 className="text-sm font-medium">{editingSite ? `Editar ${editingSite.name}` : "Novo site"}</h2>

          <div className="space-y-1">
            <label htmlFor="site-name" className="text-sm">
              Nome
            </label>
            <input
              id="site-name"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className={fieldClass}
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="site-address" className="text-sm">
              Endereço
            </label>
            <input
              id="site-address"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              className={fieldClass}
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="site-description" className="text-sm">
              Descrição
            </label>
            <textarea
              id="site-description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className={fieldClass}
              rows={2}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" disabled={saving} size="sm">
              {saving ? "Salvando..." : editingSite ? "Salvar" : "Criar site"}
            </Button>
            {editingSite && (
              <Button type="button" variant="outline" size="sm" onClick={cancelEdit}>
                Cancelar
              </Button>
            )}
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Nome</th>
              <th className="px-3 py-2 font-medium">Endereço</th>
              <th className="px-3 py-2 font-medium">Ativos</th>
              {canManage && <th className="px-3 py-2 font-medium">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {sitesQuery.isLoading && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            )}
            {sitesQuery.isError && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-destructive">
                  Não foi possível carregar os sites.
                </td>
              </tr>
            )}
            {sitesQuery.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-muted-foreground">
                  Nenhum site cadastrado. {canManage && "Crie o primeiro site para começar."}
                </td>
              </tr>
            )}
            {sitesQuery.data?.map((site) => (
              <tr key={site.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  <div>{site.name}</div>
                  {site.description && <div className="text-xs text-muted-foreground">{site.description}</div>}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{site.address ?? "—"}</td>
                <td className="px-3 py-2 font-mono">{site.asset_count}</td>
                {canManage && (
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => startEdit(site)}>
                        Editar
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleDelete(site)}>
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
    </div>
  );
}
