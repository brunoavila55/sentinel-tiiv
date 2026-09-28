import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { Maximize2, Minimize2, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Link } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState";
import { AssetInspector } from "@/components/topology/AssetInspector";
import { TopologyHostNode, type TopologyHostNodeData } from "@/components/topology/TopologyHostNode";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { DEFAULT_FORCE_OPTIONS, type ForceOptions } from "@/lib/force-layout";
import {
  layoutForce,
  layoutHierarchy,
  layoutRadial,
  type LayoutPoint,
  type TopologyLayoutStyle,
} from "@/lib/topology-layout";
import { HOST_RADIUS, ROOT_RADIUS, STATUS_LABEL, TOPOLOGY_STATUS_COLOR } from "@/lib/topology-status";
import { ancestorChain, buildTreeIndex, visibleDescendants } from "@/lib/topology-tree";
import type { AssetStatus, SiteOut, TopologyNodeOut, TopologyResponse } from "@/lib/types";

const nodeTypes = { host: TopologyHostNode };

const LAYOUT_STYLES: Array<{ id: TopologyLayoutStyle; label: string }> = [
  { id: "force", label: "Forças" },
  { id: "hierarchy", label: "Hierarquia" },
  { id: "radial", label: "Radial" },
];

const STATUS_ORDER: AssetStatus[] = ["down", "warning", "unknown", "up"];

/** Mesmas faixas do painel "Force configuration" do Checkmk. */
const FORCE_SLIDERS: Array<{ id: keyof ForceOptions; label: string; min: number; max: number; step: number }> = [
  { id: "charge", label: "Repulsão", min: -1000, max: 50, step: 1 },
  { id: "link_distance", label: "Distância dos links", min: -10, max: 500, step: 1 },
  { id: "link_strength", label: "Força dos links", min: 0, max: 4, step: 0.01 },
  { id: "collide", label: "Caixa de colisão", min: 0, max: 150, step: 1 },
  { id: "center", label: "Força para o centro", min: -0.08, max: 1, step: 0.01 },
];

export function TopologyPage() {
  const [siteId, setSiteId] = useState<string>("");

  const sitesQuery = useQuery({
    queryKey: ["sites", "__topology"],
    queryFn: () => apiFetch<SiteOut[]>("/sites"),
  });

  useEffect(() => {
    if (!siteId && sitesQuery.data && sitesQuery.data.length > 0) {
      setSiteId(sitesQuery.data[0].id);
    }
  }, [siteId, sitesQuery.data]);

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

  if (sitesQuery.data && sitesQuery.data.length === 0) {
    return (
      <div className="max-w-md space-y-2">
        <h1 className="text-lg font-semibold">Topologia</h1>
        <EmptyState title="Nenhum site cadastrado ainda." description="Crie um site para visualizar a topologia." />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Topologia</h1>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Site
          <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="h-8 w-56 text-xs">
            {sitesQuery.data?.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name} ({site.asset_count})
              </option>
            ))}
          </Select>
        </label>
      </div>

      {siteId && (
        <ReactFlowProvider key={siteId}>
          <TopologyCanvas siteId={siteId} />
        </ReactFlowProvider>
      )}
    </div>
  );
}

interface ContextMenuState {
  id: string;
  x: number;
  y: number;
}

