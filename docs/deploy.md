# TibiaEdge — Deploy Runbook

How to run the TibiaEdge Discord bot and its bundled C++ MCP server in production
with Docker Compose. Phase 1 has no public HTTP surface — the bot only makes
outbound connections (Discord, the Anthropic API, TibiaData, the wiki), so no
reverse proxy or inbound ports are required.

The Compose stack is two services:

- **bot** — the Discord bot (Node/`tsx`) plus the `tibia-mcp` binary it spawns.
- **db** — Postgres 16, storing per-user quota/spend state on the `pg-data` volume.

The MCP server's own SQLite scrape cache lives on the `mcp-cache` volume.

## 1. VPS requirements

A small VPS is enough for a private beta:

- ~1 vCPU, 1 GB RAM, ~10 GB disk (roughly $6–8/mo — e.g. a Hetzner CX22, a
  DigitalOcean/Vultr/Linode $6 droplet).
- Debian 12 or Ubuntu 22.04/24.04 (any 64-bit Linux Docker supports).

The image build compiles the C++ server; on a 1 GB box that build works but is not
fast. If the build is memory-starved, either add a swapfile or build the image on a
larger machine and push it to a registry.

## 2. Install Docker + Compose

Use Docker's official convenience script, which includes the Compose v2 plugin:

```bash
curl -fsSL https://get.docker.com | sh
docker --version
docker compose version   # confirm the Compose v2 plugin is present
```

Optionally allow your non-root user to run Docker without `sudo`:

```bash
sudo usermod -aG docker "$USER"   # log out and back in for this to take effect
```

## 3. Clone the repo

```bash
git clone <your-fork-or-repo-url> tibiaedge
cd tibiaedge
```

All remaining commands are run **from the repo root** (the directory that contains
`docker-compose.yml`).

## 4. Configure `.env` (must live at the repo root)

Compose reads a single `.env` file **beside `docker-compose.yml` at the repo root**.
That one file does double duty: it is injected into the bot container (`env_file:`)
**and** it supplies the `${POSTGRES_PASSWORD}` value Compose interpolates into the
compose file. The template ships under `services/discord-bot/`, so copy it up to the
repo root:

```bash
cp services/discord-bot/.env.example .env
```

Then edit `.env` and fill in every value. The file is gitignored — it never gets
committed.

| Variable | Required | What it is |
|---|---|---|
| `DISCORD_TOKEN` | yes | Bot token from the Discord Developer Portal (Bot → Reset Token). |
| `DISCORD_CLIENT_ID` | yes | Your application's Client ID (Discord Developer Portal → General Information). |
| `DISCORD_GUILD_ID` | optional | A single guild (server) ID. If set, slash commands register instantly to that one guild — handy for a test server. Leave blank to register commands globally (can take up to an hour to propagate). |
| `DATABASE_URL` | see note | Postgres connection string. **Under Compose you can leave the template value as-is** — the compose file overrides `DATABASE_URL` to `postgres://tibiaedge:${POSTGRES_PASSWORD}@db:5432/tibiaedge` automatically. This line only matters for local, non-Docker development. |
| `POSTGRES_PASSWORD` | yes | Password for the bundled Postgres. Compose uses it to initialize the `db` container **and** to build the bot's `DATABASE_URL` override. Pick a strong value, e.g. `openssl rand -hex 24`. |
| `NODE_ENV` | optional | `development`, `test`, or `production`. Not read for runtime behavior, but set it to `production` on a deploy for accuracy. (The image already defaults to `production`; a value here overrides that, so if you copied the template, change `development` → `production`.) |
| `ANTHROPIC_API_KEY` | yes | Anthropic API key for the `/ask` agent. |
| `ANTHROPIC_MODEL` | optional | Model id for the agent. Defaults to `claude-haiku-4-5`. |
| `MCP_SERVER_COMMAND` | leave as-is | Path to the `tibia-mcp` binary. The template value `/app/bin/tibia-mcp` matches the container layout — don't change it for Docker. |
| `MCP_SERVER_CWD` | leave as-is | Working directory for the MCP server's SQLite cache. `/app/data` maps to the `mcp-cache` volume — don't change it for Docker. |
| `AI_DAILY_SPEND_CAP_USD` | optional | Daily Anthropic spend circuit breaker (see §8). Defaults to `0.7`. |
| `TIBIADATA_BASE_URL` | optional | TibiaData API base URL. Defaults to `https://api.tibiadata.com`. |

