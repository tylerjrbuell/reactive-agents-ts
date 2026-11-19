---
name: cortex-studio
description: Run Cortex, the local Reactive Agents studio, connect agents with withCortex(), and configure its chat, Lab, approvals, voice, provider keys and request guard.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "1.0"
  tier: "capability"
---

# Cortex Studio

## Agent objective

Get a Cortex server running, stream an agent's events into it, and set it up safely (keys, host allowlist, approvals). Full docs: `/features/cortex/` on the docs site.

## When to load this skill

- The user wants to watch runs live, inspect traces, or chat with an agent in a browser
- Connecting an app or `rax run` to a running Cortex
- Setting up local models (Ollama), Ollama Cloud, or local speech (Speaches) in Cortex
- Exposing Cortex beyond loopback, or hitting `403 Forbidden: Host or Origin not allowed`

## Implementation baseline

```bash
bun add @reactive-agents/cortex
rax cortex                 # API + UI on http://127.0.0.1:4321, opens the browser
rax run "your task" --provider anthropic --reasoning --tools --cortex
```

```ts
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools({ builtins: true })
  .withCortex() // explicit URL, else CORTEX_URL, else http://localhost:4321
  .build();

await agent.run("Research AI agent frameworks");
```

The connection is best-effort: if Cortex is down, the agent runs normally and logs one warning.

## Where things are

- **Beacon** (`/`): live agents. **Runs** (`/runs`): history, compare, resume. **Run view** (`/run/<id>`): trace, Why it ended, inspector tabs.
- **Chat** (`/chat`): quick bar and Config popover; `/mcp`, `/btw`, `/goal`, `/plan`, `/go`, `/loop`, `/schedule`, `/agent on`, `/compact`; `@` tags workspace files; the paperclip attaches pictures, audio and text files.
- **Lab** (`/lab`): Builder, Saved agents, Skills, Memory, Tools, Prompts. Export an agent as TypeScript or JSON. Tools has three sub-tabs: Servers (MCP: state, Test, Enable switch, tools, options, write-only credentials), Custom tools (create and edit), Catalog and test.
- **Settings** (`/settings`): provider keys (encrypted on the server, never returned to the browser), voice, storage.

## Safety rules

1. Cortex has no login. Keep it on `127.0.0.1` unless the network is trusted.
2. Behind a DNS name or proxy, set `CORTEX_ALLOWED_HOSTS=name1,name2`. The Host and Origin guard refuses other names with 403.
3. `shell-execute` is off by default; gate risky tools and commands with Approvals (Tools section). "Pause and ask me" waits live without durable execution.
4. Ollama Cloud keys are sent only to non-local endpoints. Judgments cannot use Ollama Cloud.

## Environment variables

`CORTEX_PORT` (4321), `CORTEX_HOST` (127.0.0.1), `CORTEX_TOKEN` (access token; required when `CORTEX_HOST` is not loopback, otherwise Cortex refuses to start), `CORTEX_URL`, `CORTEX_ALLOWED_HOSTS`, `CORTEX_NO_OPEN`, `CORTEX_LOG`, `CORTEX_SKILL_SCAN_ROOT`, `CORTEX_CHAT_MAX_SESSIONS` (8), `CORTEX_VOICE_STT_API_KEY`, `CORTEX_VOICE_TTS_API_KEY`.

## Voice with a local server

Settings, Voice: pick the server engine and a Speaches preset (`http://localhost:8000/v1`), download models first (`curl -X POST http://127.0.0.1:8000/v1/models/Systran/faster-whisper-small`), then Save endpoint and Test.

## Pitfalls

- Mic access needs `localhost` or https.
- Goals own their chat session: plain messages return 409 while a goal is active.
- Cortex shows judgments and rubric goal checks; eval suites live in `@reactive-agents/eval`, not a Cortex screen.
