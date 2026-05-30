# TibiaEdge Discord Bot — Design Spec

## Project overview

TibiaEdge is an installable Discord bot for Tibia market intelligence. Any Discord server can invite it, configure a market-alert channel, and receive real-time item and Bazaar intelligence.

The product goal is to help players make better market decisions without automating gameplay. TibiaEdge provides analytics, alerts, reports, and AI-assisted explanations. It does not control the Tibia client, automate play, bypass anti-cheat, read client memory, or perform unattended actions.

Working positioning:

> TibiaEdge is a real-time Tibia market intelligence bot for Discord. It helps players monitor prices, find possible deals, and evaluate Bazaar auctions without automating gameplay.

Core product promise:

> Invite TibiaEdge to your Discord and get real-time alerts when Tibia items or Bazaar characters look underpriced.

## MVP scope

The MVP validates whether players and guilds will pay for real-time Tibia market and Bazaar intelligence inside Discord.

Initial scope:

- Discord bot first; no web dashboard in MVP.
- Installable by external Discord servers.
- Antica as the first supported world.
- Real-time data for all tiers.
- Usage, alert count, AI, and delivery limits by tier.
- Manual paid-beta tier assignment; no Stripe in MVP.
- Cautious opportunity language: possible deal, strong candidate, needs manual review.

MVP modules:

1. Item Market
   - price lookups
   - recent offers
   - item threshold alerts
   - basic deal detection

2. Bazaar Scanner
   - auction lookup
   - Bazaar search/filtering
   - rule-based valuation score
   - Bazaar alerts

3. Daily Market Report
   - manual report for Free within limits
   - scheduled report for Guild Pro
   - deterministic ranked opportunities, optionally summarized by AI

4. AI Q&A
   - natural-language market questions grounded in collected data
   - no fabricated prices
   - no gameplay automation guidance

## Non-goals

The MVP intentionally excludes:

- gameplay automation
- client control
- anti-cheat bypassing
- memory reading or injection
- packet manipulation for player advantage
- full billing automation
- Stripe integration
- public API
- web dashboard
- mobile app
- browser extension
- all worlds
- advanced ML valuation
- guild hunt/loot tracking
- guaranteed profit or investment claims

## Product tiers

All tiers receive real-time data. Paid tiers unlock more usage, more alerts, richer analysis, private delivery, and AI access.

### Free

For casual users and new servers testing the bot.

Capabilities:

- real-time `/price`
- real-time `/offers` with limited result count
- basic `/bazaar auction` preview
- 1 item alert
- 1 Bazaar alert
- server-channel alerts only
- limited manual `/daily-report`
- no AI Q&A or a very small monthly AI quota

Suggested limits:

- 10 commands/day per user
- 1 item alert
- 1 Bazaar alert
- `/offers` returns up to 5 recent offers
- `/price` shows 7-day summary
- `/daily-report` limited to 1 manual report/day per guild
- `/ask` disabled initially or limited to 3 questions/month

### Pro

For individual traders, flippers, and Bazaar watchers.

Capabilities:

- higher command limits
- more item alerts
- more Bazaar alerts
- DM alerts
- `/deals`
- `/bazaar deals`
- richer price summaries/history
- AI Q&A
- detailed Bazaar score breakdowns

Suggested limits:

- 200 commands/day per user
- 25 item alerts
- 10 Bazaar alerts
- `/offers` returns up to 25 recent offers
- `/price` shows 30-day summary
- `/ask` limited to 50 questions/month

Delivery:

- Pro users may choose server channel, DM, or both.
- Default personal alert delivery is DM.
- If DMs fail, fallback to server channel only if explicitly allowed.

### Guild Pro

For Discord servers, guilds, teams, and market communities.

Capabilities:

- server-wide shared alerts
- shared watchlists
- configurable alert/report channels
- automatic daily reports
- higher server-level limits
- multiple users
- role-gated access later

Suggested limits:

