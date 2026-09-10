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
    currentMembership: {
      organization_id: "org-1",
      organization_name: "Org",
      organization_slug: "org",
      role: "viewer",
    },
  }),
}));

const mockedApiFetch = vi.mocked(apiFetch);

const site = {
  id: "site-1",
  name: "Matriz",
  description: null,
  address: null,
  asset_count: 2,
  created_at: "",
  updated_at: "",
};

describe("TopologyPage", () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockedApiFetch.mockImplementation(async (path: unknown) => {
      const p = String(path);
      if (p.startsWith("/sites")) return [site];
      if (p.startsWith("/topology")) {
        return {
          nodes: [
            { id: "a1", name: "core-sw", status: "up", ip: "10.0.0.1", last_rtt_ms: 1.1, site: "Matriz", has_photo: false },
            { id: "a2", name: "ap-1", status: "warning", ip: "10.0.0.2", last_rtt_ms: 4.2, site: "Matriz", has_photo: false },
          ],
          edges: [{ id: "e1", source_asset_id: "a1", target_asset_id: "a2", link_type: "connection", created_at: "" }],
        };
      }
      throw new Error(`chamada inesperada: ${p}`);
    });
  });

  it("carrega o site e busca a topologia sem quebrar a renderização", async () => {
    renderWithProviders(<TopologyPage />);

    expect(await screen.findByText("Topologia")).toBeInTheDocument();
    expect(await screen.findByPlaceholderText(/buscar ativo/i)).toBeInTheDocument();

    // viewer não vê o botão de editar topologia.
    expect(screen.queryByRole("button", { name: /editar topologia/i })).not.toBeInTheDocument();
  });

  it("modo Flat recolhe netos por padrão, e a busca os revela", async () => {
    mockedApiFetch.mockImplementation(async (path: unknown) => {
      const p = String(path);
      if (p.startsWith("/sites")) return [site];
      if (p.startsWith("/topology")) {
        return {
          nodes: [
            { id: "a1", name: "pop-raiz", status: "up", ip: "10.0.0.1", last_rtt_ms: 1, site: "Matriz", has_photo: false },
            { id: "a2", name: "sw-meio", status: "up", ip: "10.0.0.2", last_rtt_ms: 1, site: "Matriz", has_photo: false },
            { id: "a3", name: "ap-neto", status: "up", ip: "10.0.0.3", last_rtt_ms: 1, site: "Matriz", has_photo: false },
          ],
          edges: [
            { id: "e1", source_asset_id: "a1", target_asset_id: "a2", link_type: "parent", created_at: "" },
            { id: "e2", source_asset_id: "a2", target_asset_id: "a3", link_type: "parent", created_at: "" },
          ],
        };
      }
      throw new Error(`chamada inesperada: ${p}`);
    });

    renderWithProviders(<TopologyPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Flat" }));

    await waitFor(() => expect(screen.getByText("sw-meio")).toBeInTheDocument());
    expect(screen.queryByText("ap-neto")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/buscar ativo/i), { target: { value: "ap-neto" } });

    await waitFor(() => expect(screen.getByText("ap-neto")).toBeInTheDocument());
  });

  it("mostra o estado vazio quando o site não tem ativos", async () => {
    mockedApiFetch.mockImplementation(async (path: unknown) => {
      const p = String(path);
      if (p.startsWith("/sites")) return [site];
      if (p.startsWith("/topology")) return { nodes: [], edges: [] };
      throw new Error(`chamada inesperada: ${p}`);
    });

    renderWithProviders(<TopologyPage />);

    expect(await screen.findByText(/nenhum ativo neste site ainda/i)).toBeInTheDocument();
  });
});
