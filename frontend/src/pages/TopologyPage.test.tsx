import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api";
import { TopologyPage } from "@/pages/TopologyPage";
import { renderWithProviders } from "@/test/test-utils";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    currentMembership: { organization_id: "org-1", organization_name: "Org", organization_slug: "org", role: "viewer" },
  }),
}));

const mockedApiFetch = vi.mocked(apiFetch);

const site = { id: "site-1", name: "Matriz", description: null, address: null, asset_count: 3, created_at: "", updated_at: "" };

function node(id: string, name: string, status = "up") {
  return { id, name, status, ip: `10.0.0.${id.slice(1)}`, last_rtt_ms: 1, site: "Matriz", has_photo: false };
}

function mockTopology(topology: unknown) {
  mockedApiFetch.mockImplementation(async (path: unknown) => {
    const p = String(path);
    if (p.startsWith("/sites")) return [site];
    if (p.startsWith("/topology")) return topology;
    throw new Error(`chamada inesperada: ${p}`);
  });
}

const threeLevels = {
  nodes: [node("a1", "core"), node("a2", "sw-meio"), node("a3", "ap-neto", "down")],
  edges: [
    { id: "e1", source_asset_id: "a1", target_asset_id: "a2", link_type: "parent", created_at: "" },
    { id: "e2", source_asset_id: "a2", target_asset_id: "a3", link_type: "parent", created_at: "" },
  ],
};

describe("TopologyPage", () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockTopology(threeLevels);
  });

  it("desenha a árvore do site e esconde a edição para viewer", async () => {
    renderWithProviders(<TopologyPage />);

    expect(await screen.findByText("ap-neto")).toBeInTheDocument();
    expect(screen.getByText("core")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /editar topologia/i })).not.toBeInTheDocument();
  });

  it("recolher um ramo esconde os descendentes, e a busca os revela", async () => {
    renderWithProviders(<TopologyPage />);
    await screen.findByText("ap-neto");

    // "core" e "sw-meio" têm filhos, cada um com seu botão; o segundo é o de sw-meio.
    // (React Flow deixa os nós invisíveis no jsdom, então a busca é pelo title.)
    const [, swToggle] = screen.getAllByTitle(/^recolher ramifica/i);
    fireEvent.click(swToggle);

    await waitFor(() => expect(screen.queryByText("ap-neto")).not.toBeInTheDocument());
    expect(screen.getByTitle(/expandir 1 ativos/i)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/buscar por nome ou ip/i), { target: { value: "ap-neto" } });
    await waitFor(() => expect(screen.getByText("ap-neto")).toBeInTheDocument());
  });

  it("mostra o estado vazio quando o site não tem ativos", async () => {
    mockTopology({ nodes: [], edges: [] });
    renderWithProviders(<TopologyPage />);

    expect(await screen.findByText(/nenhum ativo neste site/i)).toBeInTheDocument();
  });
});
