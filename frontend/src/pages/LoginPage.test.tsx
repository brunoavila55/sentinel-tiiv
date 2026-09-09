import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { LoginPage } from "@/pages/LoginPage";

const loginMock = vi.fn();

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ login: loginMock }),
}));

function renderLoginPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    loginMock.mockReset();
  });

  it("envia email e senha digitados para login()", async () => {
    loginMock.mockResolvedValueOnce(undefined);
    renderLoginPage();

    await userEvent.type(screen.getByLabelText(/^email$/i), "ana@example.com");
    await userEvent.type(screen.getByLabelText(/senha/i), "senha12345");
    await userEvent.click(screen.getByRole("button", { name: /entrar/i }));

    expect(loginMock).toHaveBeenCalledWith("ana@example.com", "senha12345");
  });

  it("mostra a mensagem de erro da API quando o login falha", async () => {
    loginMock.mockRejectedValueOnce(new ApiError(401, { detail: "Email ou senha inválidos" }));
    renderLoginPage();

    await userEvent.type(screen.getByLabelText(/^email$/i), "ana@example.com");
    await userEvent.type(screen.getByLabelText(/senha/i), "senha-errada");
    await userEvent.click(screen.getByRole("button", { name: /entrar/i }));

    expect(await screen.findByText("Email ou senha inválidos")).toBeInTheDocument();
  });

  it("tem um link para a página de registro", () => {
    renderLoginPage();
    expect(screen.getByRole("link", { name: /criar organização/i })).toHaveAttribute("href", "/register");
  });
});
