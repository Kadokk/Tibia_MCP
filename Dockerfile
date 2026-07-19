# Stage 1: build the C++ MCP server
FROM debian:bookworm AS cpp-build
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git ca-certificates libcurl4-openssl-dev libsqlite3-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY CMakeLists.txt ./
COPY src ./src
COPY tests ./tests
# -j2, not -j: unbounded parallel g++ exhausts memory on small hosts (seen live:
# "cannot allocate memory" in the Docker Desktop VM; deploy.md's 1 GB VPS warning)
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build --target tibia-mcp -j2

# Stage 1b: fetch libcurl-impersonate (Chrome TLS fingerprint) — tibia.com's
# Cloudflare tier 403s vanilla libcurl at the TLS-fingerprint level (any UA);
# chrome116 impersonation is the proven fix (beta checklist Task 5, 2026-07-17).
FROM debian:bookworm AS curl-impersonate
ADD https://github.com/lwthiker/curl-impersonate/releases/download/v0.6.1/libcurl-impersonate-v0.6.1.x86_64-linux-gnu.tar.gz /tmp/ci.tar.gz
RUN mkdir -p /opt/curl-impersonate && tar -xzf /tmp/ci.tar.gz -C /opt/curl-impersonate

# Stage 2: install bot dependencies
FROM node:22-bookworm-slim AS bot-deps
WORKDIR /bot
COPY services/discord-bot/package*.json ./
RUN npm ci

# Stage 3: runtime — run TS directly via tsx (matches the dev script)
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libcurl4 libsqlite3-0 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=cpp-build /src/build/tibia-mcp /app/bin/tibia-mcp
COPY --from=curl-impersonate /opt/curl-impersonate/ /usr/local/lib/curl-impersonate/
COPY --from=bot-deps /bot/node_modules /app/node_modules
COPY services/discord-bot/package.json /app/package.json
COPY services/discord-bot/src /app/src
COPY services/discord-bot/db /app/db
RUN mkdir -p /app/data
# LD_PRELOAD is scoped to the MCP binary via this wrapper — node never loads the
# impersonation lib (it doesn't link libcurl). client.cpp skips its own UA when
# CURL_IMPERSONATE is set so the chrome116 profile owns the full fingerprint.
RUN printf '#!/bin/sh\nexport CURL_IMPERSONATE=chrome116\nexport LD_PRELOAD=/usr/local/lib/curl-impersonate/libcurl-impersonate-chrome.so\nexec /app/bin/tibia-mcp "$@"\n' > /app/bin/tibia-mcp-impersonate \
    && chmod +x /app/bin/tibia-mcp-impersonate
ENV MCP_SERVER_COMMAND=/app/bin/tibia-mcp-impersonate MCP_SERVER_CWD=/app/data NODE_ENV=production
CMD ["npx", "tsx", "src/main.ts"]
