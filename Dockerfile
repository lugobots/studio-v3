# Studio V3 API image (tag: lugobots/studio-v3-api:latest).
# Electron starts this container with command `api`
# (see src/main/services/docker/args.js), mounts the bot at /home/coder/project,
# and sets LUGO_STUDIO_API_PORT / LUGO_HOST_PROJECT_PATH.

FROM golang:1.24-alpine AS build

RUN apk add --no-cache git ca-certificates

WORKDIR /src
COPY api/ ./
# Use vendored modules so the image build does not need GitHub auth for private deps.
RUN CGO_ENABLED=0 GOOS=linux go build -mod=vendor -ldflags="-w -s" -o /out/studio-v3-api ./cmd/api

FROM alpine:3.20

RUN mkdir -p /home/coder/project

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
