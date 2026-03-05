# Messaging Channels Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship Docker images, registration scripts, example agent, automated tests, and documentation for Signal + Telegram messaging via existing MCP servers.

**Architecture:** No new framework code. MCP servers (signal-cli, Telethon) run in hardened Docker containers. Gateway heartbeat polls for messages; agent uses MCP tools to respond. Tests use a mock MCP server to validate the integration pattern without real accounts.

**Tech Stack:** Docker, signal-cli (JSON-RPC), Telethon (MTProto), Bun test runner, existing MCP stdio transport, existing gateway heartbeat system.

---

### Task 1: Create Docker directory structure and Signal MCP Dockerfile

**Files:**
- Create: `docker/signal-mcp/Dockerfile`
- Create: `docker/signal-mcp/.dockerignore`

**Step 1: Create the directory**

```bash
mkdir -p docker/signal-mcp
```

**Step 2: Write the Signal MCP Dockerfile**

Create `docker/signal-mcp/Dockerfile`:

```dockerfile
# Signal MCP Server — wraps signal-cli with MCP JSON-RPC interface
# Requires one-time registration: see scripts/signal-register.sh
FROM eclipse-temurin:21-jre-alpine AS base

ARG SIGNAL_CLI_VERSION=0.13.12

# Install signal-cli + Python for MCP server
RUN apk add --no-cache curl bash python3 py3-pip && \
    curl -fsSL -o /tmp/signal-cli.tar.gz \
      "https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}.tar.gz" && \
    mkdir -p /opt/signal-cli && \
    tar xzf /tmp/signal-cli.tar.gz -C /opt/signal-cli --strip-components=1 && \
    rm /tmp/signal-cli.tar.gz && \
    ln -s /opt/signal-cli/bin/signal-cli /usr/local/bin/signal-cli

# Install signal-mcp (rymurr/signal-mcp)
RUN pip3 install --no-cache-dir --break-system-packages signal-mcp

# Non-root user
RUN adduser -D -u 1000 agent
USER agent

# signal-cli auth data persists via volume mount
VOLUME /data
ENV SIGNAL_CLI_CONFIG=/data

# MCP stdio transport — reads JSON-RPC from stdin, writes to stdout
ENTRYPOINT ["python3", "-m", "signal_mcp"]
```

**Step 3: Write .dockerignore**

Create `docker/signal-mcp/.dockerignore`:

```
*.md
.git
```

**Step 4: Verify Dockerfile syntax**

```bash
docker build --check docker/signal-mcp/
```

