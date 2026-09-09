#!/bin/sh
set -e

alembic upgrade head

# --reload só em dev: recarrega a cada mudança de arquivo (montado via bind
# mount). Em produção a imagem é imutável e --reload só consumiria recursos
# à toa observando um filesystem que nunca muda.
if [ "$APP_ENV" = "development" ]; then
	exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
else
	exec uvicorn app.main:app --host 0.0.0.0 --port 8000
fi