function TopologyCanvas({ siteId }: { siteId: string }) {
  const { currentMembership } = useAuth();
  const canEdit =
    currentMembership?.role === "owner" || currentMembership?.role === "admin" || currentMembership?.role === "operator";
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);

  const [layoutStyle, setLayoutStyle] = useState<TopologyLayoutStyle>("force");
  const [forceOptions, setForceOptions] = useState<ForceOptions>(DEFAULT_FORCE_OPTIONS);
  const [showForcePanel, setShowForcePanel] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AssetStatus | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const pendingCenterId = useRef<string | null>(null);
  /** Posições arrastadas no modo edição; descartadas quando o layout é recalculado. */
  const manualPositions = useRef(new Map<string, { x: number; y: number }>());

  const { fitView, setCenter, getZoom } = useReactFlow();

  const topologyQuery = useQuery({
    queryKey: ["topology", siteId],
    queryFn: () => apiFetch<TopologyResponse>(`/topology?site_id=${siteId}`),
  });
  const data = topologyQuery.data;

  const treeIndex = useMemo(() => buildTreeIndex(data?.nodes ?? [], data?.edges ?? []), [data]);
  const nodeById = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n])), [data]);

  const statusCounts = useMemo(() => {
    const counts: Record<AssetStatus, number> = { up: 0, warning: 0, down: 0, unknown: 0 };
    for (const n of data?.nodes ?? []) counts[n.status] = (counts[n.status] ?? 0) + 1;
    return counts;
  }, [data]);

  const visibleIds = useMemo(
    () => visibleDescendants(focusId ? [focusId] : treeIndex.roots, treeIndex, collapsedIds),
    [treeIndex, focusId, collapsedIds],
  );

  const visibleEdges = useMemo(
    () => (data?.edges ?? []).filter((e) => visibleIds.has(e.source_asset_id) && visibleIds.has(e.target_asset_id)),
    [data, visibleIds],
  );

  // Layout: só recalcula quando muda o que está visível, o estilo ou as forças —
  // seleção, hover e busca não mexem na posição dos nós.
  const layout = useMemo<Map<string, LayoutPoint>>(() => {
    if (visibleIds.size === 0) return new Map();
    if (layoutStyle === "hierarchy") return layoutHierarchy(visibleIds, treeIndex);
    if (layoutStyle === "radial") return layoutRadial(visibleIds, treeIndex);
    return layoutForce(
      visibleIds,
      treeIndex,
      visibleEdges.map((e) => ({ source: e.source_asset_id, target: e.target_asset_id })),
      forceOptions,
    );
  }, [visibleIds, visibleEdges, treeIndex, layoutStyle, forceOptions]);

  useEffect(() => {
    manualPositions.current.clear();
  }, [layout]);

  const upstreamIds = useMemo(
    () => new Set(selectedAssetId ? ancestorChain(selectedAssetId, treeIndex) : []),
    [selectedAssetId, treeIndex],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);

  useEffect(() => {
    const next: Node<TopologyHostNodeData>[] = [];
    for (const [id, point] of layout) {
      const asset = nodeById.get(id);
      if (!asset) continue;
      const isRoot = !treeIndex.parentOf.get(id) || !visibleIds.has(treeIndex.parentOf.get(id) as string);
      const radius = isRoot && (treeIndex.childrenOf.get(id)?.length ?? 0) > 0 ? ROOT_RADIUS : HOST_RADIUS;
      const hiddenChildren = collapsedIds.has(id) ? countDescendants(id, treeIndex) : 0;
      const manual = manualPositions.current.get(id);
      next.push({
        id,
        type: "host",
        position: manual ?? { x: point.x - radius, y: point.y - radius },
        data: {
          name: asset.name,
          status: asset.status,
          radius,
          label: point.label,
          hiddenChildren,
          focused: id === selectedAssetId,
          highlighted: id === highlightedId,
          dimmed: statusFilter != null && asset.status !== statusFilter,
        },
      });
    }
    setNodes(next);
  }, [layout, nodeById, treeIndex, visibleIds, collapsedIds, selectedAssetId, highlightedId, statusFilter, setNodes]);

  // Enquadra o mapa quando o layout muda (ou centraliza o ativo buscado).
  useEffect(() => {
    if (layout.size === 0) return;
    const timer = setTimeout(() => {
      const targetId = pendingCenterId.current;
      const target = targetId ? layout.get(targetId) : undefined;
      if (target) {
        setCenter(target.x, target.y, { zoom: Math.max(getZoom(), 1), duration: 300 });
      } else {
        fitView({ padding: 0.12, duration: 200 });
      }
      pendingCenterId.current = null;
    }, 30);
    return () => clearTimeout(timer);
  }, [layout, fitView, setCenter, getZoom]);

  const edges = useMemo<Edge[]>(
    () =>
      visibleEdges.map((e) => {
        const target = nodeById.get(e.target_asset_id);
        const source = nodeById.get(e.source_asset_id);
        const onPath = upstreamIds.has(e.source_asset_id) && upstreamIds.has(e.target_asset_id);
        const toDown = target?.status === "down";
        const dimmed = statusFilter != null && (target?.status !== statusFilter || source?.status !== statusFilter);
        const isParent = e.link_type === "parent";
        return {
          id: e.id,
          source: e.source_asset_id,
          target: e.target_asset_id,
          type: "straight",
          selectable: editMode,
          style: {
            stroke: onPath ? "var(--foreground)" : toDown ? TOPOLOGY_STATUS_COLOR.down : "var(--muted-foreground)",
            strokeWidth: onPath ? 2.5 : toDown ? 1.5 : 1,
            // Links que não são hierarquia (conexões avulsas) ficam tracejados,
            // como os foreign_link do Checkmk.
            strokeDasharray: isParent ? undefined : "2 3",
            opacity: dimmed ? 0.15 : onPath ? 1 : 0.55,
          },
        };
      }),
    [visibleEdges, nodeById, upstreamIds, statusFilter, editMode],
  );

  // Fecha o menu de contexto com Esc.
  useEffect(() => {
    if (!contextMenu) return;
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && setContextMenu(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [contextMenu]);

  function toggleCollapse(id: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function collapseBelow(id: string) {
    // Mantém o nó e os filhos diretos; recolhe tudo a partir dos netos.
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      for (const child of treeIndex.childrenOf.get(id) ?? []) {
        if ((treeIndex.childrenOf.get(child)?.length ?? 0) > 0) next.add(child);
      }
      return next;
    });
  }

  function handleSearch(term: string) {
    setSearch(term);
    const q = term.trim().toLowerCase();
    if (!q || !data) {
      setHighlightedId(null);
      return;
    }
    const match = data.nodes.find((n) => n.name.toLowerCase().includes(q) || n.ip?.toLowerCase().includes(q));
    if (!match) {
      setHighlightedId(null);
      return;
    }
    const ancestors = ancestorChain(match.id, treeIndex).slice(0, -1);
    const hiddenByCollapse = ancestors.some((id) => collapsedIds.has(id));
    const outsideFocus = focusId != null && !ancestors.includes(focusId) && match.id !== focusId;
    setHighlightedId(match.id);
    pendingCenterId.current = match.id;
    if (hiddenByCollapse || outsideFocus) {
      if (outsideFocus) setFocusId(null);
      setCollapsedIds((prev) => {
        const next = new Set(prev);
        ancestors.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      const point = layout.get(match.id);
      if (point) setCenter(point.x, point.y, { zoom: Math.max(getZoom(), 1), duration: 300 });
      pendingCenterId.current = null;
    }
  }

  function resetView() {
    setFocusId(null);
    setCollapsedIds(new Set());
    setStatusFilter(null);
    setHighlightedId(null);
    setSearch("");
    fitView({ padding: 0.12, duration: 200 });
  }

  async function refreshTopology() {
    await queryClient.invalidateQueries({ queryKey: ["topology", siteId] });
  }

  async function handleConnect(connection: Connection) {
    if (!connection.source || !connection.target) return;
    setEditError(null);
    try {
      await apiFetch("/topology/links", {
        method: "POST",
        body: JSON.stringify({
          site_id: siteId,
          source_asset_id: connection.source,
          target_asset_id: connection.target,
        }),
      });
      await refreshTopology();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Não foi possível criar a conexão.");
    }
  }

  async function handleEdgeClick(_event: unknown, edge: Edge) {
    if (!window.confirm("Remover esta conexão?")) return;
    setEditError(null);
    try {
      await apiFetch(`/topology/links/${edge.id}`, { method: "DELETE" });
      await refreshTopology();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Não foi possível remover a conexão.");
    }
  }

  const breadcrumb = focusId ? ancestorChain(focusId, treeIndex) : null;
  const hovered = hoveredId ? nodeById.get(hoveredId) : undefined;
  const menuAsset = contextMenu ? nodeById.get(contextMenu.id) : undefined;
  const menuHasChildren = contextMenu ? (treeIndex.childrenOf.get(contextMenu.id)?.length ?? 0) > 0 : false;

  return (
    <div
      className={`flex flex-1 overflow-hidden border bg-background ${
        editMode ? "border-primary" : "border-border"
      } ${isFullscreen ? "fixed inset-0 z-50 border-0" : "rounded-md"}`}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra de controles */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2">
          <SearchInput
            placeholder="Buscar por nome ou IP"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="h-8 w-56 text-xs"
            aria-label="Buscar ativo"
          />

          <div className="flex items-center gap-0.5 text-xs" role="group" aria-label="Filtrar por estado">
            {STATUS_ORDER.map((s) => {
              const active = statusFilter === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(active ? null : s)}
                  aria-pressed={active}
                  disabled={statusCounts[s] === 0 && !active}
                  className={`flex h-7 items-center gap-1.5 rounded px-2 tabular-nums transition-colors disabled:opacity-40 ${
                    active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  title={active ? "Mostrar todos" : `Destacar ativos ${STATUS_LABEL[s]}`}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: TOPOLOGY_STATUS_COLOR[s] }} />
                  <span className="font-mono font-semibold">{statusCounts[s]}</span>
                  <span>{STATUS_LABEL[s]}</span>
                </button>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <div className="flex rounded border border-border p-0.5" role="group" aria-label="Estilo de layout">
              {LAYOUT_STYLES.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={layoutStyle === l.id}
                  onClick={() => setLayoutStyle(l.id)}
                  className={`rounded-sm px-2 py-1 text-xs transition-colors ${
                    layoutStyle === l.id ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>

            {layoutStyle === "force" && (
              <Button
                variant={showForcePanel ? "secondary" : "outline"}
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setShowForcePanel((v) => !v)}
                title="Ajustar forças do layout"
                aria-label="Ajustar forças do layout"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </Button>
            )}

            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={resetView} title="Expandir tudo e enquadrar">
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Redefinir
            </Button>

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
                {editMode ? "Concluir edição" : "Editar"}
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setIsFullscreen((v) => !v)}
              title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
              aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {editMode && (
          <div className="border-b border-primary/40 bg-primary/10 px-3 py-1 text-xs text-foreground">
            Modo edição: arraste de um ativo até outro para conectar; clique em um link para removê-lo.
          </div>
        )}

        <div ref={containerRef} className="relative flex-1" onClick={() => contextMenu && setContextMenu(null)}>
          {breadcrumb && (
            <nav className="absolute top-2 left-2 z-10 flex flex-wrap items-center gap-1 rounded border border-border bg-background/95 px-2 py-1 text-xs">
              <button type="button" onClick={() => setFocusId(null)} className="text-primary hover:underline">
                Site inteiro
              </button>
              {breadcrumb.map((id) => (
                <span key={id} className="flex items-center gap-1">
                  <span className="text-muted-foreground">/</span>
                  <button
                    type="button"
                    onClick={() => setFocusId(id)}
                    className={id === focusId ? "font-semibold" : "text-muted-foreground hover:text-foreground"}
                  >
                    {nodeById.get(id)?.name ?? "?"}
                  </button>
                </span>
              ))}
            </nav>
          )}

          {showForcePanel && layoutStyle === "force" && (
            <ForcePanel options={forceOptions} onChange={setForceOptions} onClose={() => setShowForcePanel(false)} />
          )}

          {topologyQuery.isLoading && <Skeleton className="absolute inset-4" />}

          {topologyQuery.isError && (
            <p className="flex h-full items-center justify-center text-sm text-destructive">
              Não foi possível carregar a topologia deste site.
            </p>
          )}

          {data && data.nodes.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                title="Nenhum ativo neste site."
                description="Cadastre ativos e defina o ativo pai de cada um para montar a topologia."
              />
            </div>
          )}

          {data && data.nodes.length > 0 && (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              nodeTypes={nodeTypes}
              onNodeClick={(_, node) => {
                setContextMenu(null);
                setSelectedAssetId(node.id);
              }}
              onNodeDoubleClick={(_, node) => {
                if ((treeIndex.childrenOf.get(node.id)?.length ?? 0) > 0) toggleCollapse(node.id);
              }}
              onNodeContextMenu={(ev, node) => {
                ev.preventDefault();
                const rect = containerRef.current?.getBoundingClientRect();
                setContextMenu({ id: node.id, x: ev.clientX - (rect?.left ?? 0), y: ev.clientY - (rect?.top ?? 0) });
              }}
              onNodeMouseEnter={(_, node) => setHoveredId(node.id)}
              onNodeMouseLeave={() => setHoveredId(null)}
              onNodeDragStop={(_, node) => manualPositions.current.set(node.id, node.position)}
              onPaneClick={() => setContextMenu(null)}
              onConnect={editMode ? handleConnect : undefined}
              onEdgeClick={editMode ? handleEdgeClick : undefined}
              nodesDraggable={editMode}
              nodesConnectable={editMode}
              elementsSelectable={editMode}
              zoomOnDoubleClick={false}
              minZoom={0.05}
              maxZoom={3}
              proOptions={{ hideAttribution: true }}
            >
              <Controls showInteractive={false} position="bottom-right" />
            </ReactFlow>
          )}

          {/* Quickinfo do ativo sob o cursor, fixo no canto (como no Checkmk). */}
          {hovered && <QuickInfo asset={hovered} parent={nodeById.get(treeIndex.parentOf.get(hovered.id) ?? "")} />}

          {contextMenu && menuAsset && (
            <div
              className="absolute z-30 min-w-52 rounded border border-border bg-popover py-1 text-xs text-popover-foreground shadow-md"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(e) => e.stopPropagation()}
              role="menu"
            >
              <div className="border-b border-border px-3 pt-1 pb-1.5 font-semibold">{menuAsset.name}</div>
              <MenuItem
                onClick={() => {
                  setSelectedAssetId(contextMenu.id);
                  setContextMenu(null);
                }}
              >
                Abrir painel do ativo
              </MenuItem>
              <Link
                to={`/assets/${contextMenu.id}`}
                className="block px-3 py-1.5 hover:bg-muted"
                role="menuitem"
              >
                Ir para a página do ativo
              </Link>
              {menuHasChildren && (
                <>
                  <div className="my-1 border-t border-border" />
                  <MenuItem
                    onClick={() => {
                      toggleCollapse(contextMenu.id);
                      setContextMenu(null);
                    }}
                  >
                    {collapsedIds.has(contextMenu.id) ? "Expandir filhos" : "Recolher filhos"}
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      collapseBelow(contextMenu.id);
                      setContextMenu(null);
                    }}
                  >
                    Mostrar só o próximo nível
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setFocusId(contextMenu.id);
                      setContextMenu(null);
                    }}
                  >
                    Mostrar só esta ramificação
                  </MenuItem>
                </>
              )}
              {collapsedIds.size > 0 && (
                <MenuItem
                  onClick={() => {
                    setCollapsedIds(new Set());
                    setContextMenu(null);
                  }}
                >
                  Expandir todos
                </MenuItem>
              )}
            </div>
          )}

          {editError && (
            <div className="absolute bottom-3 left-3 z-20 rounded border border-destructive/40 bg-background px-3 py-2 text-xs text-destructive">
              {editError}
            </div>
          )}
        </div>
      </div>

      {selectedAssetId && (
        <AssetInspector
          key={selectedAssetId}
          assetId={selectedAssetId}
          onClose={() => setSelectedAssetId(null)}
          onSelectAsset={(id) => setSelectedAssetId(id)}
          onFocusAsset={(id) => {
            const point = layout.get(id);
            if (point) setCenter(point.x, point.y, { zoom: Math.max(getZoom(), 1), duration: 300 });
          }}
        />
      )}
    </div>
  );
}

