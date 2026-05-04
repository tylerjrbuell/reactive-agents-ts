#!/usr/bin/env bash
set -euo pipefail

# Telegram Session Helper
# Generates a session string for the Telegram MCP server (chigwell/telegram-mcp).
# Must be a normal *user* login (phone + OTP). Bot tokens / bot sessions will fail
# at runtime with BotMethodInvalidError on get_dialogs().
#
# Usage: ./scripts/telegram-session.sh
#
# Prerequisites:
#   1. Create an app at https://my.telegram.org/apps
#   2. Note your API ID and API Hash
#
# After generation, save the session string to .env.telegram

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
# Use stock Python + Telethon here (reliable); do not depend on MCP image internals.
SESSION_BOOTSTRAP_IMAGE="${TELEGRAM_SESSION_BOOTSTRAP_IMAGE:-python:3.12-slim}"

docker run -it --rm \
  -e TELEGRAM_API_ID="$API_ID" \
  -e TELEGRAM_API_HASH="$API_HASH" \
  --entrypoint bash \
  "$SESSION_BOOTSTRAP_IMAGE" \
  -lc "pip install -q telethon && python3 -c \"
import os
from telethon.sync import TelegramClient
from telethon.sessions import StringSession
with TelegramClient(StringSession(), int(os.environ['TELEGRAM_API_ID']), os.environ['TELEGRAM_API_HASH']) as client:
    print()
    print('=== SESSION STRING (copy everything below) ===')
    print(client.session.save())
    print('=== END SESSION STRING ===')
\""

echo ""
echo "Save the session string to .env.telegram:"
echo ""
echo "  TELEGRAM_API_ID=$API_ID"
echo "  TELEGRAM_API_HASH=$API_HASH"
echo "  TELEGRAM_SESSION_STRING=<paste session string>"
echo ""
echo "Important: log in as your personal Telegram account (phone + code)."
echo "If this session is for a @BotFather bot, chigwell/telegram-mcp will exit with"
echo "  BotMethodInvalidError ... GetDialogsRequest"
echo "because bots cannot list dialogs. Regenerate with a user login if you see that."
