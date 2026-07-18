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
COPY --from=bot-deps /bot/node_modules /app/node_modules
COPY services/discord-bot/package.json /app/package.json
COPY services/discord-bot/src /app/src
COPY services/discord-bot/db /app/db
RUN mkdir -p /app/data
ENV MCP_SERVER_COMMAND=/app/bin/tibia-mcp MCP_SERVER_CWD=/app/data NODE_ENV=production
CMD ["npx", "tsx", "src/main.ts"]
