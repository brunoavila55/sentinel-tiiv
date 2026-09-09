FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN chmod +x entrypoint.sh

# Não precisa de nenhuma capability especial (ao contrário do worker, que
# precisa de NET_RAW pra ICMP) — não há motivo pra rodar como root.
RUN useradd --create-home --shell /usr/sbin/nologin backend
USER backend

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
