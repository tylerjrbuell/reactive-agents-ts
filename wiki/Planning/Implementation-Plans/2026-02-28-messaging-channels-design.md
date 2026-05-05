# Messaging Channels via MCP — Design Document

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable Reactive Agents to send and receive messages on Signal and Telegram using existing MCP servers — no new adapter framework needed.

**Architecture:** Leverage the framework's existing `.withMCP()` + `.withGateway()` capabilities. MCP servers for Signal (signal-cli) and Telegram (Telethon) run as Docker containers. The gateway heartbeat drives message polling; the agent uses MCP tools to read and respond. Security is paramount — secrets never leak, containers are sandboxed, and message content is guardrail-checked.

**Tech Stack:** Docker, signal-cli (JSON-RPC), Telethon (MTProto), existing MCP stdio transport, existing gateway heartbeat system.

---

## 1. Why MCP Instead of Custom Adapters

The original gateway design spec defined a `ChannelAdapter` interface for bidirectional messaging platforms. After analysis, this is unnecessary because:

1. **MCP servers for Signal and Telegram already exist** — battle-tested open source projects
2. **`.withMCP()` already supports Docker containers** — `command: "docker", args: ["run", "-i", ...]`
3. **MCP connections persist across heartbeat cycles** — ManagedRuntime evaluates layers once at build time; the same ToolService (and MCP connections) are reused for every `agent.run()` call
4. **SSE/WebSocket transports auto-reconnect** — built-in resilience for long-running gateways
5. **Docker is already on the v0.6.0 roadmap** for tool sandboxing — messaging containers follow the same pattern

Building custom `ChannelAdapter` infrastructure would duplicate capabilities the framework already has.

## 2. Security Model

### Container Isolation

Each MCP server runs in a Docker container with restricted permissions:

```
docker run -i --rm \
  --network none \                    # No outbound internet (except Signal/Telegram API)
  --read-only \                       # Immutable root filesystem
  --tmpfs /tmp:size=50m \             # Writable scratch only in tmpfs
  --cap-drop ALL \                    # Drop all Linux capabilities
  --no-new-privileges \               # No setuid/sudo escalation
  --memory 128m \                     # Hard memory cap
  --pids-limit 30 \                   # No fork bombs
  --user 1000:1000 \                  # Non-root
  -v ./signal-data:/data:rw \         # Persistent auth state (restricted volume)
  signal-mcp:latest
```

**Exception:** `--network none` must be relaxed for the actual messaging API traffic. Use a Docker network with egress restricted to only the required hosts:

- **Signal:** `textsecure-service.whispersystems.org`, `storage.signal.org`, `cdn.signal.org`, `cdn2.signal.org`
- **Telegram:** `api.telegram.org`, `149.154.160.0/20` (Telegram DC IPs)

### Secret Management

| Secret | Where It Lives | Never Exposed To |
|--------|---------------|-----------------|
| Signal phone number + auth keys | Docker volume (`./signal-data/`) | Agent LLM context |
| Telegram session string | Docker env var (`.env.telegram`) | Agent LLM context, stdout |
| Telegram API ID / Hash | Docker env var | Agent LLM context |

**Critical:** Secrets are passed to Docker containers via `--env-file` or `-e`, NOT through MCP tool arguments. The MCP server reads them from its own environment. The agent (and LLM) never see auth credentials.

### Message Content Safety

All inbound messages flow through the gateway's existing guardrail pipeline:

```
Incoming message (MCP receive_message result)
  → Agent context window
  → Guardrail check (injection, PII, toxicity)
  → Reasoning + response generation
  → Outbound message (MCP send_message call)
```

If `.withGuardrails()` is enabled, incoming messages are scanned before the LLM processes them. This prevents prompt injection via Signal/Telegram messages.

### Rate Limiting

The gateway's existing policy engine prevents abuse:

- **CostBudget policy:** Daily token cap prevents runaway conversations
- **RateLimit policy:** Max actions per hour prevents message floods
- **Adaptive heartbeat:** Skip polling when no new messages (reduces API calls)

## 3. MCP Server Selection

### Signal: `rymurr/signal-mcp`

- **Source:** https://github.com/rymurr/signal-mcp
- **Tools:** `send_message_to_user`, `send_message_to_group`, `receive_message`
- **Transport:** stdio (JSON-RPC over stdin/stdout)
- **Requires:** signal-cli + JRE (packaged in Docker image)
- **Auth:** Pre-registered Signal phone number with verified device

We build a Dockerfile that bundles signal-cli + JRE + the MCP server into one image.

### Telegram: `chigwell/telegram-mcp`

- **Source:** https://github.com/chigwell/telegram-mcp (748 stars)
- **Tools:** 70+ tools (send_message, get_chats, search_messages, send_file, etc.)
- **Transport:** stdio (JSON-RPC)
- **Requires:** Telethon + session string
- **Auth:** Telegram API ID + Hash + session string (generated once)

Already has a Dockerfile. We provide our own hardened variant with restricted capabilities.

## 4. Docker Images

