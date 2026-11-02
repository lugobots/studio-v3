# Studio V3 API image. Electron starts this container with command `api`
# (see src/main/services/docker/args.js), mounts the bot at /home/coder/project,
# and sets LUGO_STUDIO_API_PORT / LUGO_HOST_PROJECT_PATH.

FROM golang:1.22-alpine AS build

WORKDIR /src
COPY api/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /out/studio-v3-api ./cmd/api

FROM alpine:3.20

RUN mkdir -p /home/coder/project

COPY --from=build /out/studio-v3-api /usr/local/bin/studio-v3-api
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV LUGO_STUDIO_API_PORT=8081 \
    BOT_SOURCE_PATH=/home/coder/project

EXPOSE 8081

WORKDIR /home/coder/project

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["api"]