- 2,000 commands/day per guild
- 100 shared item alerts
- 50 shared Bazaar alerts
- 300 AI questions/month shared
- automatic daily report
- 25 member seats initially, or unlimited with fair-use limits

Delivery:

- Server channels by default.
- Guild admins configure channels such as `#market-alerts`, `#bazaar-alerts`, and `#daily-reports`.
- Individual Pro users inside a Guild Pro server may still receive DMs if they have personal Pro.

### Admin / Owner

For the product operator only.

Capabilities:

- set guild tier
- set user tier
- disable guild/user
- inspect usage
- test alert delivery
- force daily report
- check collector freshness and worker health

## Discord commands

### `/setup`

Configure a Discord server after install.

Example:

```text
/setup world:Antica market_channel:#market-alerts bazaar_channel:#bazaar-alerts report_channel:#daily-report
```

Behavior:

- requires Manage Server permission
- stores guild config
- sets default world
- validates that the bot can post in selected channels
- posts confirmation

### `/price`

Example:

```text
/price item:"gold token" world:Antica
```

Free response:

- latest observed price
- 7-day median sell/buy
- recent volume
- confidence level
- short caveat if data is thin

Pro/Guild response:

- 30-day summary
- buy/sell spread
- volume trend
- latest offers
- liquidity score
- suggested deal threshold

### `/offers`

Example:

```text
/offers item:"gold token" world:Antica since:24h
```

Free:

- up to 5 recent offers

Pro/Guild:

- up to 25 recent offers
- buy/sell filters
- optional min/max price filters

### `/alert item`

Example:

```text
/alert item:"gold token" world:Antica condition:below price:45000 delivery:dm
```

Free:

- 1 item alert
- server-channel delivery only

Pro:

- 25 item alerts
- DM/server/both delivery

### `/deals`

Example:

```text
/deals world:Antica category:runes
```

Free:

- disabled or top 3 only

Pro/Guild:

- ranked possible item flips
- score and confidence
- reason for each candidate

### `/bazaar auction`

Example:

```text
/bazaar auction id:123456789
```

Free:

- basic auction summary
- basic score
- upgrade CTA for detailed valuation

Pro/Guild:

- detailed valuation
- score breakdown
- comparable listings when available
- risk flags

### `/bazaar alert`

Example:

```text
/bazaar alert vocation:paladin min_level:400 max_price_tc:12000 world:Antica delivery:dm
```

Free:

- 1 Bazaar alert
- server-channel delivery only

Pro:

- 10 Bazaar alerts
- DM/server/both delivery
- richer filters

### `/bazaar deals`

Example:

```text
/bazaar deals vocation:knight min_level:300 max_price_tc:15000
```

Pro/Guild only.

### `/daily-report`

Example:

```text
/daily-report world:Antica
```

Free:

- 1 manual report/day per guild

Guild Pro:

- automatic scheduled report to configured channel

Report sections:

- possible item flips
- high-volume items
- notable price movement
- interesting Bazaar auctions
- rare/high-value sightings
- data freshness and confidence notes

### `/ask`

Example:

```text
/ask question:"Should I buy magic plate armor for 90k on Antica?"
```

Behavior:

- extracts structured intent
- retrieves market/Bazaar data through controlled services
- generates an answer grounded in retrieved data
- includes confidence and caveats
- refuses or redirects unsupported automation/botting questions

Allowed question types:

- what is this item worth?
- should I buy/sell this at a given price?
- what are good flips today?
- is this Bazaar auction interesting?
- summarize today's market

### `/usage`

Shows:

- current tier
- commands used today
- active item alerts
- active Bazaar alerts
- AI questions remaining
- upgrade CTA when appropriate

### Admin commands

Examples:

```text
/admin set-guild-tier guild_id:<id> tier:guild_pro
/admin set-user-tier user_id:<id> tier:pro
/admin stats
/admin health
/admin test-alert
/admin force-report guild_id:<id>
/admin disable-guild guild_id:<id>
```

## Alert behavior

### Item alerts

An item alert fires when a newly parsed trade offer matches:

- world
- canonical item
- offer type
- price condition
- minimum parse confidence
- tier limits
- dedupe rules

Dedupe:

- same raw message should fire once per alert rule
- repeated identical offers should respect cooldowns
- delivery attempts are logged

Example alert:

```text
Deal alert: gold token on Antica
Seller: Trader Joe
Price: 43,000 gp
Your threshold: below 45,000 gp
Recent median: 48,500 gp
Confidence: Medium
Use /offers gold token Antica for context.
```

### Bazaar alerts

A Bazaar alert fires when a new or updated auction matches filters and crosses scoring thresholds.

Dedupe:

- same auction should not repeat unless price/status/score materially changes
- per-alert cooldowns prevent spam

Example alert:

```text
Bazaar candidate: Level 430 Royal Paladin
Current bid: 9,500 TC
Reason: below expected range for level/vocation, 6h remaining
Confidence: Low/Medium — manual review recommended
Use /bazaar auction 123456789.
```

## Architecture

TibiaEdge should be a central hosted service with separate components.

### Components

1. Data collectors

Collect market-relevant Tibia data.

Sources:

- Trade-channel listener/parser from the existing Tibia-MCP project
- Bazaar scraper/snapshotter
- TibiaData API
- TibiaWiki/item registry data

Responsibilities:

- capture raw trade messages
- parse messages into structured offers
- snapshot Bazaar listings
- normalize item names
- store market data centrally

2. Central database

Recommended for public beta: Postgres.

The database stores both market data and Discord SaaS state, but those concepts remain separated by table/module boundaries.

3. Discord bot service

Responsibilities:

- register slash commands
- receive Discord interactions
- check tier/usage limits
- query backend services/database
- format responses
- deliver messages to channels or DMs
- handle guild setup

Slash commands should defer responses for slow operations.

4. Alert evaluator worker

Responsibilities:

- watch new trade offers and Bazaar auctions
- match them against alert rules
- apply tier limits, dedupe, and cooldowns
- send channel/DM alerts
- record delivery status

5. Daily report worker

Responsibilities:

- find due report configs
- compute ranked opportunities
- optionally ask AI to summarize
- post to configured Discord channels
- persist report output

6. AI Q&A service

Responsibilities:

- convert questions into structured market intents
- retrieve grounding data through controlled services
- generate answers with uncertainty and caveats
- refuse unsupported requests
- log usage

7. Admin interface

MVP admin interface is Discord admin commands. A web admin dashboard is deferred.

## Recommended stack

Existing C++ Tibia-MCP project:

- Tibia protocol/data collection
- trade listener
- parser
- TibiaData/TibiaWiki/Bazaar source logic
- MCP tools where useful

New Discord product layer:

- TypeScript
- discord.js
- Postgres
- worker processes for alerts/reports
- query layer using Prisma, Drizzle, or raw SQL

Recommended repository layout:

```text
services/discord-bot/
  src/
    commands/
    services/
    workers/
    db/
    config/
```

Key boundary:

- C++ owns Tibia-specific data collection/parsing.
- TypeScript owns Discord SaaS/product behavior.

## Data model

### Market data tables

`items`

- id
- canonical_name
- aliases
- category
- metadata_json
- created_at
- updated_at

`worlds`

- id
- name
- pvp_type
- location
- is_active

`trade_raw_messages`

- id
- world_id
- channel
- sender_name
- sender_level
- text
- received_at
- parsed_at
- parse_method
- parse_confidence
- source

`trade_offers`

- id
- raw_message_id
- world_id
- offer_type
- item_id nullable
- item_canonical
- item_raw
- quantity
- price_gold nullable
- sender_name
- sender_level
- offered_at
- parse_method
- confidence
- created_at

`price_aggregates`

- id
- item_id
- world_id
- window
- median_sell
- median_buy
- min_sell
- max_buy
- offer_count_sell
- offer_count_buy
- liquidity_score
- confidence_score
- computed_at

`bazaar_auctions`

