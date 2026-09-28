import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { EmptyState } from "@/components/EmptyState";
import { AssetInspector } from "@/components/topology/AssetInspector";
import { TopologyLink } from "@/components/topology/TopologyLink";
import { TopologyNode, type TopologyNodeData } from "@/components/topology/TopologyNode";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { measureText } from "@/lib/text-width";
import {
  CIRCLE_SIZE,
  LABEL_FONT,
  LABEL_GAP,
  NODE_HEIGHT,
  STATUS_COLOR,
  STATUS_TEXT,
  toggleWidth,
} from "@/lib/topology-style";
import { ancestorChain, buildTreeIndex, countDescendants, layoutTree } from "@/lib/topology-tree";
import type { AssetStatus, SiteOut, TopologyResponse } from "@/lib/types";

const nodeTypes = { asset: TopologyNode };
const edgeTypes = { link: TopologyLink };
const STATUS_ORDER: AssetStatus[] = ["down", "warning", "unknown", "up"];

export function TopologyPage() {
  const [siteId, setSiteId] = useState("");

  const sitesQuery = useQuery({
    queryKey: ["sites", "__topology"],
    queryFn: () => apiFetch<SiteOut[]>("/sites"),
  });
  const effectiveSiteId = siteId || sitesQuery.data?.[0]?.id || "";

  if (sitesQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-[calc(100vh-11rem)] w-full" />
      </div>
    );
  }
  if (sitesQuery.isError) {
    return <p className="text-sm text-destructive">Não foi possível carregar os sites.</p>;
  }
  if (!sitesQuery.data || sitesQuery.data.length === 0) {
    return (
      <div className="max-w-md space-y-2">
        <h1 className="text-lg font-semibold">Topologia</h1>
        <EmptyState title="Nenhum site cadastrado." description="Crie um site para visualizar a topologia." />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Topologia</h1>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Site
          <Select value={effectiveSiteId} onChange={(e) => setSiteId(e.target.value)} className="h-8 w-56 text-xs">
            {sitesQuery.data.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name} ({site.asset_count})
              </option>
            ))}
          </Select>
        </label>
      </div>

      <ReactFlowProvider key={effectiveSiteId}>
        <TopologyMap siteId={effectiveSiteId} />
      </ReactFlowProvider>
    </div>
  );
}

