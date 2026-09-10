# Funções compartilhadas por prod-deploy.sh e prod-rollback.sh. Não roda
# sozinho — é sourced pelos outros dois scripts.

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTIVE_SLOT_ENV="$REPO_DIR/deploy/active-slot.env"
SHARED_COMPOSE="docker compose -f docker-compose.prod.shared.yml --env-file .env.production"

# Lê o slot ativo a partir de BACKEND_UPSTREAM em active-slot.env (ex.:
# "backend-blue:8000" -> "blue"). Se o arquivo ainda não existir (primeiro
# deploy do servidor), assume "green" como ativo — o primeiro deploy real
# então vai preparar e promover o slot "blue".
current_slot() {
	if [ ! -f "$ACTIVE_SLOT_ENV" ]; then
		echo "green"
		return
	fi
	grep '^BACKEND_UPSTREAM=' "$ACTIVE_SLOT_ENV" | sed -E 's/^BACKEND_UPSTREAM=backend-([a-z]+):.*/\1/'
}

other_slot() {
	if [ "$1" = "blue" ]; then echo "green"; else echo "blue"; fi
}

# Reescreve active-slot.env apontando pro slot informado e recria só o
# container do Caddy pra pegar o novo upstream — sem rebuild, sem tocar em
# Postgres/MinIO/backend/worker/frontend.
switch_caddy_to() {
	local slot="$1"
	cd "$REPO_DIR"
	{
		echo "BACKEND_UPSTREAM=backend-${slot}:8000"
		echo "FRONTEND_UPSTREAM=frontend-${slot}:80"
	} >"$ACTIVE_SLOT_ENV"
	$SHARED_COMPOSE up -d --force-recreate caddy
}