> Note: `env_file` injects the whole `.env` into the bot container, including
> `POSTGRES_PASSWORD`. That's harmless — the bot's config validator ignores keys it
> doesn't recognize.

## 5. Launch

```bash
docker compose build      # first run compiles the C++ server — this takes a while
docker compose up -d
```

Follow the bot's startup and confirm it comes up cleanly:

```bash
docker compose logs -f bot
```

Expected log order: **migrations applied → commands registered → "TibiaEdge Discord
bot ready"**. Then, in a server the bot has joined, exercise it end-to-end:

```
/boosted
/ask what is a dragon?
```

## 5b. One token, ONE bot — kill old stacks

Two bot processes sharing the same `DISCORD_TOKEN` split-brain silently: Discord
delivers each slash command to whichever gateway session it likes, so users see a
random mix of correct answers, "Unknown command" errors (from a process with an
older command registry), and "Application did not respond" timeouts.

This happened live on 2026-07-18: an old dress-rehearsal Compose stack
(`tibiaedge-phase0`) still had containers with `restart: unless-stopped`, and a
Docker daemon restart resurrected it alongside the current stack. Before any
deploy — and after any daemon restart — confirm exactly one bot is running:

```bash
docker ps --format '{{.Names}}\t{{.Status}}' | grep bot   # expect ONE line
docker compose -p <old-project> down                      # removes zombie containers for good
```

`docker stop` is not enough (the container survives and auto-restarts with the
daemon); `compose -p <project> down` deletes the containers.

## 6. Updating

From the repo root:

```bash
git pull
docker compose build
docker compose up -d
```

Compose recreates only what changed. Database migrations run automatically on bot
startup, so a normal update needs no manual DB step. The named volumes (`pg-data`,
`mcp-cache`) persist across rebuilds, so no data is lost.

## 7. Backups

Persistent state lives in the **`pg-data`** Docker volume (Postgres). The
`mcp-cache` volume is a rebuildable scrape cache and does not need backing up.

Take a logical dump with `pg_dump` run inside the `db` container:

```bash
docker compose exec -T db pg_dump -U tibiaedge tibiaedge > backup-$(date +%F).sql
```

A simple nightly cron on the host (writes a dated dump to `~/tibiaedge-backups`,
keeping it off the Docker volume):

```cron
# m h  dom mon dow   command  (runs at 03:30 daily, from the repo root)
30 3 * * * cd /path/to/tibiaedge && docker compose exec -T db pg_dump -U tibiaedge tibiaedge > "$HOME/tibiaedge-backups/tibiaedge-$(date +\%F).sql" 2>> "$HOME/tibiaedge-backups/backup.log"
```

Create the target directory first (`mkdir -p ~/tibiaedge-backups`), and prune old
dumps periodically. Restore into a running stack with:

```bash
docker compose exec -T db psql -U tibiaedge tibiaedge < backup-YYYY-MM-DD.sql
```

## 8. Spend-cap knob (`AI_DAILY_SPEND_CAP_USD`)

`AI_DAILY_SPEND_CAP_USD` is the daily Anthropic-spend circuit breaker for `/ask`.
When the day's estimated spend crosses this cap, the bot stops answering free-tier
`/ask` questions and returns a "free capacity used up" message until the next day.
It defaults to `0.7` (USD/day). Raise or lower it in `.env` and apply with:

```bash
docker compose up -d   # picks up the new env_file value on the next recreate
```

Set it deliberately: it is the primary guardrail against a surprise API bill during
the beta.