function countDescendants(id: string, tree: ReturnType<typeof buildTreeIndex>): number {
  let count = 0;
  const stack = [...(tree.childrenOf.get(id) ?? [])];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    if (seen.has(cur)) continue;
    seen.add(cur);
    count++;
    stack.push(...(tree.childrenOf.get(cur) ?? []));
  }
  return count;
}

function MenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="block w-full px-3 py-1.5 text-left hover:bg-muted">
      {children}
    </button>
  );
}

function QuickInfo({ asset, parent }: { asset: TopologyNodeOut; parent?: TopologyNodeOut }) {
  const rows: Array<[string, string]> = [
    ["Estado", STATUS_LABEL[asset.status]],
    ["IP", asset.ip ?? "—"],
    ["RTT", asset.last_rtt_ms != null ? `${asset.last_rtt_ms.toFixed(1)} ms` : "—"],
    ["Pai", parent?.name ?? "—"],
  ];
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-20 min-w-56 rounded border border-border bg-background/95 text-xs">
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 font-semibold">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: TOPOLOGY_STATUS_COLOR[asset.status] }} />
        {asset.name}
      </div>
      <table className="w-full">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="px-2.5 py-0.5 text-muted-foreground">{k}</td>
              <td className="px-2.5 py-0.5 text-right font-mono">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ForcePanel({
  options,
  onChange,
  onClose,
}: {
  options: ForceOptions;
  onChange: (o: ForceOptions) => void;
  onClose: () => void;
}) {
  // Ajusta localmente e só recalcula o layout ao soltar o controle.
  const [draft, setDraft] = useState(options);
  const commit = () => onChange(draft);

  return (
    <div className="absolute top-2 right-2 z-20 w-64 rounded border border-border bg-background text-xs shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="font-semibold">Forças do layout</span>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Fechar">
          ×
        </button>
      </div>
      <div className="space-y-2 px-3 py-2">
        {FORCE_SLIDERS.map((s) => (
          <label key={s.id} className="block">
            <span className="flex justify-between text-muted-foreground">
              {s.label}
              <span className="font-mono text-foreground">{draft[s.id]}</span>
            </span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={draft[s.id]}
              onChange={(e) => setDraft({ ...draft, [s.id]: Number(e.target.value) })}
              onPointerUp={commit}
              onKeyUp={commit}
              className="w-full accent-primary"
            />
          </label>
        ))}
        <button
          type="button"
          onClick={() => {
            setDraft(DEFAULT_FORCE_OPTIONS);
            onChange(DEFAULT_FORCE_OPTIONS);
          }}
          className="text-primary hover:underline"
        >
          Restaurar padrão
        </button>
      </div>
    </div>
  );
}
