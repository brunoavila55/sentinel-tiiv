import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

interface AuditLogOut {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

function formatMetadata(metadata: Record<string, unknown> | null): string {
  if (!metadata || Object.keys(metadata).length === 0) return "—";
  return Object.entries(metadata)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");
}

export function AuditLogsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["audit-logs"],
    queryFn: () => apiFetch<AuditLogOut[]>("/audit-logs"),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Auditoria</h1>
        <p className="text-sm text-muted-foreground">Eventos recentes desta organização.</p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
      {isError && <p className="text-sm text-destructive">Não foi possível carregar os eventos.</p>}
      {data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhum evento registrado ainda.</p>}

      {data && data.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Quando</th>
                <th className="px-3 py-2 font-medium">Usuário</th>
                <th className="px-3 py-2 font-medium">Ação</th>
                <th className="px-3 py-2 font-medium">Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {data.map((entry) => (
                <tr key={entry.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(entry.created_at).toLocaleString("pt-BR")}
                  </td>
                  <td className="px-3 py-2">{entry.user_name ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{entry.action}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{formatMetadata(entry.metadata)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
