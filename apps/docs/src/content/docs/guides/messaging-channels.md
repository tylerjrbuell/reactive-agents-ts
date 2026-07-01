---
title: Messaging Channels
description: >-
  Connect agents to Signal (Docker MCP in this repo) and Telegram (upstream MCP
  via uv or your own runner).
sidebar:
  order: 19
lastCommit:
  subject: 'docs(badges): fix daysAgo render-time + remove dead constant'
  hash: f625612
  date: '2026-07-01'
badge:
  text: Updated
  variant: note
  __auto: '1'
---

Reactive Agents can send and receive messages on **Signal** and **Telegram** using MCP servers wired through `.withMCP()` and `.withGateway()`. **Signal** ships as a hardened **Docker image** in this repo because there is no maintained third-party MCP with the same behavior. **Telegram** uses the community **[chigwell/telegram-mcp](https://github.com/chigwell/telegram-mcp)** project — run it with **`uvx`**, a local clone, or your own container; we do **not** publish a Telegram image from this monorepo.

## How It Works

```
Gateway heartbeat fires every N seconds
  → Agent calls receive_message MCP tool
  → Processes new messages (with guardrails)
  → Responds via send_message MCP tool
```

The **Signal** MCP server is a custom TypeScript implementation (`docker/signal-mcp/server/`) that spawns signal-cli in persistent `jsonRpc` mode — a single JVM boot with instant command execution (no cold starts per message). It is the supported way to attach Signal to the gateway.

**Telegram:** use **[chigwell/telegram-mcp](https://github.com/chigwell/telegram-mcp)** directly. Plain `pip install telegram-mcp` / `uvx telegram-mcp` **without** `--from` pointing at chigwell’s sources often resolves to a **different** PyPI project (hosted relay) that expects `TELEGRAM_CHAT_ID` — not the Telethon user MCP described here.

The gateway heartbeat (or webhooks) drives when the agent runs; the agent uses MCP tools to read and respond. Signal can also push `notifications/message` for faster inbound handling; Telegram typically relies on polling tools unless you add a separate relay.

## Signal Setup

### 1. Build the Docker Image

```bash
docker build -t signal-mcp:local docker/signal-mcp/
```

### 2. Register a Phone Number

Signal requires a real phone number and a captcha. Run the registration helper:

```bash
./scripts/signal-register.sh +1234567890
```

This will:
1. Ask you to solve a captcha at https://signalcaptchas.org/registration/generate
2. Send a verification code to your phone
3. Store encrypted auth keys in `./signal-data/`

The data directory is volume-mounted into Docker on subsequent runs.

### 3. Configure the Agent

```typescript
const agent = await ReactiveAgents.create()
  .withName("signal-agent")
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .withGuardrails()
  .withKillSwitch()
  .withMCP([{
    name: "signal",
    transport: "stdio",
    command: "docker",
    args: [
      "run", "-i", "--rm",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "--memory", "512m",
      "-v", "./signal-data:/data:rw",
      "-e", `SIGNAL_USER_ID=${process.env.SIGNAL_PHONE_NUMBER}`,
      "signal-mcp:local",
    ],
  }])
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
| `signal/list_groups` | List all Signal groups the account belongs to |

## Telegram Setup

There is **no** `docker/telegram-mcp/` image in this repository. Install **[uv](https://docs.astral.sh/uv/)** (or follow upstream’s clone + `uv sync` workflow), then point `.withMCP()` at the `telegram-mcp` console entrypoint from **chigwell’s** sources.

### 1. Generate a session string

Get API credentials from [my.telegram.org/apps](https://my.telegram.org/apps), then run:

```bash
./scripts/telegram-session.sh
```

Export the values in your shell (or use a secrets manager). Example:

```bash
export TELEGRAM_API_ID=12345678
export TELEGRAM_API_HASH=abc123...
export TELEGRAM_SESSION_STRING=1BVtsO...
```

### 2. Configure the agent (`uvx`)

Pin a **tag or revision** you trust (`v3.0.4` is an example):

```typescript
const agent = await ReactiveAgents.create()
  .withName("telegram-agent")
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .withGuardrails()
  .withKillSwitch()
  .withMCP([{
    name: "telegram",
    transport: "stdio",
    command: "uvx",
    args: [
      "--from",
      "git+https://github.com/chigwell/telegram-mcp.git@v3.0.4",
      "telegram-mcp",
    ],
    env: {
      TELEGRAM_API_ID: process.env.TELEGRAM_API_ID ?? "",
      TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH ?? "",
      TELEGRAM_SESSION_STRING: process.env.TELEGRAM_SESSION_STRING ?? "",
    },
  }])
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

Alternatives: run `uv run main.py` from a checkout of chigwell/telegram-mcp, or wrap upstream in **your own** Docker image — keep that outside this monorepo unless you want to contribute it as a separate published image.

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

### Container Hardening (Signal)

The Signal Docker example uses strict isolation:

| Flag | Purpose |
|------|---------|
| `--cap-drop ALL` | Remove all Linux capabilities |
| `--no-new-privileges` | Prevent privilege escalation |
| `--memory 512m` | Hard memory limit (Signal needs 512m for JVM) |
| `--pids-limit 30` | Prevent fork bombs |
| `--user 1000:1000` | Run as non-root |
| `--read-only` | Immutable root filesystem |

Telegram via `uvx` runs as your host user; apply process isolation separately if you need a sandbox.

### Secret Management

- **Never pass secrets as MCP tool arguments** — they'd appear in agent context
- **For Telegram with `uvx`:** pass credentials via `.withMCP({ env: { ... } })` or your process manager — avoid putting secrets in MCP `args`
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
- Signal requires a CAPTCHA — see the registration script
- The Docker image requires glibc (not Alpine) for signal-cli's native library

### Telegram session expired
- Re-run `./scripts/telegram-session.sh`
- Update `.env.telegram` with new session string

### `TELEGRAM_CHAT_ID environment variable required`
- You are running the **wrong** PyPI `telegram-mcp` (hosted relay), not chigwell’s Telethon server.
- Use `uvx --from git+https://github.com/chigwell/telegram-mcp.git@<tag> telegram-mcp` (or upstream’s documented install), not bare `uvx telegram-mcp` from PyPI.

### `BotMethodInvalidError` / `GetDialogsRequest` / “cannot be executed as a bot”
- chigwell/telegram-mcp is a **user-account** Telethon client (full dialogs, send as you). It does **not** work with a **@BotFather bot** session string.
- Regenerate `TELEGRAM_SESSION_STRING` using `./scripts/telegram-session.sh` and sign in with your **personal Telegram account** (SMS / Telegram OTP), not a bot token.

### Agent not responding to messages
- Check heartbeat interval (default: 15s)
- Verify daily token budget isn't exhausted
- Check `ProactiveActionSuppressed` events for policy blocks
- Ensure the Signal container (if used) is running: `docker ps`
- For Telegram, confirm `uvx` resolves chigwell’s package and that `TELEGRAM_*` env vars are set for the MCP subprocess
