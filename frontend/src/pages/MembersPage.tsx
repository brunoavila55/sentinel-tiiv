import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { ROLE_LABELS, type InviteOut, type MemberOut, type OrganizationRole } from "@/lib/types";

const ROLE_OPTIONS: OrganizationRole[] = ["owner", "admin", "operator", "viewer"];

function canManageTargetRole(actorRole: OrganizationRole, targetRole: OrganizationRole): boolean {
  if (actorRole === "owner") return true;
  if (actorRole === "admin") return targetRole !== "owner";
  return false;
}

const fieldClass =
  "rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring";

export function MembersPage() {
  const { currentOrganizationId, currentMembership, user } = useAuth();
  const queryClient = useQueryClient();
  const actorRole = currentMembership?.role ?? "viewer";
  const canManageUsers = actorRole === "owner" || actorRole === "admin";

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<OrganizationRole | "">("");
  const [actionError, setActionError] = useState<string | null>(null);

  const membersQuery = useQuery({
    queryKey: ["members", currentOrganizationId, search, roleFilter],
    queryFn: () => {
      const query = new URLSearchParams();
      if (search) query.set("search", search);
      if (roleFilter) query.set("role", roleFilter);
      const qs = query.toString();
      return apiFetch<MemberOut[]>(`/organizations/members${qs ? `?${qs}` : ""}`);
    },
    enabled: Boolean(currentOrganizationId),
  });

  async function refreshMembers() {
    await queryClient.invalidateQueries({ queryKey: ["members", currentOrganizationId] });
  }

  async function handleRoleChange(memberUserId: string, role: OrganizationRole) {
    setActionError(null);
    try {
      await apiFetch(`/organizations/members/${memberUserId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      await refreshMembers();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Não foi possível alterar a role.");
    }
  }

  async function handleRemove(memberUserId: string) {
    if (!window.confirm("Remover este usuário da organização?")) return;
    setActionError(null);
    try {
      await apiFetch(`/organizations/members/${memberUserId}`, { method: "DELETE" });
      await refreshMembers();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Não foi possível remover o usuário.");
    }
  }

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="text-lg font-semibold">Usuários</h1>

        <div className="flex gap-2">
          <input
            placeholder="Buscar por nome ou email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${fieldClass} w-64`}
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as OrganizationRole | "")}
            className={fieldClass}
          >
            <option value="">Todas as roles</option>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        {actionError && <p className="text-sm text-destructive">{actionError}</p>}

        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Nome</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {membersQuery.isLoading && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-muted-foreground">
                    Carregando...
                  </td>
                </tr>
              )}
              {membersQuery.isError && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-destructive">
                    Não foi possível carregar os usuários.
                  </td>
                </tr>
              )}
              {membersQuery.data?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-muted-foreground">
                    Nenhum usuário encontrado.
                  </td>
                </tr>
              )}
              {membersQuery.data?.map((member) => {
                const canManageThis = canManageUsers && canManageTargetRole(actorRole, member.role);
                return (
                  <tr key={member.user_id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      {member.name}
                      {member.user_id === user?.id && (
                        <span className="ml-1 text-xs text-muted-foreground">(você)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{member.email}</td>
                    <td className="px-3 py-2">
                      {canManageThis ? (
                        <select
                          value={member.role}
                          onChange={(e) => handleRoleChange(member.user_id, e.target.value as OrganizationRole)}
                          className={fieldClass}
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r} value={r} disabled={!canManageTargetRole(actorRole, r)}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        ROLE_LABELS[member.role]
                      )}
                    </td>
                    <td className="px-3 py-2">{member.status === "active" ? "Ativo" : "Desabilitado"}</td>
                    <td className="px-3 py-2">
                      {canManageThis && (
                        <Button variant="outline" size="sm" onClick={() => handleRemove(member.user_id)}>
                          Remover
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {canManageUsers && <InvitesSection organizationId={currentOrganizationId} actorRole={actorRole} />}
    </div>
  );
}

function InvitesSection({ organizationId, actorRole }: { organizationId: string | null; actorRole: OrganizationRole }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrganizationRole>("viewer");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);

  const invitesQuery = useQuery({
    queryKey: ["invites", organizationId],
    queryFn: () => apiFetch<InviteOut[]>("/organizations/invites"),
    enabled: Boolean(organizationId),
  });

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setCreating(true);
    setLastInviteUrl(null);
    try {
      const invite = await apiFetch<InviteOut>("/organizations/invites", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      setEmail("");
      setLastInviteUrl(invite.invite_url);
      await queryClient.invalidateQueries({ queryKey: ["invites", organizationId] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível criar o convite.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(inviteId: string) {
    try {
      await apiFetch(`/organizations/invites/${inviteId}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["invites", organizationId] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível revogar o convite.");
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Convites</h2>

      <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="invite-email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${fieldClass} w-64`}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="invite-role" className="text-sm font-medium">
            Role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as OrganizationRole)}
            className={fieldClass}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r} disabled={!canManageTargetRole(actorRole, r)}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={creating}>
          {creating ? "Enviando..." : "Convidar"}
        </Button>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {lastInviteUrl && (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
          Sem envio de email configurado neste ambiente — link do convite:{" "}
          <span className="font-mono break-all">{lastInviteUrl}</span>
        </p>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Expira em</th>
              <th className="px-3 py-2 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {invitesQuery.isLoading && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            )}
            {invitesQuery.isError && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-destructive">
                  Não foi possível carregar os convites.
                </td>
              </tr>
            )}
            {invitesQuery.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-muted-foreground">
                  Nenhum convite pendente.
                </td>
              </tr>
            )}
            {invitesQuery.data?.map((invite) => (
              <tr key={invite.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-mono text-xs">{invite.email}</td>
                <td className="px-3 py-2">{ROLE_LABELS[invite.role]}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {new Date(invite.expires_at).toLocaleDateString("pt-BR")}
                </td>
                <td className="px-3 py-2">
                  <Button variant="outline" size="sm" onClick={() => handleRevoke(invite.id)}>
                    Revogar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
