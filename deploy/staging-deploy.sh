#!/usr/bin/env bash
# Deploy de staging: stack única, sem blue/green. Roda no servidor (via
# SSH, disparado por .github/workflows/deploy-staging.yml), a partir do
# checkout dedicado ao branch staging.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

git fetch origin staging
git reset --hard origin/staging

COMPOSE="docker compose -f docker-compose.staging.yml -p sentinel-staging --env-file .env.staging"

# minio-init é one-shot (roda e sai com código 0) — misturado num "up --wait"
# junto dos serviços de vida longa, o --wait interpreta a saída dele como
# falha e derruba o script mesmo com tudo saudável. Por isso ele roda à
# parte, até completar, antes do --wait dos serviços de verdade.
$COMPOSE up -d --build postgres minio
$COMPOSE up --build minio-init
$COMPOSE up -d --build --wait backend worker frontend caddy

echo "Deploy de staging concluído."
