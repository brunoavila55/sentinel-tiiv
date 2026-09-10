import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { SiteOut } from "@/lib/types";

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
  const [showForm, setShowForm] = useState(false);
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

  function startCreate() {
    setEditingSite(null);
    setForm(emptyForm);
    setError(null);
    setShowForm(true);
  }

  function startEdit(site: SiteOut) {
    setEditingSite(site);
    setForm({ name: site.name, description: site.description ?? "", address: site.address ?? "" });
    setError(null);
    setShowForm(true);
  }

  function cancelEdit() {
    setEditingSite(null);
    setForm(emptyForm);
    setError(null);
    setShowForm(false);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Sites</h1>
        <div className="flex items-center gap-2">
          <SearchInput placeholder="Buscar por nome" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
          {canManage && !showForm && (
            <Button size="sm" onClick={startCreate}>
              Novo site
            </Button>
          )}
        </div>
      </div>

      {canManage && showForm && (
        <form onSubmit={handleSubmit} className="max-w-md space-y-3 rounded-md border border-border p-4">
          <h2 className="text-sm font-medium">{editingSite ? `Editar ${editingSite.name}` : "Novo site"}</h2>

          <div className="space-y-1">
            <label htmlFor="site-name" className="text-sm">
              Nome
            </label>
            <Input id="site-name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>

          <div className="space-y-1">
            <label htmlFor="site-address" className="text-sm">
              Endereço
            </label>
            <Input id="site-address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          </div>

          <div className="space-y-1">
            <label htmlFor="site-description" className="text-sm">
              Descrição
            </label>
            <Textarea
              id="site-description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" disabled={saving} size="sm">
              {saving ? "Salvando..." : editingSite ? "Salvar" : "Criar site"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={cancelEdit}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {!showForm && error && <p className="text-sm text-destructive">{error}</p>}

      {sitesQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : sitesQuery.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar os sites.</p>
      ) : sitesQuery.data?.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Nenhum site cadastrado."
          description={canManage ? "Crie o primeiro site para começar." : undefined}
        />
      ) : (
        <Table>
          <TableHeader>
            <tr>
              <TableHead>Nome</TableHead>
              <TableHead>Endereço</TableHead>
              <TableHead>Ativos</TableHead>
              {canManage && <TableHead>Ações</TableHead>}
            </tr>
          </TableHeader>
          <TableBody>
            {sitesQuery.data?.map((site) => (
              <TableRow key={site.id}>
                <TableCell>
                  <div>{site.name}</div>
                  {site.description && <div className="text-xs text-muted-foreground">{site.description}</div>}
                </TableCell>
                <TableCell className="text-muted-foreground">{site.address ?? "—"}</TableCell>
                <TableCell className="font-mono">{site.asset_count}</TableCell>
                {canManage && (
                  <TableCell>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => startEdit(site)}>
                        Editar
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleDelete(site)}>
                        Excluir
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
