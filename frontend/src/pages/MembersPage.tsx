import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useState, type FormEvent } from "react";

import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { ROLE_LABELS, type InviteOut, type MemberOut, type OrganizationRole } from "@/lib/types";

const ROLE_OPTIONS: OrganizationRole[] = ["owner", "admin", "operator", "viewer"];

function canManageTargetRole(actorRole: OrganizationRole, targetRole: OrganizationRole): boolean {
  if (actorRole === "owner") return true;
  if (actorRole === "admin") return targetRole !== "owner";
  return false;
}

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

        <div className="flex flex-wrap gap-2">
          <SearchInput placeholder="Buscar por nome ou email" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
          <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as OrganizationRole | "")} className="w-44">
            <option value="">Todas as roles</option>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </div>

        {actionError && <p className="text-sm text-destructive">{actionError}</p>}

        {membersQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : membersQuery.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar os usuários.</p>
        ) : membersQuery.data?.length === 0 ? (
          <EmptyState icon={Users} title="Nenhum usuário encontrado." />
        ) : (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>Nome</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ações</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {membersQuery.data?.map((member) => {
                const canManageThis = canManageUsers && canManageTargetRole(actorRole, member.role);
                return (
                  <TableRow key={member.user_id}>
                    <TableCell>
                      {member.name}
                      {member.user_id === user?.id && <span className="ml-1 text-xs text-muted-foreground">(você)</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{member.email}</TableCell>
                    <TableCell>
                      {canManageThis ? (
                        <Select
                          value={member.role}
                          onChange={(e) => handleRoleChange(member.user_id, e.target.value as OrganizationRole)}
                          className="w-36"
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r} value={r} disabled={!canManageTargetRole(actorRole, r)}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        ROLE_LABELS[member.role]
                      )}
                    </TableCell>
                    <TableCell>{member.status === "active" ? "Ativo" : "Desabilitado"}</TableCell>
                    <TableCell>
                      {canManageThis && (
                        <Button variant="outline" size="sm" onClick={() => handleRemove(member.user_id)}>
                          Remover
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
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
          <Input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-64" />
        </div>
        <div className="space-y-1">
          <label htmlFor="invite-role" className="text-sm font-medium">
            Role
          </label>
          <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as OrganizationRole)} className="w-40">
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r} disabled={!canManageTargetRole(actorRole, r)}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
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

      {invitesQuery.isLoading ? (
        <Skeleton className="h-9 w-full" />
      ) : invitesQuery.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar os convites.</p>
      ) : invitesQuery.data?.length === 0 ? (
        <EmptyState title="Nenhum convite pendente." />
      ) : (
        <Table>
          <TableHeader>
            <tr>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Expira em</TableHead>
              <TableHead>Ações</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {invitesQuery.data?.map((invite) => (
              <TableRow key={invite.id}>
                <TableCell className="font-mono text-xs">{invite.email}</TableCell>
                <TableCell>{ROLE_LABELS[invite.role]}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(invite.expires_at).toLocaleDateString("pt-BR")}
                </TableCell>
                <TableCell>
                  <Button variant="outline" size="sm" onClick={() => handleRevoke(invite.id)}>
                    Revogar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
