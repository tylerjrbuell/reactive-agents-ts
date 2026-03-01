#!/usr/bin/env bash
set -euo pipefail

# Telegram Session Helper
# Generates a session string for the Telegram MCP server.
#
# Usage: ./scripts/telegram-session.sh
#
# Prerequisites:
#   1. Create an app at https://my.telegram.org/apps
#   2. Note your API ID and API Hash
#
# After generation, save the session string to .env.telegram

IMAGE="ghcr.io/reactive-agents/telegram-mcp"

# Fall back to local build if published image not available
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Published image not found. Building locally..."
  IMAGE="telegram-mcp:local"
  docker build -t "$IMAGE" docker/telegram-mcp/
fi

echo "=== Telegram Session Setup ==="
echo ""
echo "You need a Telegram API ID and Hash."
echo "Get them at: https://my.telegram.org/apps"
echo ""

read -rp "API ID: " API_ID
read -rp "API Hash: " API_HASH

echo ""
echo "Generating session string (you will be asked to log in)..."
echo ""

docker run -it --rm \
  -e TELEGRAM_API_ID="$API_ID" \
  -e TELEGRAM_API_HASH="$API_HASH" \
  --entrypoint python3 \
  "$IMAGE" \
  -c "
from telethon.sync import TelegramClient
from telethon.sessions import StringSession
with TelegramClient(StringSession(), int('$API_ID'), '$API_HASH') as client:
    print()
    print('=== SESSION STRING (copy everything below) ===')
    print(client.session.save())
    print('=== END SESSION STRING ===')
"

echo ""
echo "Save the session string to .env.telegram:"
echo ""
echo "  TELEGRAM_API_ID=$API_ID"
echo "  TELEGRAM_API_HASH=$API_HASH"
echo "  TELEGRAM_SESSION_STRING=<paste session string>"