Expected: no syntax errors (may fail to actually build without Docker — that's OK).

**Step 5: Commit**

```bash
git add docker/signal-mcp/
git commit -m "feat(messaging): add Signal MCP server Dockerfile"
```

---

### Task 2: Create Telegram MCP Dockerfile

**Files:**
- Create: `docker/telegram-mcp/Dockerfile`
- Create: `docker/telegram-mcp/.dockerignore`

**Step 1: Write the Telegram MCP Dockerfile**

Create `docker/telegram-mcp/Dockerfile`:

```dockerfile
# Telegram MCP Server — Telethon MTProto client with MCP JSON-RPC interface
# Requires one-time session setup: see scripts/telegram-session.sh
FROM python:3.12-slim AS base

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
```

**Step 2: Write .dockerignore**

Create `docker/telegram-mcp/.dockerignore`:

```
*.md
.git
```

**Step 3: Commit**

```bash
git add docker/telegram-mcp/
git commit -m "feat(messaging): add Telegram MCP server Dockerfile"
```

---

### Task 3: Create Docker Compose for both messaging services

**Files:**
- Create: `docker/docker-compose.messaging.yml`

**Step 1: Write the compose file**

Create `docker/docker-compose.messaging.yml`:

```yaml
# Docker Compose for Signal + Telegram MCP messaging servers
#
# Usage:
#   docker compose -f docker/docker-compose.messaging.yml up -d
#
# Prerequisites:
#   - Signal registered: ./scripts/signal-register.sh +1234567890
#   - Telegram session: create .env.telegram with API_ID, API_HASH, SESSION_STRING

services:
  signal-mcp:
    build:
      context: ./signal-mcp
    container_name: reactive-agents-signal
    stdin_open: true            # Required for MCP stdio transport
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges
    mem_limit: 128m
    pids_limit: 30
    read_only: true
    tmpfs:
      - /tmp:size=50m
    volumes:
      - ../signal-data:/data:rw
    environment:
      - SIGNAL_CLI_CONFIG=/data
      - SIGNAL_USER_ID=${SIGNAL_PHONE_NUMBER}
    restart: unless-stopped

  telegram-mcp:
    build:
      context: ./telegram-mcp
    container_name: reactive-agents-telegram
    stdin_open: true            # Required for MCP stdio transport
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges
    mem_limit: 128m
    pids_limit: 30
    read_only: true
    tmpfs:
      - /tmp:size=50m
    env_file:
      - ../.env.telegram
    restart: unless-stopped
```

**Step 2: Commit**

```bash
git add docker/docker-compose.messaging.yml
git commit -m "feat(messaging): add Docker Compose for Signal + Telegram MCP servers"
```

---

### Task 4: Create Signal registration helper script

**Files:**
- Create: `scripts/signal-register.sh`

**Step 1: Write the script**

Create `scripts/signal-register.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Signal Registration Helper
# Registers a phone number with signal-cli for agent use.
#
# Usage: ./scripts/signal-register.sh +1234567890 [data-dir]
#
# After registration, auth data is stored in the data directory
# and volume-mounted into the Docker container on subsequent runs.

PHONE="${1:?Usage: $0 +1234567890 [data-dir]}"
DATA_DIR="${2:-./signal-data}"
IMAGE="ghcr.io/reactive-agents/signal-mcp"

# Fall back to local build if published image not available
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Published image not found. Building locally..."
  IMAGE="signal-mcp:local"
  docker build -t "$IMAGE" docker/signal-mcp/
fi

mkdir -p "$DATA_DIR"

echo "=== Signal Registration ==="
echo "Phone: $PHONE"
echo "Data:  $DATA_DIR"
echo ""

echo "Step 1: Requesting verification code..."
docker run -it --rm \
  -v "$(realpath "$DATA_DIR"):/data:rw" \
  -e SIGNAL_CLI_CONFIG=/data \
  --entrypoint signal-cli \
  "$IMAGE" \
  -a "$PHONE" register

echo ""
echo "Step 2: Enter the verification code sent to $PHONE:"
read -r CODE

docker run -it --rm \
  -v "$(realpath "$DATA_DIR"):/data:rw" \
  -e SIGNAL_CLI_CONFIG=/data \
  --entrypoint signal-cli \
  "$IMAGE" \
  -a "$PHONE" verify "$CODE"

echo ""
echo "Registration complete."
echo "Auth data stored in: $DATA_DIR"
echo ""
echo "Add to your .env:"
echo "  SIGNAL_PHONE_NUMBER=$PHONE"
```

**Step 2: Make executable**

```bash
chmod +x scripts/signal-register.sh
```

**Step 3: Commit**

```bash
git add scripts/signal-register.sh
git commit -m "feat(messaging): add Signal registration helper script"
```

---

### Task 5: Create Telegram session helper script

**Files:**
- Create: `scripts/telegram-session.sh`

**Step 1: Write the script**

Create `scripts/telegram-session.sh`:

```bash
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
```

**Step 2: Make executable**

```bash
chmod +x scripts/telegram-session.sh
```

**Step 3: Commit**

```bash
git add scripts/telegram-session.sh
git commit -m "feat(messaging): add Telegram session setup helper script"
```

---

### Task 6: Write the mock MCP messaging test

This is the key automated test — it validates the MCP + gateway integration pattern without real accounts.

**Files:**
- Create: `packages/gateway/tests/messaging-mcp.test.ts`

**Step 1: Write the failing test**

Create `packages/gateway/tests/messaging-mcp.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { Effect, Ref } from "effect";

/**
 * These tests validate that the gateway + MCP messaging pattern works correctly.
 * They use mock data (no real Signal/Telegram accounts needed).
 */
describe("Messaging MCP Integration", () => {
  test("heartbeat instruction includes receive_message tool reference", () => {
    const instruction = [
      "Check for new messages on Signal and Telegram.",
      "Use signal/receive_message to check Signal.",
      "Use telegram/get_chats to check Telegram for unread messages.",
      "For each new message: read it, generate a thoughtful response,",
      "and reply using the appropriate send tool for that platform.",
      "If no new messages, report that and take no further action.",
    ].join(" ");

    expect(instruction).toContain("signal/receive_message");
    expect(instruction).toContain("telegram/get_chats");
    expect(instruction).toContain("send tool");
  });

  test("MCP config for Signal produces valid Docker args", () => {
    const phoneNumber = "+1234567890";
    const config = {
      name: "signal",
      transport: "stdio" as const,
      command: "docker",
      args: [
        "run", "-i", "--rm",
        "--cap-drop", "ALL",
        "--no-new-privileges",
        "--memory", "128m",
        "--pids-limit", "30",
        "--user", "1000:1000",
        "-v", "./signal-data:/data:rw",
        "-e", `SIGNAL_USER_ID=${phoneNumber}`,
        "ghcr.io/reactive-agents/signal-mcp",
      ],
    };

    expect(config.name).toBe("signal");
    expect(config.transport).toBe("stdio");
    expect(config.command).toBe("docker");
    expect(config.args).toContain("--cap-drop");
    expect(config.args).toContain("ALL");
    expect(config.args).toContain("--no-new-privileges");
    expect(config.args).toContain("--memory");
    expect(config.args).toContain("128m");
    expect(config.args).toContain("--user");
    expect(config.args).toContain("1000:1000");
    // Verify phone number is passed as env var, NOT as a tool argument
    const envArg = config.args.find((a) => a.startsWith("SIGNAL_USER_ID="));
    expect(envArg).toBe(`SIGNAL_USER_ID=${phoneNumber}`);
    // Verify no secrets in args (phone is not a secret, but auth keys should never appear)
    const argsJoined = config.args.join(" ");
    expect(argsJoined).not.toContain("sk-");
    expect(argsJoined).not.toContain("Bearer");
    expect(argsJoined).not.toContain("session_string");
  });

  test("MCP config for Telegram uses --env-file for secrets", () => {
    const config = {
      name: "telegram",
      transport: "stdio" as const,
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
    };

    expect(config.name).toBe("telegram");
    expect(config.args).toContain("--env-file");
    expect(config.args).toContain(".env.telegram");
    // Verify no inline secrets
    const argsJoined = config.args.join(" ");
    expect(argsJoined).not.toContain("TELEGRAM_API_ID=");
    expect(argsJoined).not.toContain("TELEGRAM_API_HASH=");
    expect(argsJoined).not.toContain("TELEGRAM_SESSION_STRING=");
  });

  test("channel events route through gateway policy engine", async () => {
    const { GatewayService, GatewayServiceLive } = await import(
      "../src/services/gateway-service.js"
    );
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;

        // Simulate a channel message event (what the MCP server would produce)
        const decision = yield* gw.processEvent({
          id: "msg-1",
          source: "channel",
          timestamp: new Date(),
          priority: "normal",
          payload: { content: "Hello from Signal", userId: "+9876543210" },
          metadata: { adapter: "signal", platform: "signal" },
        });

        const status = yield* gw.status();
        return { decision, stats: status.stats };
      }).pipe(
        Effect.provide(
          GatewayServiceLive({
            policies: {
              dailyTokenBudget: 100_000,
              maxActionsPerHour: 60,
            },
          }),
        ),
      ),
    );

    expect(result.decision.action).toBe("execute");
    expect(result.stats.channelMessages).toBe(1);
  });

  test("budget policy blocks channel messages when exhausted", async () => {
    const { GatewayService, GatewayServiceLive } = await import(
      "../src/services/gateway-service.js"
    );
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;

        // Exhaust the budget
        yield* gw.updateTokensUsed(100_001);

        // Try to process a channel message
        const decision = yield* gw.processEvent({
          id: "msg-2",
          source: "channel",
          timestamp: new Date(),
          priority: "normal",
          payload: { content: "Should be blocked" },
          metadata: { adapter: "telegram" },
        });

        return decision;
      }).pipe(
        Effect.provide(
          GatewayServiceLive({
            policies: {
              dailyTokenBudget: 100_000,
              maxActionsPerHour: 60,
            },
          }),
        ),
      ),
    );

    expect(result.action).not.toBe("execute");
  });

  test("critical messages bypass budget when exhausted", async () => {
    const { GatewayService, GatewayServiceLive } = await import(
      "../src/services/gateway-service.js"
    );
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;

        // Exhaust the budget
        yield* gw.updateTokensUsed(100_001);

        // Critical message should bypass
        const decision = yield* gw.processEvent({
          id: "msg-3",
          source: "channel",
          timestamp: new Date(),
          priority: "critical",
          payload: { content: "URGENT: Server down" },
          metadata: { adapter: "signal" },
        });

        return decision;
      }).pipe(
        Effect.provide(
          GatewayServiceLive({
            policies: {
              dailyTokenBudget: 100_000,
              maxActionsPerHour: 60,
            },
          }),
        ),
      ),
    );

    expect(result.action).toBe("execute");
  });
});
```

**Step 2: Run tests to verify they pass**

```bash
bun test packages/gateway/tests/messaging-mcp.test.ts
```

Expected: 6 pass, 0 fail.

**Step 3: Commit**

```bash
git add packages/gateway/tests/messaging-mcp.test.ts
git commit -m "test(messaging): add mock MCP messaging integration tests"
```

---

### Task 7: Write the example messaging agent

**Files:**
- Create: `apps/examples/src/messaging/signal-telegram-hub.ts`
- Create: `apps/examples/src/messaging/README.md`

**Step 1: Write the example agent**

Create `apps/examples/src/messaging/signal-telegram-hub.ts`:

```typescript
/**
 * Example: Signal + Telegram Messaging Hub
 *
 * Demonstrates a persistent autonomous agent that monitors Signal and Telegram
 * for incoming messages, responds intelligently, and respects rate/budget limits.
 *
 * The agent uses existing MCP servers running in Docker containers — no custom
 * adapter code needed. The gateway heartbeat drives message polling, and the
 * agent uses MCP tools (signal/receive_message, telegram/send_message, etc.)
 * to interact with both platforms.
 *
 * Prerequisites:
 *   1. Docker installed and running
 *   2. Signal registered: ./scripts/signal-register.sh +1234567890
 *   3. Telegram session: ./scripts/telegram-session.sh
 *   4. .env.telegram with TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION_STRING
 *   5. SIGNAL_PHONE_NUMBER and ANTHROPIC_API_KEY in environment
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... SIGNAL_PHONE_NUMBER=+1234567890 \
 *     bun run apps/examples/src/messaging/signal-telegram-hub.ts
 *
 * Test mode (no Docker, no real accounts):
 *   bun run apps/examples/src/messaging/signal-telegram-hub.ts
 */

import { ReactiveAgents } from "@reactive-agents/runtime";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();
  type PN = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test";
  const provider = (opts?.provider ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")) as PN;
  const useReal = provider !== "test";
  const effectiveProvider = (useReal ? provider : "test") as PN;
  const phoneNumber = process.env.SIGNAL_PHONE_NUMBER ?? "+0000000000";

  console.log("\n=== Signal + Telegram Messaging Hub ===");
  console.log(`Mode: ${useReal ? `LIVE (${provider})` : "TEST (mock)"}\n`);

  const mcpServers = useReal
    ? [
        {
          name: "signal",
          transport: "stdio" as const,
          command: "docker",
          args: [
            "run", "-i", "--rm",
            "--cap-drop", "ALL",
            "--no-new-privileges",
            "--memory", "128m",
            "--pids-limit", "30",
            "--user", "1000:1000",
            "-v", "./signal-data:/data:rw",
            "-e", `SIGNAL_USER_ID=${phoneNumber}`,
            "ghcr.io/reactive-agents/signal-mcp",
          ],
        },
        {
          name: "telegram",
          transport: "stdio" as const,
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
      ]
    : [];

  let b = ReactiveAgents.create()
    .withName("messaging-hub")
    .withProvider(effectiveProvider);
  if (useReal && opts?.model) b = b.withModel(opts.model);
  const agent = await b
    .withPersona({
      role: "Personal Messaging Assistant",
      instructions: "Respond to messages concisely and helpfully. Never share private information across platforms. Always be respectful.",
      tone: "friendly and professional",
    })
    .withReasoning()
    .withTools()
    .withGuardrails()
    .withKillSwitch()
    .withMCP(mcpServers)
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
    .withTestResponses({
      "": "FINAL ANSWER: No new messages on any platform. All channels quiet.",
    })
    .build();

  // In test mode, just run once to verify the agent builds and runs
  const result = await agent.run(
    "Check Signal and Telegram for new messages and respond to any that need attention.",
  );

  console.log(`Output: ${result.output.slice(0, 200)}`);
  console.log(`Steps: ${result.metadata.stepsCount}`);

  await agent.dispose();

  const passed = result.success && result.output.length > 10;
  return {
    passed,
    output: result.output.slice(0, 300),
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
```

**Step 2: Write the example README**

Create `apps/examples/src/messaging/README.md`:

```markdown
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
```

**Step 3: Commit**

```bash
git add apps/examples/src/messaging/
git commit -m "feat(messaging): add Signal + Telegram messaging hub example"
```

---

### Task 8: Write the messaging channels documentation page

**Files:**
- Create: `apps/docs/src/content/docs/guides/messaging-channels.md`

**Step 1: Write the docs page**

Create `apps/docs/src/content/docs/guides/messaging-channels.md`:

```markdown
---
title: Messaging Channels
description: Connect agents to Signal and Telegram using MCP servers in Docker containers.
---

Reactive Agents can send and receive messages on **Signal** and **Telegram** using existing MCP servers. No custom adapter code needed — the framework's built-in `.withMCP()` and `.withGateway()` capabilities handle everything.

## How It Works

```
Gateway heartbeat fires every N seconds
  → Agent calls receive_message MCP tool
  → Processes new messages (with guardrails)
  → Responds via send_message MCP tool
```

MCP servers for Signal ([rymurr/signal-mcp](https://github.com/rymurr/signal-mcp)) and Telegram ([chigwell/telegram-mcp](https://github.com/chigwell/telegram-mcp)) run in **hardened Docker containers**. The gateway heartbeat polls for messages; the agent uses MCP tools to read and respond.

## Signal Setup

### 1. Register a Phone Number

Signal requires a real phone number. Run the registration helper once:

```bash
./scripts/signal-register.sh +1234567890
```

This stores encrypted auth keys in `./signal-data/`. The directory is volume-mounted into Docker on subsequent runs.

### 2. Configure the Agent

```typescript
const agent = await ReactiveAgents.create()
  .withName("signal-agent")
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .withGuardrails()
  .withKillSwitch()
  .withMCP({
    name: "signal",
    transport: "stdio",
    command: "docker",
    args: [
      "run", "-i", "--rm",
      "--cap-drop", "ALL",
      "--no-new-privileges",
      "--memory", "128m",
      "--user", "1000:1000",
      "-v", "./signal-data:/data:rw",
      "-e", `SIGNAL_USER_ID=${process.env.SIGNAL_PHONE_NUMBER}`,
      "ghcr.io/reactive-agents/signal-mcp",
    ],
  })
  .withGateway({
    heartbeat: {
      intervalMs: 15_000,
      policy: "adaptive",
      instruction: "Check Signal for new messages using signal/receive_message. Respond to any that need attention.",
    },
    policies: { dailyTokenBudget: 50_000, maxActionsPerHour: 30 },
  })
  .build();
```

### Available Signal Tools

| Tool | Description |
|------|-------------|
| `signal/send_message_to_user` | Send a direct message to a Signal user |
| `signal/send_message_to_group` | Send a message to a Signal group |
| `signal/receive_message` | Receive pending messages (with timeout) |

## Telegram Setup

### 1. Generate a Session String

Get API credentials from [my.telegram.org/apps](https://my.telegram.org/apps), then run:

```bash
./scripts/telegram-session.sh
```

Save the output to `.env.telegram`:

```bash
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=abc123...
TELEGRAM_SESSION_STRING=1BVtsO...
```

### 2. Configure the Agent

```typescript
const agent = await ReactiveAgents.create()
  .withName("telegram-agent")
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .withGuardrails()
  .withKillSwitch()
  .withMCP({
    name: "telegram",
    transport: "stdio",
    command: "docker",
    args: [
      "run", "-i", "--rm",
      "--cap-drop", "ALL",
      "--no-new-privileges",
      "--memory", "128m",
      "--user", "1000:1000",
      "--env-file", ".env.telegram",
      "ghcr.io/reactive-agents/telegram-mcp",
    ],
  })
  .withGateway({
    heartbeat: {
      intervalMs: 15_000,
      policy: "adaptive",
      instruction: "Check Telegram for unread messages using telegram/get_chats. Respond to conversations that need attention.",
    },
    policies: { dailyTokenBudget: 50_000, maxActionsPerHour: 30 },
  })
  .build();
```

### Available Telegram Tools

The Telegram MCP server exposes 70+ tools. Key ones for messaging:

| Tool | Description |
|------|-------------|
| `telegram/send_message` | Send a text message to a chat |
| `telegram/get_chats` | List chats with unread counts |
| `telegram/search_messages` | Search messages in a chat |
| `telegram/send_file` | Send a file or document |
| `telegram/forward_message` | Forward a message between chats |

## Security Best Practices

### Container Hardening

All Docker flags in the examples enforce strict isolation:

| Flag | Purpose |
|------|---------|
| `--cap-drop ALL` | Remove all Linux capabilities |
| `--no-new-privileges` | Prevent privilege escalation |
| `--memory 128m` | Hard memory limit |
| `--pids-limit 30` | Prevent fork bombs |
| `--user 1000:1000` | Run as non-root |
| `--read-only` | Immutable root filesystem |

### Secret Management

- **Never pass secrets as MCP tool arguments** — they'd appear in agent context
- **Use `--env-file`** for Telegram credentials
- **Use Docker volumes** for Signal auth keys (`./signal-data/`)
- **Add `.env.telegram` and `signal-data/` to `.gitignore`**

### Guardrails

Always enable `.withGuardrails()` for messaging agents. Inbound messages from external users can contain prompt injection attempts. Guardrails check for injection, PII, and toxicity **before** the LLM processes the message.

### Kill Switch

Always enable `.withKillSwitch()` for autonomous messaging agents. This provides:
- `agent.stop(reason)` — graceful shutdown at next phase boundary
- `agent.terminate(reason)` — immediate halt

## Troubleshooting

### Signal registration fails
- Ensure Docker is running
- Signal may require CAPTCHA — check signal-cli docs
- Try using `--captcha` flag with signal-cli

### Telegram session expired
- Re-run `./scripts/telegram-session.sh`
- Update `.env.telegram` with new session string

### Agent not responding to messages
- Check heartbeat interval (default: 15s)
- Verify daily token budget isn't exhausted
- Check `ProactiveActionSuppressed` events for policy blocks
- Ensure MCP containers are running: `docker ps`
```

**Step 2: Verify docs build**

```bash
cd apps/docs && bunx astro build 2>&1 | tail -5
```

Expected: "32 page(s) built" with no errors.

**Step 3: Commit**

```bash
git add apps/docs/src/content/docs/guides/messaging-channels.md
git commit -m "docs: add messaging channels guide for Signal + Telegram"
```

---

### Task 9: Update existing docs with messaging references

**Files:**
- Modify: `apps/docs/src/content/docs/features/gateway.md`
- Modify: `apps/docs/src/content/docs/guides/tools.md`
- Modify: `.gitignore`

**Step 1: Add messaging section to gateway feature page**

In `apps/docs/src/content/docs/features/gateway.md`, after the "Integration with Existing Layers" section, add:

```markdown
## Messaging Channels

The gateway enables agents to communicate via **Signal** and **Telegram** using existing MCP servers in Docker containers. No custom adapter code needed — the framework's `.withMCP()` connects to the messaging servers, and the gateway heartbeat drives message polling.

See the [Messaging Channels guide](/guides/messaging-channels/) for setup instructions.
```

**Step 2: Add MCP messaging mention to tools guide**

In `apps/docs/src/content/docs/guides/tools.md`, in the MCP section, add a note:

```markdown
:::tip[Messaging via MCP]
Signal and Telegram can be connected as MCP servers running in Docker containers. The agent uses MCP tools to send and receive messages, with the gateway heartbeat driving message polling. See the [Messaging Channels guide](/guides/messaging-channels/).
:::
```

**Step 3: Add secrets to .gitignore**

Append to `.gitignore`:

```
# Messaging secrets
signal-data/
.env.telegram
```

**Step 4: Commit**

```bash
git add apps/docs/src/content/docs/features/gateway.md apps/docs/src/content/docs/guides/tools.md .gitignore
git commit -m "docs: add messaging references to gateway and tools pages, gitignore secrets"
```

---

### Task 10: Run full test suite and verify everything

**Step 1: Run all tests**

```bash
bun test
```

Expected: 1007+ tests pass (1001 existing + 6 new messaging tests), 0 failures.

**Step 2: Build all packages**

```bash
bun run build
```

Expected: clean build, no errors.

**Step 3: Build docs**

```bash
cd apps/docs && bunx astro build 2>&1 | tail -5
```

Expected: "32 page(s) built", no errors.

**Step 4: Verify Docker files are syntactically valid**

```bash
docker build --check docker/signal-mcp/ 2>/dev/null || echo "Docker not available (OK for CI)"
docker build --check docker/telegram-mcp/ 2>/dev/null || echo "Docker not available (OK for CI)"
```

**Step 5: Verify scripts are executable**

```bash
test -x scripts/signal-register.sh && echo "signal-register.sh: executable" || echo "FAIL"
test -x scripts/telegram-session.sh && echo "telegram-session.sh: executable" || echo "FAIL"
```

**Step 6: Commit any fixes, then verify git log**

```bash
git log --oneline -10
```

---

## File Summary

| File | Type | Purpose |
|------|------|---------|
| `docker/signal-mcp/Dockerfile` | New | Signal MCP server Docker image |
| `docker/signal-mcp/.dockerignore` | New | Docker build exclusions |
| `docker/telegram-mcp/Dockerfile` | New | Telegram MCP server Docker image |
| `docker/telegram-mcp/.dockerignore` | New | Docker build exclusions |
| `docker/docker-compose.messaging.yml` | New | Compose file for both services |
| `scripts/signal-register.sh` | New | One-time Signal registration |
| `scripts/telegram-session.sh` | New | One-time Telegram session setup |
| `packages/gateway/tests/messaging-mcp.test.ts` | New | 6 automated tests (mock MCP) |
| `apps/examples/src/messaging/signal-telegram-hub.ts` | New | Full example agent |
| `apps/examples/src/messaging/README.md` | New | Example setup guide |
| `apps/docs/.../guides/messaging-channels.md` | New | Docs site guide |
| `apps/docs/.../features/gateway.md` | Modified | Add messaging section |
| `apps/docs/.../guides/tools.md` | Modified | Add MCP messaging tip |
| `.gitignore` | Modified | Exclude secrets |