- id
- auction_id
- character_name
- vocation
- level
- world
- current_bid_tc
- minimum_bid_tc
- auction_end
- status
- raw_json
- first_seen_at
- last_seen_at

`bazaar_scores`

- id
- auction_id
- score
- confidence
- expected_range_low_tc
- expected_range_high_tc
- reasons_json
- computed_at

### Discord/SaaS tables

`discord_guilds`

- id
- discord_guild_id
- name
- default_world_id
- tier
- market_alert_channel_id
- bazaar_alert_channel_id
- report_channel_id
- installed_at
- updated_at

`discord_users`

- id
- discord_user_id
- username
- tier
- created_at
- updated_at

`guild_members`

- id
- guild_id
- user_id
- roles_json
- first_seen_at
- last_seen_at

`usage_counters`

- id
- scope_type
- scope_id
- counter_type
- period_start
- period_end
- count

`alert_rules`

- id
- owner_type
- owner_id
- guild_id nullable
- alert_type
- world_id
- delivery
- channel_id nullable
- enabled
- rule_json
- created_at
- updated_at

`alert_deliveries`

- id
- alert_rule_id
- source_type
- source_id
- destination_type
- destination_id
- status
- reason
- sent_at

`report_configs`

- id
- guild_id
- world_id
- channel_id
- schedule
- enabled
- last_run_at

`daily_reports`

- id
- guild_id
- world_id
- report_date
- content
- metrics_json
- posted_message_id
- created_at

`ai_query_logs`

- id
- user_id
- guild_id
- question
- structured_query_json
- data_sources_json
- answer
- tokens_estimate
- created_at

### Admin/config tables

`system_health`

- component
- status
- last_heartbeat_at
- metadata_json

`collector_runs`

- id
- collector_type
- world_id
- started_at
- finished_at
- status
- records_found
- error

## Service boundaries

### Discord command handler

Owns command definitions and Discord formatting.

Modules:

- commands/setup
- commands/price
- commands/offers
- commands/alert
- commands/deals
- commands/bazaar
- commands/daily-report
- commands/ask
- commands/usage
- commands/admin

### Access/limits service

Single module responsible for:

- tier lookup
- command quota checks
- alert count checks
- delivery permission checks
- usage increments

Every command goes through this service.

### Market query service

Responsible for:

- price summaries
- recent offers
- deal candidates
- liquidity/confidence calculations

Command handlers do not embed market SQL directly.

### Bazaar service

Responsible for:

- auction lookup
- search/filtering
- score explanation
- deal candidates
- Bazaar alert matching data

### Alert service

Responsible for:

- creating alert rules
- validating alert limits
- evaluating item alerts
- evaluating Bazaar alerts
- dedupe/cooldowns
- delivery logging

### Report service

Responsible for:

- daily report generation
- ranked opportunity selection
- Discord report formatting
- optional AI summary text

### AI service

Responsible for:

- extracting structured intent
- retrieving grounding data through MarketQueryService and BazaarService
- generating grounded answers
- refusing unsupported requests
- logging usage

AI should not directly query arbitrary database tables.

### Collector sync service

For the beta, prefer syncing existing C++ SQLite output into Postgres rather than rewriting the C++ storage layer immediately.

Long-term, C++ collectors can write directly to Postgres.

## Build sequence

### Phase 0: Product/legal positioning

Deliverables:

- product name/working name: TibiaEdge
- market analytics positioning
- explicit non-goals and disclaimer

### Phase 1: Discord bot skeleton

Deliverables:

- Discord app/bot setup
- slash command registration
- `/setup`
- guild install tracking
- default Free tier
- channel configuration
- `/usage`
- admin tier commands

Success:

- bot can be invited to a test server
- server admin can configure default world and channels
- operator can manually set user/guild tiers
- bot enforces simple daily command limits

### Phase 2: Market data bridge

Deliverables:

- Postgres schema
- SQLite-to-Postgres sync or direct ingestion adapter
- item/world normalization
- data freshness tracking
- basic price aggregate query

