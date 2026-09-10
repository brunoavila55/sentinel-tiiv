#!/usr/bin/env bash
# Deploy de staging: stack única, sem blue/green. Roda no servidor (via
# SSH, disparado por .github/workflows/deploy-staging.yml), a partir do
# checkout dedicado ao branch staging.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

git fetch origin staging
git reset --hard origin/staging

docker compose -f docker-compose.staging.yml -p sentinel-staging --env-file .env.staging up -d --build --wait

echo "Deploy de staging concluído."
