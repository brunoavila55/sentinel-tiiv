import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api";
import { AssetsPage } from "@/pages/AssetsPage";
import { renderWithProviders } from "@/test/test-utils";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    currentOrganizationId: "org-1",
    currentMembership: {
      organization_id: "org-1",
      organization_name: "Org",
      organization_slug: "org",
      role: "owner",
    },
  }),
}));

const mockedApiFetch = vi.mocked(apiFetch);

const site = {
  id: "site-1",
  name: "Matriz",
  description: null,
  address: null,
  asset_count: 1,
  created_at: "",
  updated_at: "",
};

const asset = {
  id: "asset-1",
  name: "sw-core",
  hostname: null,
  ip_address: "10.0.0.1",
  description: null,
  backup_notes: null,
  site_id: "site-1",
  site_name: "Matriz",
  enabled: true,
  status: "up",
  last_rtt_ms: 1.2,
  packet_loss: 0,
  last_check_at: null,
  status_since: null,
  checks_count: 0,
  photos_count: 0,
  created_at: "",
  updated_at: "",
};

function mockListEndpoints(items: (typeof asset)[]) {
  // Só cobre GET (path sem body) — chamadas de mutação (POST/PATCH/DELETE)
  // em testes que as disparam usam mockImplementationOnce antes desta,
  // que é consumido primeiro.
  mockedApiFetch.mockImplementation(async (path: unknown) => {
    const p = String(path);
    if (p.startsWith("/sites")) return [site];
    if (p.startsWith("/assets")) return { items, total: items.length, limit: 20, offset: 0 };
    throw new Error(`chamada inesperada: ${p}`);
  });
}

describe("AssetsPage", () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it("lista os ativos retornados pela API", async () => {
    mockListEndpoints([asset]);
    renderWithProviders(<AssetsPage />);

    expect(await screen.findByText("sw-core")).toBeInTheDocument();
    expect(screen.getAllByText("Matriz").length).toBeGreaterThan(0);
    expect(screen.getByText("10.0.0.1")).toBeInTheDocument();
  });

  it("mostra o empty state quando não há ativos", async () => {
    mockListEndpoints([]);
    renderWithProviders(<AssetsPage />);

    expect(await screen.findByText(/nenhum ativo encontrado/i)).toBeInTheDocument();
  });

  it("cria um ativo ao preencher e enviar o formulário", async () => {
    mockListEndpoints([]);
    renderWithProviders(<AssetsPage />);

    await screen.findByText(/nenhum ativo encontrado/i);

    await userEvent.click(screen.getByRole("button", { name: /novo ativo/i }));

    await userEvent.type(screen.getByLabelText(/^nome$/i), "sw-novo");
    await userEvent.type(screen.getByLabelText(/endereço ip/i), "10.0.0.9");

    mockedApiFetch.mockImplementationOnce(async () => ({ ...asset, id: "asset-2", name: "sw-novo" }));
    // depois do POST, a lista é invalidada e refeita.
    mockListEndpoints([{ ...asset, id: "asset-2", name: "sw-novo" }]);

    await userEvent.click(screen.getByRole("button", { name: /^criar ativo$/i }));

    await waitFor(() => {
      const postCall = mockedApiFetch.mock.calls.find(([path, options]) => {
        return String(path) === "/assets" && (options as RequestInit | undefined)?.method === "POST";
      });
      expect(postCall).toBeDefined();
    });
  });
});
