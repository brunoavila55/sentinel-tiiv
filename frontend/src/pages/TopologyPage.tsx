import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { EmptyState } from "@/components/EmptyState";
import { AssetInspector } from "@/components/topology/AssetInspector";
import { RadialAssetNode, type RadialAssetNodeData } from "@/components/topology/RadialAssetNode";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { layoutRadial, RADIAL_NODE_SIZE } from "@/lib/radial-layout";
import { ancestorChain, buildTreeIndex, collapseAtDepth, visibleDescendants } from "@/lib/topology-tree";
import type { SiteOut, TopologyResponse } from "@/lib/types";

const nodeTypes = { asset: RadialAssetNode };

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
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Topologia</h1>
        <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label="Site" className="w-44">
          {sitesQuery.data?.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </Select>
      </div>

      {siteId && (
        <ReactFlowProvider>
          <TopologyCanvas siteId={siteId} />
        </ReactFlowProvider>
      )}
    </div>
  );
}

function TopologyCanvas({ siteId }: { siteId: string }) {
  const { currentMembership } = useAuth();
  const canEdit =
    currentMembership?.role === "owner" || currentMembership?.role === "admin" || currentMembership?.role === "operator";
  const queryClient = useQueryClient();

  const [hierarchy, setHierarchy] = useState<"flat" | "full">("full");
  const [search, setSearch] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [pendingCenterId, setPendingCenterId] = useState<string | null>(null);
  const { fitView, setCenter, getZoom } = useReactFlow();

  const topologyQuery = useQuery({
    queryKey: ["topology", siteId],
    queryFn: () => apiFetch<TopologyResponse>(`/topology?site_id=${siteId}`),
  });

  const treeIndex = useMemo(
    () => buildTreeIndex(topologyQuery.data?.nodes ?? [], topologyQuery.data?.edges ?? []),
    [topologyQuery.data],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<RadialAssetNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Reseta o recolhimento e o foco sempre que os dados mudam (novo site,
  // link criado/removido) ou o modo Flat/Completa é trocado. Um toggle
  // manual de um nó específico feito depois disso fica valendo até a
  // próxima mudança de dado/modo.
  useEffect(() => {
    if (!topologyQuery.data) return;
    setFocusId(null);
    setCollapsedIds(hierarchy === "flat" ? collapseAtDepth(treeIndex, 1) : new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyQuery.data, hierarchy]);

  useEffect(() => {
    if (!topologyQuery.data) return;

    const startIds = focusId ? [focusId] : treeIndex.roots;
    const visible = visibleDescendants(startIds, treeIndex, collapsedIds);

    const rawNodes: Node<RadialAssetNodeData>[] = topologyQuery.data.nodes
      .filter((n) => visible.has(n.id))
      .map((n) => {
        const children = treeIndex.childrenOf.get(n.id) ?? [];
        return {
          id: n.id,
          type: "asset",
          position: { x: 0, y: 0 },
          data: {
            name: n.name,
            status: n.status,
            angle: 0,
            highlighted: n.id === highlightedId,
            hasChildren: children.length > 0,
            childCount: children.length,
            collapsed: collapsedIds.has(n.id),
            onToggleCollapse: (id: string) =>
              setCollapsedIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              }),
            onFocus: (id: string) => setFocusId(id),
          },
        };
      });
    const rawEdges: Edge[] = topologyQuery.data.edges
      .filter((e) => visible.has(e.source_asset_id) && visible.has(e.target_asset_id))
      .map((e) => ({
        id: e.id,
        source: e.source_asset_id,
        target: e.target_asset_id,
        type: "straight",
        style: { stroke: "var(--border)", strokeWidth: 1 },
      }));

    const laidOut = layoutRadial(rawNodes, treeIndex);
    setNodes(laidOut);
    setEdges(rawEdges);

    const timer = setTimeout(() => {
      const target = pendingCenterId ? laidOut.find((n) => n.id === pendingCenterId) : undefined;
      if (target) {
        setCenter(target.position.x + RADIAL_NODE_SIZE / 2, target.position.y + RADIAL_NODE_SIZE / 2, {
          zoom: Math.max(getZoom(), 1),
          duration: 300,
        });
      } else {
        fitView({ padding: 0.2, duration: 200 });
      }
      if (pendingCenterId) setPendingCenterId(null);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyQuery.data, collapsedIds, focusId, highlightedId, treeIndex]);

  function handleSearch(term: string) {
    setSearch(term);
    if (!term || !topologyQuery.data) {
      setHighlightedId(null);
      return;
    }
    const match = topologyQuery.data.nodes.find((n) => n.name.toLowerCase().includes(term.toLowerCase()));
    if (!match) {
      setHighlightedId(null);
      return;
    }

    setFocusId(null);
    const ancestors = ancestorChain(match.id, treeIndex).filter((id) => id !== match.id);
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      ancestors.forEach((id) => next.delete(id));
      return next;
    });
    setHighlightedId(match.id);
    setPendingCenterId(match.id);
  }

  const breadcrumb = focusId ? ancestorChain(focusId, treeIndex) : null;

  function reorganize() {
    setNodes((nds) => layoutRadial(nds, treeIndex));
    setTimeout(() => fitView({ padding: 0.2, duration: 200 }), 0);
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
    if (!editMode) return;
    if (!window.confirm("Remover esta conexão?")) return;
    setEditError(null);
    try {
      await apiFetch(`/topology/links/${edge.id}`, { method: "DELETE" });
      await refreshTopology();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Não foi possível remover a conexão.");
    }
  }

  return (
    <div
      className={`flex flex-1 overflow-hidden rounded-md border ${editMode ? "border-primary" : "border-border"}`}
    >
      <div className="relative flex-1">
        <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-2">
          <SearchInput placeholder="Buscar ativo..." value={search} onChange={(e) => handleSearch(e.target.value)} className="w-48" />

          <div className="flex overflow-hidden rounded-md border border-border">
            <button
              type="button"
              onClick={() => setHierarchy("flat")}
              className={`px-2 py-1 text-xs font-medium ${
                hierarchy === "flat" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"
              }`}
            >
              Flat
            </button>
            <button
              type="button"
              onClick={() => setHierarchy("full")}
              className={`border-l border-border px-2 py-1 text-xs font-medium ${
                hierarchy === "full" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"
              }`}
            >
              Completa
            </button>
          </div>

          {editMode && (
            <Button variant="outline" size="sm" onClick={reorganize}>
              Reorganizar automaticamente
            </Button>
          )}

          {canEdit && (
            <Button
              variant={editMode ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setEditMode((v) => !v);
                setEditError(null);
              }}
            >
              {editMode ? "Concluir edição" : "Editar topologia"}
            </Button>
          )}
        </div>

        {breadcrumb && topologyQuery.data && (
          <div className="absolute top-14 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs">
            <button type="button" onClick={() => setFocusId(null)} className="font-medium text-primary hover:underline">
              Ver site inteiro
            </button>
            {breadcrumb.map((id) => {
              const node = topologyQuery.data?.nodes.find((n) => n.id === id);
              if (!node) return null;
              return (
                <span key={id} className="flex items-center gap-1">
                  <span className="text-muted-foreground">/</span>
                  <button
                    type="button"
                    onClick={() => setFocusId(id)}
                    className={id === focusId ? "font-medium" : "text-muted-foreground hover:text-foreground"}
                  >
                    {node.name}
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {editMode && (
          <div className="absolute inset-x-0 top-0 z-10 bg-primary py-1 text-center text-xs font-medium text-primary-foreground">
            Modo de edição — arraste entre os pontos de um ativo até outro para conectar, clique numa conexão para
            remover
          </div>
        )}

        {editError && (
          <div className="absolute bottom-3 left-3 z-10 rounded-md border border-destructive/40 bg-background px-3 py-2 text-xs text-destructive">
            {editError}
          </div>
        )}

        {topologyQuery.isLoading && (
          <div className="flex h-full items-center justify-center">
            <Skeleton className="h-3/4 w-3/4" />
          </div>
        )}

        {topologyQuery.isError && (
          <div className="flex h-full items-center justify-center text-sm text-destructive">
            Não foi possível carregar a topologia deste site.
          </div>
        )}

        {topologyQuery.data && topologyQuery.data.nodes.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <EmptyState title="Nenhum ativo neste site ainda." />
          </div>
        )}

        {nodes.length > 0 && (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedAssetId(node.id)}
            onConnect={editMode ? handleConnect : undefined}
            onEdgeClick={editMode ? handleEdgeClick : undefined}
            nodesDraggable={editMode}
            nodesConnectable={editMode}
            elementsSelectable
            fitView
            minZoom={0.05}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} size={1} color="var(--border)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>

      {selectedAssetId && (
        <AssetInspector key={selectedAssetId} assetId={selectedAssetId} onClose={() => setSelectedAssetId(null)} />
      )}
    </div>
  );
}
