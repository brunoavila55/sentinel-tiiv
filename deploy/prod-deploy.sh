#!/usr/bin/env bash
# Deploy blue-green de produção. Roda no servidor (via SSH, disparado pelo
# workflow .github/workflows/deploy-production.yml), a partir do checkout
# dedicado ao branch master.
#
# Fluxo: builda e sobe o slot INATIVO com o código novo, espera ele ficar
# saudável (a própria imagem roda `alembic upgrade head` no entrypoint —
# ver backend/entrypoint.sh), só então troca o Caddy pra ele, e para (sem
# remover) o slot antigo — pronto pra rollback instantâneo.
#
# Postgres e MinIO são únicos e compartilhados (docker-compose.prod.shared.yml)
# — nunca duplicados entre os slots.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
source deploy/lib.sh

git fetch origin master
git reset --hard origin/master

OLD_SLOT="$(current_slot)"
NEW_SLOT="$(other_slot "$OLD_SLOT")"
echo "Slot ativo atual: $OLD_SLOT — deploy vai pro slot: $NEW_SLOT"

# Garante que a camada compartilhada (Postgres, MinIO, Caddy) está de pé.
# Idempotente: se já estiver rodando, não faz nada.
$SHARED_COMPOSE up -d

APP_COMPOSE="docker compose -f docker-compose.prod.app.yml -p sentinel-$NEW_SLOT --env-file .env.production"

# --wait bloqueia até backend/worker/frontend ficarem "healthy" (o
# healthcheck do backend só passa depois que `alembic upgrade head` e o
# uvicorn sobem — ver backend/entrypoint.sh; o do frontend confirma que o
# nginx já está respondendo) ou falha o script antes de qualquer coisa
# tocar no Caddy. O slot antigo continua servindo tráfego o tempo todo.
SLOT="$NEW_SLOT" $APP_COMPOSE up -d --build --wait

echo "Slot $NEW_SLOT saudável. Trocando Caddy para o slot $NEW_SLOT..."
switch_caddy_to "$NEW_SLOT"

echo "Parando (sem remover) o slot antigo ($OLD_SLOT) — mantido para rollback."
# SLOT precisa estar setado mesmo só pra parar: o compose interpola
# container_name a partir dele. No primeiro deploy do servidor não existe
# "sentinel-$OLD_SLOT" ainda — o `|| true` cobre esse caso.
SLOT="$OLD_SLOT" docker compose -f docker-compose.prod.app.yml -p "sentinel-$OLD_SLOT" stop || true

echo "Deploy concluído. Slot ativo: $NEW_SLOT."