Success:

- `/price` answers from real stored trade data
- `/offers` lists real offers
- bot shows data freshness
- missing data is reported honestly

### Phase 3: Item market commands

Deliverables:

- `/price`
- `/offers`
- `/alert item`
- basic `/deals`
- item alert worker

Success:

- Free users can use real-time price/offers within limits
- Free users can create 1 server-channel item alert
- Pro users can create more alerts and use DMs
- duplicate alerts are suppressed

### Phase 4: Bazaar scanner

Deliverables:

- Bazaar snapshot integration
- `bazaar_auctions`
- `bazaar_scores`
- `/bazaar auction`
- `/bazaar search`
- `/bazaar alert`
- `/bazaar deals`

Success:

- bot displays auction details
- bot scores auctions with reasons and confidence
- Bazaar alerts fire for matching active auctions

### Phase 5: Daily reports

Deliverables:

- report config
- daily report worker
- `/daily-report`
- automatic Guild Pro report posts

Success:

- Guild Pro server receives automatic daily report
- Free server can run limited manual report
- report is useful without relying on AI

### Phase 6: AI Q&A

Deliverables:

- `/ask`
- intent extraction
- grounded retrieval
- answer generation
- AI quota enforcement
- AI query logging

Success:

- answers cite recent data
- missing data produces uncertainty rather than hallucination
- unsupported automation questions are refused or redirected

### Phase 7: Beta operations

Deliverables:

- VPS deployment
- env/secrets management
- logs
- health checks
- backups
- admin commands
- onboarding instructions
- manual payment/tier workflow

Success:

- 3–5 external Discord servers install the bot
- bot stays online
- alerts/reports fire reliably
- operator can debug from logs

## Metrics

Usage metrics:

- commands/day
- active guilds
- active users
- alerts created
- alerts delivered
- daily reports posted
- AI questions asked

Data quality metrics:

- offers collected/day
- parse success rate
- unresolved item rate
- collector freshness
- Bazaar auctions observed/day
- alert false-positive feedback

Conversion metrics:

- Free users hitting limits
- upgrade requests
- Pro users using DM alerts
- Guilds configuring report channels
- retained active servers after 7/30 days

## Paid beta success criteria

Technical success:

- bot is invited to multiple external servers
- acceptable beta uptime
- alert delivery within a short window after data arrival
- low duplicate/spam rate
- slash commands respond quickly
- data freshness is visible
- collector/worker failures are observable

Product success:

- users create watchlists without prompting
- users ask for more alerts/limits
- users share screenshots of useful alerts
- users request specific new items/worlds/features
- daily reports are read/discussed

Business success:

- first 5 paying users or 2 paying guilds
- users can clearly explain why they paid
- one feature emerges as the main reason people subscribe

## Risks and mitigations

### Data collection is unreliable

Mitigation:

- show data freshness in responses
- health checks
- start with one world
- keep collection independent of Discord

### Trade parsing is noisy

Mitigation:

- confidence scores
- conservative deal alerts
- manual-review language
- unresolved item metrics

### Bazaar valuation is weak early

Mitigation:

- rule-based candidate scoring
- explain reasons and confidence
- avoid guaranteed-profit language

### Discord spam

Mitigation:

- dedupe
- cooldowns
- per-alert limits
- delivery logs

### Free tier costs too much

Mitigation:

- real-time data for trust
- strict usage/alert/AI limits
- AI mostly paid

### Product drifts toward botting

Mitigation:

- explicit analytics-only policy
- no gameplay automation features
- refuse botting/anti-cheat bypass requests

## Open decisions for implementation planning

These do not block the design, but should be resolved during implementation planning:

1. Use Drizzle, Prisma, or raw SQL for the TypeScript database layer.
2. Whether Phase 1 uses a local SQLite prototype or Postgres immediately.
3. Exact Discord hosting target for beta deployment.
4. Exact manual payment workflow for first paid users.
5. Whether `/ask` is disabled on Free at launch or given a tiny monthly quota.
