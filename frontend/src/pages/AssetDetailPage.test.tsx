import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api";
import { AssetDetailPage } from "@/pages/AssetDetailPage";
import { renderWithRoute } from "@/test/test-utils";

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

const asset = {
  id: "asset-1",
  name: "sw-core",
  hostname: null,
  ip_address: "10.0.0.1",
  description: "Switch principal do CPD",
  backup_notes: null,
  site_id: "site-1",
  site_name: "Matriz",
  enabled: true,
  status: "down",
  last_rtt_ms: null,
  packet_loss: 100,
  last_check_at: "2026-01-01T00:00:00Z",
  status_since: "2026-01-01T00:00:00Z",
  checks_count: 1,
  photos_count: 0,
  created_at: "",
  updated_at: "",
};

describe("AssetDetailPage", () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockedApiFetch.mockImplementation(async (path: unknown) => {
      const p = String(path);
      if (p === "/assets/asset-1") return asset;
      if (p.includes("/history")) return [];
      if (p.includes("/photos")) return [];
      if (p.includes("/checks")) return [];
      throw new Error(`chamada inesperada: ${p}`);
    });
  });

  it("mostra nome, status e descrição do ativo carregado pela URL", async () => {
    renderWithRoute(<AssetDetailPage />, "/assets/:assetId", "/assets/asset-1");

    expect(await screen.findByText("sw-core")).toBeInTheDocument();
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getByText("Switch principal do CPD")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.1 · Matriz")).toBeInTheDocument();
  });

  it("não mostra ações de edição para role viewer", async () => {
    renderWithRoute(<AssetDetailPage />, "/assets/:assetId", "/assets/asset-1");

    await screen.findByText("sw-core");
    expect(screen.queryByRole("button", { name: /editar ativo/i })).not.toBeInTheDocument();
  });
});
