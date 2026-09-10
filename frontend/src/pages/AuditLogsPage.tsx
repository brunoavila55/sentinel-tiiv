import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";

import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar os eventos.</p>
      ) : data?.length === 0 ? (
        <EmptyState icon={History} title="Nenhum evento registrado ainda." />
      ) : (
        <Table>
          <TableHeader>
            <tr>
              <TableHead>Quando</TableHead>
              <TableHead>Usuário</TableHead>
              <TableHead>Ação</TableHead>
              <TableHead>Detalhes</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {data?.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="text-xs text-muted-foreground">{new Date(entry.created_at).toLocaleString("pt-BR")}</TableCell>
                <TableCell>{entry.user_name ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatMetadata(entry.metadata)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
