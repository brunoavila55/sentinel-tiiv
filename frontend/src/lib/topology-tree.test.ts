import { describe, expect, it } from "vitest";

import { buildTreeIndex, layoutTree, ROW_GAP } from "@/lib/topology-tree";
import type { TopologyLinkOut, TopologyNodeOut } from "@/lib/types";

const n = (id: string) => ({ id, name: id, status: "up", ip: null, last_rtt_ms: null, site: "s", has_photo: false }) as TopologyNodeOut;
const parent = (s: string, t: string) =>
  ({ id: `${s}-${t}`, source_asset_id: s, target_asset_id: t, link_type: "parent", created_at: "" }) as TopologyLinkOut;

describe("layoutTree", () => {
  const nodes = ["root", "a", "b", "c", "a1", "a2", "c1"].map(n);
  const edges = [parent("root", "a"), parent("root", "b"), parent("root", "c"), parent("a", "a1"), parent("a", "a2"), parent("c", "c1")];
  const tree = buildTreeIndex(nodes, edges);
  const { positions } = layoutTree(tree, new Set(), () => 100, 16);
  const y = (id: string) => positions.get(id)!.y;
  const x = (id: string) => positions.get(id)!.x;

  it("coloca cada nível numa coluna à direita do anterior", () => {
    expect(x("a")).toBe(x("b"));
    expect(x("a")).toBeGreaterThan(x("root") + 100);
    expect(x("a1")).toBeGreaterThan(x("a") + 100);
  });

  it("centraliza o pai entre o primeiro e o último filho (leque simétrico)", () => {
    expect(y("root")).toBeCloseTo((y("a") + y("c")) / 2);
    expect(y("a")).toBeCloseTo((y("a1") + y("a2")) / 2);
  });

  it("nunca deixa dois nós da mesma coluna mais perto que ROW_GAP", () => {
    for (const col of [["a", "b", "c"], ["a1", "a2", "c1"]]) {
      const ys = col.map(y).sort((p, q) => p - q);
      for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(ROW_GAP - 1e-9);
    }
  });

  it("ignora links que fechariam um ciclo", () => {
    const t = buildTreeIndex([n("x"), n("y")], [parent("x", "y"), parent("y", "x")]);
    expect(t.roots).toEqual(["x"]);
  });
});
