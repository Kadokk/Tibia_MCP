#!/usr/bin/env bash
set -e

BINARY="./build/tibia-mcp"

# Portable timeout wrapper: use 'timeout', 'gtimeout', or a perl fallback
run_with_timeout() {
    if command -v timeout >/dev/null 2>&1; then
        timeout 10 "$@"
    elif command -v gtimeout >/dev/null 2>&1; then
        gtimeout 10 "$@"
    else
        # Perl fallback for macOS without coreutils
        perl -e 'alarm 10; exec @ARGV' -- "$@"
    fi
}

# Helper: send a JSON-RPC message with Content-Length header
send() {
    local body="$1"
    printf "Content-Length: %d\r\n\r\n%s" "${#body}" "$body"
}

# Test 1: initialize + tools/list
echo "--- Test 1: initialize + tools/list ---"
RESPONSE=$(
{
    send '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
    send '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    send '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
} | run_with_timeout "$BINARY" 2>/dev/null
)

echo "$RESPONSE" | grep -q '"tools"' && echo "PASS: tools/list returned tools" || echo "FAIL: tools/list"
TOOL_COUNT=$(echo "$RESPONSE" | grep -o '"name"' | wc -l)
echo "Tools found: $TOOL_COUNT"
[ "$TOOL_COUNT" -ge 12 ] && echo "PASS: all 12 tools registered" || echo "FAIL: expected 12 tools"

# Test 2: ping
echo "--- Test 2: ping ---"
RESPONSE2=$(
{
    send '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
    send '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    send '{"jsonrpc":"2.0","id":2,"method":"ping","params":{}}'
} | run_with_timeout "$BINARY" 2>/dev/null
)
echo "$RESPONSE2" | grep -q '"result"' && echo "PASS: ping responded" || echo "FAIL: ping"

# Test 3: tools/call with clear_cache (no network needed)
echo "--- Test 3: tools/call (clear_cache) ---"
RESPONSE3=$(
{
    send '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
    send '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    send '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"clear_cache","arguments":{}}}'
} | run_with_timeout "$BINARY" 2>/dev/null
)
echo "$RESPONSE3" | grep -q '"content"' && echo "PASS: tools/call returned content" || echo "FAIL: tools/call"
echo "$RESPONSE3" | grep -q "Cache cleared" && echo "PASS: clear_cache worked" || echo "FAIL: clear_cache message"

# Test 4: unknown method returns error
echo "--- Test 4: unknown method ---"
RESPONSE4=$(
{
    send '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
    send '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    send '{"jsonrpc":"2.0","id":2,"method":"nonexistent/method","params":{}}'
} | run_with_timeout "$BINARY" 2>/dev/null
)
echo "$RESPONSE4" | grep -q '"error"' && echo "PASS: unknown method returned error" || echo "FAIL: unknown method"

echo "Integration tests complete."
