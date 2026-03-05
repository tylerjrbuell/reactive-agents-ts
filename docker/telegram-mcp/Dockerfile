# Telegram MCP Server — Telethon MTProto client with MCP JSON-RPC interface
# Requires one-time session setup: see scripts/telegram-session.sh
FROM python:3.12-slim

# Install telegram-mcp (chigwell/telegram-mcp)
RUN pip install --no-cache-dir telegram-mcp

# Non-root user
RUN adduser --disabled-password --uid 1000 --gecos "" agent
USER agent

# Telegram credentials passed via environment variables:
#   TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION_STRING
# Never baked into the image.

# MCP stdio transport — reads JSON-RPC from stdin, writes to stdout
ENTRYPOINT ["python3", "-m", "telegram_mcp"]
