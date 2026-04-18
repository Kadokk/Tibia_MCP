# Listener Smoke-Test Runbook

## Prerequisites
- Tibia account with at least one character on Antica (or target world).
- Character positioned at a low-traffic location (e.g., Thais depot ground floor).
- `ANTHROPIC_API_KEY` set for the parser.
- `TIBIA_LISTENER_EMAIL`, `TIBIA_LISTENER_PASSWORD` set.
- Optional: `TIBIA_LISTENER_CHARACTER=<name>` to pick a specific character.

## Stage 1: Listener alone (1 hour)

Goal: confirm login, channel join, message capture, anti-idle.

1. Start listener:
   ```
   TIBIA_MCP_LOG_LEVEL=INFO ./build/tibia-listener 2> listener.log &
   ```
2. Watch the log — expect:
   - "Login successful"
   - "Selecting <char> on Antica"
   - "Trade channel joined (id=<N>)"
3. After 12 minutes, expect a turn packet (no visible log — verify indirectly by staying connected past 15 min).
4. After 1 hour, stop:
   ```
   kill %1
   ```
5. Inspect DB:
   ```
   sqlite3 tibia_mcp_cache.db 'SELECT COUNT(*) FROM raw_messages;'
   sqlite3 tibia_mcp_cache.db 'SELECT sender_name, text FROM raw_messages ORDER BY received_at DESC LIMIT 20;'
   ```
   Expect: ≥50 messages (Antica Trade is busy; fewer suggests a bug or a dead hour).

## Stage 2: Parser alone

Goal: confirm regex + LLM parse the captured messages.

1. Run parser once:
   ```
   TIBIA_MCP_LOG_LEVEL=INFO TIBIA_PARSER_INTERVAL_SEC=5 ./build/tibia-parser 2> parser.log &
   sleep 30 && kill %1
   ```
2. Inspect results:
   ```
   sqlite3 tibia_mcp_cache.db 'SELECT parse_method, COUNT(*) FROM raw_messages GROUP BY parse_method;'
   sqlite3 tibia_mcp_cache.db 'SELECT parse_method, offer_type, item_canonical, price_gold FROM trade_offers LIMIT 20;'
   ```
   Expect: regex hit rate ≥60%, combined regex+LLM ≥85% (per spec success criteria).

## Stage 3: MCP tool query

Goal: confirm the tools return the captured data.

1. Via MCP client or manual JSON-RPC:
   ```
   echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"query_trade_offers","arguments":{"item":"magic sword","since_hours":24}}}' | ./build/tibia-mcp
   ```

## Stage 4: 24-hour soak

1. Start listener + parser under a supervisor:
   ```
   # Simple bash supervisor (see spec §Reliability)
   while true; do ./build/tibia-listener 2>> listener.log; sleep 30; done &
   while true; do ./build/tibia-parser   2>> parser.log;   sleep 30; done &
   ```
2. After 24 hours, check:
   - Message count growth is monotonic
   - No parser backlog (unparsed count stays near zero)
   - No repeated login failures in listener.log

## Failure modes to watch for
- **Silent zero messages**: wrong opcodes for the current protocol version. Capture a packet with Wireshark/tcpdump and cross-check against `game/opcodes.h`.
- **15-min disconnect**: anti-idle turn not working (wrong opcode or sequence counter off).
- **Parser stuck at 0% parse rate**: item registry not loading; check `TIBIA_PARSER_ITEMS_PATH`.
- **High `llm_failed` rate**: ANTHROPIC_API_KEY invalid or wrong region. Check parser.log for 401s.
