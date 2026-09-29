# MinIO compilado a partir do código-fonte oficial (github.com/minio/minio e
# github.com/minio/mc, AGPL-3.0).
#
# Por que não usar uma imagem pronta: a MinIO parou de publicar imagens
# públicas — minio/minio e minio/mc no Docker Hub e quay.io/minio/* passaram
# a responder "pull access denied"/401, o que quebrava CI e deploy. O
# repositório oficial está arquivado, mas as tags de release continuam lá.
# Cada tag é fixada também pelo SHA do commit: se a tag for reescrita, o
# build falha em vez de compilar outra coisa.
#
# Uma única imagem para os dois papéis: o serviço "minio" roda o servidor, o
# "minio-init" usa o mc (entrypoint /bin/sh) pra criar o bucket.

FROM golang:1.24-alpine AS build

RUN apk add --no-cache git

ARG MINIO_TAG=RELEASE.2025-10-15T17-29-55Z
ARG MINIO_SHA=9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a
ARG MC_TAG=RELEASE.2025-08-13T08-35-41Z
ARG MC_SHA=7394ce0dd2a80935aded936b09fa12cbb3cb8096

ENV CGO_ENABLED=0 GOTOOLCHAIN=auto

# As ldflags -X são as mesmas que o buildscripts/gen-ldflags.go oficial
# injeta — sem elas o binário se identifica como "DEVELOPMENT.GOGET".
# Version é o timestamp da tag em RFC3339:
# RELEASE.2025-10-15T17-29-55Z -> 2025-10-15T17:29:55Z.
RUN git clone --depth 1 --branch "$MINIO_TAG" https://github.com/minio/minio /src/minio \
    && cd /src/minio \
    && test "$(git rev-parse HEAD)" = "$MINIO_SHA" \
    && P=github.com/minio/minio/cmd \
    && VER=$(echo "${MINIO_TAG#RELEASE.}" | sed -E 's/T(..)-(..)-(..)Z/T\1:\2:\3Z/') \
    && go build -trimpath -o /out/minio -ldflags "-s -w \
        -X $P.Version=$VER -X $P.ReleaseTag=$MINIO_TAG \
        -X $P.CommitID=$MINIO_SHA -X $P.ShortCommitID=$(echo $MINIO_SHA | cut -c1-12)" .

RUN git clone --depth 1 --branch "$MC_TAG" https://github.com/minio/mc /src/mc \
    && cd /src/mc \
    && test "$(git rev-parse HEAD)" = "$MC_SHA" \
    && P=github.com/minio/mc/cmd \
    && VER=$(echo "${MC_TAG#RELEASE.}" | sed -E 's/T(..)-(..)-(..)Z/T\1:\2:\3Z/') \
    && go build -trimpath -o /out/mc -ldflags "-s -w \
        -X $P.Version=$VER -X $P.ReleaseTag=$MC_TAG \
        -X $P.CommitID=$MC_SHA -X $P.ShortCommitID=$(echo $MC_SHA | cut -c1-12)" .

FROM alpine:3.22

# curl: healthcheck dos compose (/minio/health/live).
RUN apk add --no-cache ca-certificates curl

COPY --from=build /out/minio /out/mc /usr/bin/

EXPOSE 9000 9001
VOLUME ["/data"]

# Roda como root, igual à imagem oficial que substitui — os volumes
# existentes foram criados com esse dono.
ENTRYPOINT ["minio"]
CMD ["server", "/data"]
