import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  return (
    <AuthShell>
      <form onSubmit={handleSubmit} className="w-full space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
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
          <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="space-y-1">
          <label htmlFor="organization_name" className="text-sm font-medium">
            Nome da organização
          </label>
          <Input
            id="organization_name"
            required
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">
            Senha
          </label>
          <Input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Mínimo de 8 caracteres.</p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Criando..." : "Criar conta"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          Já tem conta?{" "}
          <Link to="/login" className="text-foreground underline underline-offset-2">
            Entrar
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
