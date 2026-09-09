import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register(name, email, password, organizationName);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível criar a conta.");
    } finally {
      setLoading(false);
    }
  }

  const fieldClass =
    "w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-md border border-border p-6">
        <div>
          <h1 className="text-lg font-semibold">Criar organização</h1>
          <p className="text-sm text-muted-foreground">
            Cria sua conta e uma organização nova, com você como owner.
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor="name" className="text-sm font-medium">
            Seu nome
          </label>
          <input id="name" required value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} />
        </div>

        <div className="space-y-1">
          <label htmlFor="organization_name" className="text-sm font-medium">
            Nome da organização
          </label>
          <input
            id="organization_name"
            required
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
            className={fieldClass}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={fieldClass}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">
            Senha
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={fieldClass}
          />
          <p className="text-xs text-muted-foreground">Mínimo de 8 caracteres.</p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Criando..." : "Criar conta"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          Já tem conta?{" "}
          <Link to="/login" className="underline underline-offset-2">
            Entrar
          </Link>
        </p>
      </form>
    </main>
  );
}