function TopologyMap({ siteId }: { siteId: string }) {
  const { currentMembership } = useAuth();
  const canEdit = currentMembership?.role !== undefined && currentMembership.role !== "viewer";
  const queryClient = useQueryClient();
  const { fitView, setCenter, getZoom } = useReactFlow();

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AssetStatus | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const centerOnId = useRef<string | null>(null);

  const topologyQuery = useQuery({
    queryKey: ["topology", siteId],
    queryFn: () => apiFetch<TopologyResponse>(`/topology?site_id=${siteId}`),
  });
  const data = topologyQuery.data;

  // A largura dos nomes só é medida corretamente depois que a fonte carregou.
  useEffect(() => {
    let alive = true;
    const ready = document.fonts?.ready ?? Promise.resolve();
    ready.then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const tree = useMemo(() => buildTreeIndex(data?.nodes ?? [], data?.edges ?? []), [data]);
  const assetById = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n])), [data]);

  const counts = useMemo(() => {
    const c: Record<AssetStatus, number> = { up: 0, warning: 0, down: 0, unknown: 0 };
    for (const n of data?.nodes ?? []) c[n.status] += 1;
    return c;
  }, [data]);

  // Medidas de cada nó: círculo + nome + botão de recolher.
  const sizes = useMemo(() => {
    const map = new Map<string, { width: number; labelWidth: number; toggleWidth: number; hidden: number }>();
    for (const n of data?.nodes ?? []) {
      const labelWidth = measureText(n.name, LABEL_FONT) + 2;
      const hasChildren = (tree.childrenOf.get(n.id)?.length ?? 0) > 0;
      const hidden = collapsed.has(n.id) ? countDescendants(n.id, tree) : 0;
      const tw = hasChildren ? toggleWidth(hidden) : 0;
      map.set(n.id, { width: CIRCLE_SIZE + LABEL_GAP + labelWidth + tw, labelWidth, toggleWidth: tw, hidden });
    }
    return map;
    // fontsReady força nova medição quando a fonte termina de carregar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tree, collapsed, fontsReady]);

  const layout = useMemo(
    () => layoutTree(tree, collapsed, (id) => sizes.get(id)?.width ?? 0, NODE_HEIGHT),
    [tree, collapsed, sizes],
  );

  const onPath = useMemo(() => new Set(selectedId ? ancestorChain(selectedId, tree) : []), [selectedId, tree]);

  const toggle = useCallback(
    (id: string) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  // Posições arrastadas no modo edição (só nesta tela; não são salvas).
  // Descartadas quando a árvore é recalculada ou em "Reorganizar".
  const dragged = useRef(new Map<string, { x: number; y: number }>());
  const [dragVersion, setDragVersion] = useState(0);
  useEffect(() => {
    dragged.current.clear();
  }, [layout]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  useEffect(() => {
    const next: Node<TopologyNodeData>[] = [];
    for (const [id, position] of layout.positions) {
      const asset = assetById.get(id);
      const size = sizes.get(id);
      if (!asset || !size) continue;
      next.push({
        id,
        type: "asset",
        position: dragged.current.get(id) ?? position,
        data: {
          name: asset.name,
          status: asset.status,
          width: size.width,
          labelWidth: size.labelWidth,
          toggleWidth: size.toggleWidth,
          childCount: tree.childrenOf.get(id)?.length ?? 0,
          hiddenCount: size.hidden,
          selected: id === selectedId,
          highlighted: id === highlightedId,
          dimmed: statusFilter !== null && asset.status !== statusFilter,
          editing: editMode,
          onToggle: toggle,
        },
      });
    }
    setNodes(next);
  }, [layout, assetById, sizes, tree, selectedId, highlightedId, statusFilter, editMode, toggle, dragVersion, setNodes]);

  // Enquadra quando o desenho muda; se a busca pediu, centraliza o ativo encontrado.
  useEffect(() => {
    if (layout.positions.size === 0) return;
    const timer = setTimeout(() => {
      const target = centerOnId.current ? layout.positions.get(centerOnId.current) : undefined;
      if (target) setCenter(target.x + CIRCLE_SIZE / 2, target.y + NODE_HEIGHT / 2, { zoom: Math.max(getZoom(), 1.1), duration: 300 });
      else fitView({ padding: 0.08, duration: 200 });
      centerOnId.current = null;
    }, 30);
    return () => clearTimeout(timer);
  }, [layout, fitView, setCenter, getZoom]);

  const edges = useMemo<Edge[]>(() => {
    if (!data) return [];
    return data.edges
      .filter((e) => layout.positions.has(e.source_asset_id) && layout.positions.has(e.target_asset_id))
      .map((e) => {
        const isTree = tree.parentOf.get(e.target_asset_id) === e.source_asset_id;
        const highlighted = isTree && onPath.has(e.source_asset_id) && onPath.has(e.target_asset_id);
        const target = assetById.get(e.target_asset_id);
        const dimmed = statusFilter !== null && target?.status !== statusFilter;
        const toDown = target?.status === "down";
        return {
          id: e.id,
          source: e.source_asset_id,
          target: e.target_asset_id,
          type: "link",
          selectable: editMode,
          style: {
            stroke: highlighted ? "var(--primary)" : toDown ? STATUS_COLOR.down : "var(--muted-foreground)",
            strokeWidth: highlighted ? 2 : 1.25,
            // Links que não fazem parte da hierarquia (conexões extras) ficam tracejados.
            strokeDasharray: isTree ? undefined : "4 4",
            opacity: dimmed ? 0.15 : highlighted ? 1 : 0.6,
          },
        };
      });
  }, [data, layout, tree, onPath, assetById, statusFilter, editMode]);

  function handleSearch(term: string) {
    setSearch(term);
    const q = term.trim().toLowerCase();
    const match = q ? data?.nodes.find((n) => n.name.toLowerCase().includes(q) || n.ip?.toLowerCase().includes(q)) : undefined;
    setHighlightedId(match?.id ?? null);
    if (!match) return;
    const ancestors = ancestorChain(match.id, tree).slice(0, -1);
    if (ancestors.some((id) => collapsed.has(id))) {
      centerOnId.current = match.id;
      setCollapsed((prev) => new Set([...prev].filter((id) => !ancestors.includes(id))));
    } else {
      const p = layout.positions.get(match.id);
      if (p) setCenter(p.x + CIRCLE_SIZE / 2, p.y + NODE_HEIGHT / 2, { zoom: Math.max(getZoom(), 1.1), duration: 300 });
    }
  }

  function collapseAll() {
    // Deixa visíveis só as raízes e o primeiro nível.
    const next = new Set<string>();
    for (const root of tree.roots) {
      for (const child of tree.childrenOf.get(root) ?? []) {
        if ((tree.childrenOf.get(child)?.length ?? 0) > 0) next.add(child);
      }
    }
    setCollapsed(next);
  }

  async function handleConnect(connection: Connection) {
    if (!connection.source || !connection.target) return;
    setEditError(null);
    try {
      await apiFetch("/topology/links", {
        method: "POST",
        body: JSON.stringify({ site_id: siteId, source_asset_id: connection.source, target_asset_id: connection.target }),
      });
      await queryClient.invalidateQueries({ queryKey: ["topology", siteId] });
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Não foi possível criar a conexão.");
    }
  }

  async function handleEdgeClick(_: unknown, edge: Edge) {
    if (!window.confirm("Remover esta conexão?")) return;
    setEditError(null);
    try {
      await apiFetch(`/topology/links/${edge.id}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["topology", siteId] });
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Não foi possível remover a conexão.");
    }
  }

  return (
    <div className={`flex min-h-0 flex-1 overflow-hidden rounded-md border ${editMode ? "border-primary" : "border-border"}`}>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2">
          <SearchInput
            placeholder="Buscar por nome ou IP"
            aria-label="Buscar ativo"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="h-8 w-56 text-xs"
          />

          <div className="flex items-center gap-0.5 text-xs" role="group" aria-label="Destacar por estado">
            {STATUS_ORDER.map((s) => {
              const active = statusFilter === s;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={active}
                  disabled={counts[s] === 0 && !active}
                  onClick={() => setStatusFilter(active ? null : s)}
                  className={`flex h-7 items-center gap-1.5 rounded px-2 disabled:opacity-40 ${
                    active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[s] }} />
                  <span className="font-mono font-semibold tabular-nums">{counts[s]}</span>
                  {STATUS_TEXT[s]}
                </button>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setCollapsed(new Set())}>
              Expandir tudo
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={collapseAll}>
              Recolher tudo
            </Button>
            {editMode && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  dragged.current.clear();
                  setDragVersion((v) => v + 1);
                }}
              >
                Reorganizar
              </Button>
            )}
            {canEdit && (
              <Button
                variant={editMode ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setEditMode((v) => !v);
                  setEditError(null);
                }}
              >
                {editMode ? "Concluir edição" : "Editar topologia"}
              </Button>
            )}
          </div>
        </div>

        {editMode && (
          <div className="border-b border-primary/40 bg-primary/10 px-3 py-1 text-xs">
            Modo edição: arraste do ponto à direita de um ativo até o ponto à esquerda de outro para conectar; clique
            em uma linha para removê-la.
          </div>
        )}

        <div className="relative min-h-0 flex-1">
          {topologyQuery.isLoading && <Skeleton className="absolute inset-4" />}
          {topologyQuery.isError && (
            <p className="flex h-full items-center justify-center text-sm text-destructive">
              Não foi possível carregar a topologia deste site.
            </p>
          )}
          {data && data.nodes.length === 0 && (
            <div className="flex h-full items-center justify-center p-4">
              <EmptyState
                title="Nenhum ativo neste site."
                description="Cadastre ativos e informe o ativo pai de cada um para montar a árvore."
              />
            </div>
          )}
          {data && data.nodes.length > 0 && (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={(_, node) => setSelectedId(node.id)}
              onPaneClick={() => setSelectedId(null)}
              onNodeDragStop={(_, node) => dragged.current.set(node.id, node.position)}
              onConnect={editMode ? handleConnect : undefined}
              onEdgeClick={editMode ? handleEdgeClick : undefined}
              nodesDraggable={editMode}
              nodesConnectable={editMode}
              elementsSelectable={editMode}
              zoomOnDoubleClick={false}
              minZoom={0.05}
              maxZoom={2.5}
              proOptions={{ hideAttribution: true }}
            >
              <Controls showInteractive={false} position="bottom-right" />
            </ReactFlow>
          )}
          {editError && (
            <p className="absolute bottom-3 left-3 rounded border border-destructive/40 bg-background px-3 py-2 text-xs text-destructive">
              {editError}
            </p>
          )}
        </div>
      </div>

      {selectedId && (
        <AssetInspector
          key={selectedId}
          assetId={selectedId}
          onClose={() => setSelectedId(null)}
          onSelectAsset={setSelectedId}
          onFocusAsset={(id) => {
            const p = layout.positions.get(id);
            if (p) setCenter(p.x + CIRCLE_SIZE / 2, p.y + NODE_HEIGHT / 2, { zoom: Math.max(getZoom(), 1.1), duration: 300 });
          }}
        />
      )}
    </div>
  );
}
