# Studio V3 API image.
# Development builds: docker build -t lugobots/studio-v3-api:latest .
#   (VERSION defaults to "dev" in the binary.)
# Release builds: inject and tag the same GitHub version tag string, e.g.
#   docker build --build-arg VERSION=v0.2.0 -t lugobots/studio-v3-api:v0.2.0 .
# Electron starts this container with command `api`
# (see src/main/services/docker/args.js), mounts the bot at /home/coder/project,
# and sets LUGO_STUDIO_API_PORT / LUGO_HOST_PROJECT_PATH.

FROM golang:1.24-alpine AS build

ARG VERSION=dev

RUN apk add --no-cache git ca-certificates

WORKDIR /src
COPY api/ ./
# Use vendored modules so the image build does not need GitHub auth for private deps.
# VERSION is injected into buildinfo.Version (default "dev") for GET /api/health.
RUN CGO_ENABLED=0 GOOS=linux go build -mod=vendor \
  -ldflags="-w -s -X studio-v3/api/internal/buildinfo.Version=${VERSION}" \
  -o /out/studio-v3-api ./cmd/api

# Debian (glibc) runtime so `pip install` can use manylinux wheels for pinned
# bot deps (grpcio/lugo4py). Alpine/musl forces a source build that fails.
FROM debian:bookworm-slim

# Player bots prepare/start inside this container (python3 -m venv / go build / npm).
# Keep these toolchains in the runtime image; do not rely on host or Studio V2 venvs.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    python3-pip \
    python3-venv \
    python3-virtualenv \
    golang-go \
    nodejs \
    npm \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /home/coder/project

COPY --from=build /out/studio-v3-api /usr/local/bin/studio-v3-api
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV LUGO_STUDIO_API_PORT=8081 \
    LUGO_STUDIO_GAME_SERVER_PORT=5000 \
    LUGO_STUDIO_GAME_FRONTEND_PORT=8080 \
    BOT_SOURCE_PATH=/home/coder/project

EXPOSE 8081 5000 8080

WORKDIR /home/coder/project

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["api"]