### `reactive-agents/signal-mcp`

```dockerfile
FROM eclipse-temurin:21-jre-alpine

# Install signal-cli
RUN apk add --no-cache curl bash && \
    curl -L -o /opt/signal-cli.tar.gz \
      "https://github.com/AsamK/signal-cli/releases/download/v0.13.12/signal-cli-0.13.12.tar.gz" && \
    tar xzf /opt/signal-cli.tar.gz -C /opt/ && \
    rm /opt/signal-cli.tar.gz && \
    ln -s /opt/signal-cli-0.13.12/bin/signal-cli /usr/local/bin/signal-cli

# Install signal-mcp (Python MCP server)
RUN apk add --no-cache python3 py3-pip && \
    pip3 install --no-cache-dir signal-mcp

# Non-root user
RUN adduser -D -u 1000 agent
USER agent

# signal-cli data persists via volume mount
VOLUME /data
ENV SIGNAL_CLI_CONFIG=/data

ENTRYPOINT ["python3", "-m", "signal_mcp"]
```

### `reactive-agents/telegram-mcp`

```dockerfile
FROM python:3.12-slim

RUN pip install --no-cache-dir telegram-mcp

RUN adduser --disabled-password --uid 1000 agent
USER agent

ENTRYPOINT ["python3", "-m", "telegram_mcp"]
```

Both images are published to GHCR: `ghcr.io/reactive-agents/signal-mcp` and `ghcr.io/reactive-agents/telegram-mcp`.

## 5. Signal Registration Helper

Signal requires a one-time phone number registration. We provide a helper script:

```bash
#!/bin/bash
# scripts/signal-register.sh
# Register a phone number with signal-cli for agent use

PHONE="${1:?Usage: signal-register.sh +1234567890}"
DATA_DIR="${2:-./signal-data}"

echo "Registering $PHONE with Signal..."
docker run -it --rm \
  -v "$DATA_DIR:/data" \
  -e SIGNAL_CLI_CONFIG=/data \
  ghcr.io/reactive-agents/signal-mcp \
  signal-cli -a "$PHONE" register

echo ""
echo "Enter the verification code sent to $PHONE:"
read -r CODE

docker run -it --rm \
  -v "$DATA_DIR:/data" \
  -e SIGNAL_CLI_CONFIG=/data \
  ghcr.io/reactive-agents/signal-mcp \
  signal-cli -a "$PHONE" verify "$CODE"

echo "Registration complete. Auth data stored in $DATA_DIR"
```

After registration, `./signal-data/` contains the encrypted key material. This directory is volume-mounted into the Docker container on subsequent runs.

## 6. Telegram Session Helper

Telegram requires a one-time session string generation:

```bash
#!/bin/bash
# scripts/telegram-session.sh
# Generate a Telegram session string for agent use

echo "You need a Telegram API ID and Hash from https://my.telegram.org"
echo ""
read -rp "API ID: " API_ID
read -rp "API Hash: " API_HASH

docker run -it --rm \
  -e TELEGRAM_API_ID="$API_ID" \
  -e TELEGRAM_API_HASH="$API_HASH" \
  ghcr.io/reactive-agents/telegram-mcp \
  python3 -c "from telegram_mcp.session import generate; generate()"

echo ""
echo "Save the session string above to .env.telegram as TELEGRAM_SESSION_STRING=..."
```

## 7. Example Agent: Messaging Hub

Location: `apps/examples/src/messaging/signal-telegram-hub.ts`

```typescript
import { ReactiveAgents } from "reactive-agents";

/**
 * Messaging Hub Agent
 *
 * Monitors Signal and Telegram for incoming messages,
 * responds intelligently, and respects rate/budget limits.
 *
 * Prerequisites:
 *   1. Docker installed
 *   2. Signal registered: ./scripts/signal-register.sh +1234567890
 *   3. Telegram session: ./scripts/telegram-session.sh
 *   4. .env.telegram with API_ID, API_HASH, SESSION_STRING
 */
const agent = await ReactiveAgents.create()
  .withName("messaging-hub")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withPersona({
    role: "Personal Assistant",
    instructions: "You respond to messages concisely and helpfully. Never share private information across platforms.",
    tone: "friendly and professional",
  })
  .withReasoning()
  .withTools()
  .withMemory("1")
  .withGuardrails()
  .withKillSwitch()
  .withMCP([
    {
      name: "signal",
      transport: "stdio",
      command: "docker",
      args: [
        "run", "-i", "--rm",
        "--cap-drop", "ALL",
        "--no-new-privileges",
        "--memory", "128m",
        "--pids-limit", "30",
        "--user", "1000:1000",
        "-v", "./signal-data:/data:rw",
        "-e", `SIGNAL_USER_ID=${process.env.SIGNAL_PHONE_NUMBER}`,
        "ghcr.io/reactive-agents/signal-mcp",
      ],
    },
    {
      name: "telegram",
      transport: "stdio",
      command: "docker",
      args: [
        "run", "-i", "--rm",
        "--cap-drop", "ALL",
        "--no-new-privileges",
        "--memory", "128m",
        "--pids-limit", "30",
        "--user", "1000:1000",
        "--env-file", ".env.telegram",
        "ghcr.io/reactive-agents/telegram-mcp",
      ],
    },
  ])
  .withGateway({
    heartbeat: {
      intervalMs: 15_000,
      policy: "adaptive",
      instruction: [
        "Check for new messages on Signal and Telegram.",
        "Use signal/receive_message to check Signal.",
        "Use telegram/get_chats to check Telegram for unread messages.",
        "For each new message: read it, generate a thoughtful response,",
        "and reply using the appropriate send tool for that platform.",
        "If no new messages, report that and take no further action.",
      ].join(" "),
      maxConsecutiveSkips: 4,
    },
    policies: {
      dailyTokenBudget: 100_000,
      maxActionsPerHour: 60,
      heartbeatPolicy: "adaptive",
    },
  })
  .withObservability({ verbosity: "normal" })
  .build();

// Monitor messaging activity
await agent.subscribe("ProactiveActionCompleted", (event) => {
  console.log(`[messaging] Action completed: ${event.success ? "ok" : "failed"}`);
});

await agent.subscribe("BudgetExhausted", (event) => {
  console.log(`[messaging] Budget exhausted: ${event.tokensUsed}/${event.dailyBudget}`);
});

console.log("Messaging hub started. Press Ctrl+C to stop.");
```

