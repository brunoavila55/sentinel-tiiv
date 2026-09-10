import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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

import { AssetInspector } from "@/components/topology/AssetInspector";
import { AssetNode, type AssetNodeData } from "@/components/topology/AssetNode";
import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { layoutWithDagre, NODE_HEIGHT, NODE_WIDTH, type LayoutDirection } from "@/lib/dagre-layout";
import type { SiteOut, TopologyResponse } from "@/lib/types";

const nodeTypes = { asset: AssetNode };

const fieldClass =
  "rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring";

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
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  if (sitesQuery.isError) {
    return <p className="text-sm text-destructive">Não foi possível carregar os sites.</p>;
  }

  if (sitesQuery.data && sitesQuery.data.length === 0) {
    return (
      <div className="max-w-md space-y-2">
        <h1 className="text-lg font-semibold">Topologia</h1>
        <p className="text-sm text-muted-foreground">
          Nenhum site cadastrado ainda. Crie um site para visualizar a topologia.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Topologia</h1>
        <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={fieldClass} aria-label="Site">
          {sitesQuery.data?.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
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

  const [direction, setDirection] = useState<LayoutDirection>("TB");
  const [search, setSearch] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const { fitView, setCenter, getZoom } = useReactFlow();

  const topologyQuery = useQuery({
    queryKey: ["topology", siteId],
    queryFn: () => apiFetch<TopologyResponse>(`/topology?site_id=${siteId}`),
  });

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<AssetNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    if (!topologyQuery.data) return;

    const rawNodes: Node<AssetNodeData>[] = topologyQuery.data.nodes.map((n) => ({
      id: n.id,
      type: "asset",
      position: { x: 0, y: 0 },
      data: { name: n.name, status: n.status, rtt: n.last_rtt_ms, direction, highlighted: false },
    }));
    const rawEdges: Edge[] = topologyQuery.data.edges.map((e) => ({
      id: e.id,
      source: e.source_asset_id,
      target: e.target_asset_id,
      style: { stroke: "var(--border)", strokeWidth: 1.5 },
    }));

    setNodes(layoutWithDagre(rawNodes, rawEdges, direction));
    setEdges(rawEdges);

    const timer = setTimeout(() => fitView({ padding: 0.2, duration: 200 }), 0);
    return () => clearTimeout(timer);
  }, [topologyQuery.data, direction, fitView, setNodes, setEdges]);

  function handleSearch(term: string) {
    setSearch(term);
    const match = term ? nodes.find((n) => n.data.name.toLowerCase().includes(term.toLowerCase())) : undefined;

    setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, highlighted: n.id === match?.id } })));

    if (match) {
      setCenter(match.position.x + NODE_WIDTH / 2, match.position.y + NODE_HEIGHT / 2, {
        zoom: Math.max(getZoom(), 1),
        duration: 300,
      });
    }
  }

  function reorganize() {
    setNodes((nds) => layoutWithDagre(nds, edges, direction));
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
        <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
          <input
            placeholder="Buscar ativo..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className={`${fieldClass} w-48`}
          />
          <Button variant="outline" size="sm" onClick={() => setDirection((d) => (d === "TB" ? "LR" : "TB"))}>
            {direction === "TB" ? "Vertical" : "Horizontal"}
          </Button>

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
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Carregando topologia...
          </div>
        )}

        {topologyQuery.isError && (
          <div className="flex h-full items-center justify-center text-sm text-destructive">
            Não foi possível carregar a topologia deste site.
          </div>
        )}

        {topologyQuery.data && topologyQuery.data.nodes.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Nenhum ativo neste site ainda.
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
