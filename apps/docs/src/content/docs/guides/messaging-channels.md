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
1. Ask you to solve a captcha at https://signalcaptchas.org/registration/generate.html
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
      "--no-new-privileges",
      "--memory", "128m",
      "--user", "1000:1000",
      "-v", "./signal-data:/data:rw",
      "-e", `SIGNAL_USER_ID=${process.env.SIGNAL_PHONE_NUMBER}`,
      "signal-mcp:local",
      "--user-id", process.env.SIGNAL_PHONE_NUMBER!,
      "--transport", "stdio",
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
  .withMCP([{
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
- Signal requires a CAPTCHA — see the registration script
- The Docker image requires glibc (not Alpine) for signal-cli's native library

### Telegram session expired
- Re-run `./scripts/telegram-session.sh`
- Update `.env.telegram` with new session string

### Agent not responding to messages
- Check heartbeat interval (default: 15s)
- Verify daily token budget isn't exhausted
- Check `ProactiveActionSuppressed` events for policy blocks
- Ensure MCP containers are running: `docker ps`
