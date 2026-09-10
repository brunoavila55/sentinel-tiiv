#!/usr/bin/env bash
# Rollback de produção: volta o Caddy pro slot anterior. Não builda nada —
# só religa (sem rebuild) o slot que o último prod-deploy.sh parou e
# reaponta o tráfego pra ele. Disparado manualmente via
# .github/workflows/rollback-production.yml (workflow_dispatch).
#
# Só funciona enquanto o slot antigo ainda não foi sobrescrito por um novo
# deploy — cada deploy novo reaproveita justamente esse slot parado.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
source deploy/lib.sh

ACTIVE_SLOT="$(current_slot)"
ROLLBACK_SLOT="$(other_slot "$ACTIVE_SLOT")"
echo "Slot ativo atual: $ACTIVE_SLOT — rollback vai reativar: $ROLLBACK_SLOT"

APP_COMPOSE="docker compose -f docker-compose.prod.app.yml -p sentinel-$ROLLBACK_SLOT --env-file .env.production"

echo "Religando o slot $ROLLBACK_SLOT (sem rebuild)..."
SLOT="$ROLLBACK_SLOT" $APP_COMPOSE start

echo "Esperando o backend do slot $ROLLBACK_SLOT ficar saudável..."
for _ in $(seq 1 30); do
	status="$(docker inspect -f '{{.State.Health.Status}}' "backend-$ROLLBACK_SLOT" 2>/dev/null || echo "starting")"
	[ "$status" = "healthy" ] && break
	sleep 2
done
if [ "$status" != "healthy" ]; then
	echo "Slot $ROLLBACK_SLOT não ficou saudável a tempo — rollback abortado, Caddy continua no slot $ACTIVE_SLOT." >&2
	exit 1
fi

echo "Trocando Caddy de volta para o slot $ROLLBACK_SLOT..."
switch_caddy_to "$ROLLBACK_SLOT"

echo "Parando o slot $ACTIVE_SLOT."
SLOT="$ACTIVE_SLOT" docker compose -f docker-compose.prod.app.yml -p "sentinel-$ACTIVE_SLOT" --env-file .env.production stop

echo "Rollback concluído. Slot ativo: $ROLLBACK_SLOT."