## 8. Test Strategy

### Unit Tests (in `apps/examples/`)

- **MCP config validation test** — verify Docker args are correctly formed
- **Heartbeat instruction test** — verify the instruction includes both platforms

### Integration Tests (manual, require Docker + accounts)

- **Signal round-trip:** Send a message to the agent's Signal number → verify agent responds
- **Telegram round-trip:** Send a message in the Telegram chat → verify agent responds
- **Budget enforcement:** Send enough messages to exhaust daily budget → verify agent stops responding and emits `BudgetExhausted` event
- **Kill switch:** Call `agent.stop()` while agent is processing messages → verify clean shutdown
- **Guardrail block:** Send a prompt injection attempt via Signal → verify guardrail catches it

### Automated Tests (mock MCP server)

We create a simple mock MCP server that simulates Signal/Telegram tools for CI:

```typescript
// In test: mock MCP server exposes receive_message and send_message_to_user
// Returns canned messages, verifies send calls are made with correct args
```

## 9. Documentation

### New docs page: `apps/docs/src/content/docs/guides/messaging-channels.md`

Covers:
1. Overview — how MCP + Gateway enables messaging
2. Signal setup (registration, Docker, env)
3. Telegram setup (session string, Docker, env)
4. Example agent configuration
5. Security best practices (container hardening, secret management, guardrails)
6. Troubleshooting (connection issues, auth failures, rate limits)

### Updates to existing docs:
- `features/gateway.md` — add "Messaging Channels" section linking to the guide
- `guides/tools.md` — mention messaging MCP servers in the MCP section
- `cookbook/production-deployment.md` — add messaging agent deployment pattern

## 10. File Manifest

| File | Purpose |
|------|---------|
| `docker/signal-mcp/Dockerfile` | Signal MCP server image |
| `docker/telegram-mcp/Dockerfile` | Telegram MCP server image |
| `docker/docker-compose.messaging.yml` | Compose file for both services |
| `scripts/signal-register.sh` | One-time Signal registration helper |
| `scripts/telegram-session.sh` | One-time Telegram session generator |
| `apps/examples/src/messaging/signal-telegram-hub.ts` | Full example agent |
| `apps/examples/src/messaging/README.md` | Setup guide for the example |
| `apps/docs/.../guides/messaging-channels.md` | Docs site guide |
| `packages/gateway/tests/messaging-mcp.test.ts` | Mock MCP messaging tests |

## 11. Security Checklist

- [ ] Docker containers run as non-root (UID 1000)
- [ ] All capabilities dropped (`--cap-drop ALL`)
- [ ] No privilege escalation (`--no-new-privileges`)
- [ ] Memory limited (`--memory 128m`)
- [ ] Process count limited (`--pids-limit 30`)
- [ ] Secrets passed via env vars / env-file, never through tool args
- [ ] Signal auth keys stored in volume, not in image
- [ ] Telegram session string never appears in agent context
- [ ] `.withGuardrails()` recommended for all messaging agents
- [ ] `.withKillSwitch()` required for autonomous messaging agents
- [ ] Rate limits enforced via gateway policy engine
- [ ] Network egress restricted to platform API hosts only

## 12. Future Enhancements (Not in Scope)

- **Slack MCP server** — add when a mature MCP server exists
- **Discord MCP server** — add when a mature MCP server exists
- **WhatsApp MCP server** — add when WhatsApp Business API MCP exists
- **Push notifications** — MCP notifications spec would enable real-time inbound without polling
- **Consent gate policy** — enforce opt-in messaging per user (from design doc)
- **Message history persistence** — store conversations in agent memory for context
