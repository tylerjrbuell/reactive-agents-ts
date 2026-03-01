# Messaging Examples

Demonstrates agents that communicate via Signal and Telegram using MCP servers.

## signal-telegram-hub.ts

A persistent autonomous agent that monitors both Signal and Telegram for incoming messages, responds intelligently, and respects rate/budget limits.

### How It Works

1. **MCP servers** for Signal (signal-cli) and Telegram (Telethon) run in hardened Docker containers
2. **Gateway heartbeat** fires every 15 seconds to check for new messages
3. **Agent uses MCP tools** (`signal/receive_message`, `telegram/send_message`) to interact
4. **Policy engine** enforces daily token budget and hourly rate limits
5. **Guardrails** check inbound messages for prompt injection before the LLM sees them

### Prerequisites

1. Docker installed and running
2. Signal phone number registered:
   ```bash
   ./scripts/signal-register.sh +1234567890
   ```
3. Telegram session generated:
   ```bash
   ./scripts/telegram-session.sh
   ```
4. Environment variables set:
   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...
   export SIGNAL_PHONE_NUMBER=+1234567890
   # .env.telegram must exist with TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION_STRING
   ```

### Run

```bash
# Live mode (requires Docker + accounts)
ANTHROPIC_API_KEY=sk-ant-... SIGNAL_PHONE_NUMBER=+1234567890 \
  bun run apps/examples/src/messaging/signal-telegram-hub.ts

# Test mode (no Docker needed)
bun run apps/examples/src/messaging/signal-telegram-hub.ts
```

### Security

- Docker containers run as non-root with all capabilities dropped
- Secrets are passed via `--env-file`, never through tool arguments
- Memory limited to 128MB per container
- Guardrails scan inbound messages for injection attacks
- Kill switch enables emergency shutdown
