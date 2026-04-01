---
title: CLI Reference
description: Command reference for Rax, the CLI for Reactive Agents.
---

`rax` is the artisan command line for Reactive Agents.

`Rax` stands for **Reactive Agents Executable**.
Think of it as the Reactive Agents equivalent of Laravel's Artisan CLI.

Use it to scaffold projects, generate agents, run and stream tasks, inspect runtime state, serve A2A endpoints, and deploy across local and cloud targets.

For workflow-first onboarding, start with [Rax CLI](/guides/cli-artisan/).

## Commands

### `rax init`

Create a new Reactive Agents project.

```bash
rax init <name> [--template minimal|standard|full]
```

**Templates:**

All templates install the single unified `reactive-agents` package — no need to install individual `@reactive-agents/*` packages separately.

| Template   | What's scaffolded                                                          |
|------------|----------------------------------------------------------------------------|
| `minimal`  | `reactive-agents` + bare agent that answers questions                      |
| `standard` | `reactive-agents` + adaptive reasoning, tools, observability dashboard     |
| `full`     | `reactive-agents` + reasoning, tools, memory, guardrails, cost, health check |

Generated `src/index.ts` imports from `"reactive-agents"` and is runnable immediately after `bun install && cp .env.example .env`.

### `rax create agent`

Generate an agent file from a recipe, or use `--interactive` for guided scaffolding.

```bash
rax create agent <name> [--recipe basic|researcher|coder|orchestrator]
rax create agent <name> --interactive
```

**Recipes:**

| Recipe | What It Generates |
|--------|------------------|
| `basic` | Minimal agent with LLM only |
| `researcher` | Agent with memory + reasoning |
| `coder` | Agent optimized for code tasks |
| `orchestrator` | Multi-agent orchestrator with memory |

**Interactive mode:**

The `--interactive` flag launches a readline-based wizard (TTY only) that prompts for:

1. **Agent name** — defaults to the first positional argument if you pass one (e.g. `rax create agent my-agent --interactive`).
2. **Provider** — one of `anthropic`, `openai`, `ollama`, or `gemini` (same set the wizard validates today).
3. **Recipe** — `basic`, `researcher`, `coder`, or `orchestrator`.
4. **Features** — comma-separated list; default `reasoning,tools`. This is collected for the session; the **generated file is determined only by the recipe** (templates live in `apps/cli/src/generators/agent-generator.ts`). Adjust `.withProvider()`, `.withModel()`, and builder flags in the generated source after scaffolding if you need a different stack.

```bash
$ rax create agent my-agent --interactive

Create Agent (Interactive)
? Agent name: my-research-agent
? Provider [anthropic/openai/ollama/gemini]: anthropic
? Recipe [basic/researcher/coder/orchestrator]: researcher
? Features (comma-separated) (reasoning,tools): reasoning,tools

✔ Created: src/agents/my-research-agent.ts
```

### `rax run`

Run an agent with a prompt.

```bash
rax run <prompt> [--provider anthropic|openai|ollama|gemini|litellm|test]
          [--model <model>] [--name <name>] [--tools] [--reasoning] [--stream] [--cortex]
```

**`--cortex`:** Enables `.withCortex()` on the builder so run lifecycle events are sent to a local **Cortex** companion studio (WebSocket ingest). Start the studio with `rax cortex` in another terminal, or set `CORTEX_URL` to the HTTP base (default `http://127.0.0.1:4321`). See `rax cortex --help` for ports, static UI bundle, and env vars.

**Example:**

```bash
rax run "Explain quantum computing" --provider anthropic --model claude-sonnet-4-20250514
```

### `rax cortex`

Start the **Cortex** studio: HTTP API, WebSocket `/ws/ingest`, and the static UI when a bundle is present.

```bash
rax cortex [--dev] [--port <n>] [--no-open] [--help]
```

| Flag | Purpose |
|------|---------|
| `--dev` | Start **API + Vite dev UI** together (same as `cd apps/cortex && bun start`). Open **http://localhost:5173**; Vite proxies `/api` and `/ws` to the API port (`CORTEX_PORT`). |
| `--port <n>` | API listen port (default `4321`). Passed through so the dev UI proxy matches. |

| Variable | Purpose |
|----------|---------|
| `CORTEX_PORT` | API listen port (default `4321`); also read by `apps/cortex/ui` Vite proxy when using `--dev` |
| `CORTEX_NO_OPEN` | Set to `1` to skip opening a browser |
| `CORTEX_URL` | Injected for the child server process so desk runners target the right host |
| `CORTEX_STATIC_PATH` | Directory containing built `index.html` (CLI `build:cortex-ui`; not used when `--dev`) |

**Example:**

```bash
rax cortex --dev
# other terminal:
rax run "Research topic" --cortex --provider anthropic
```

### `rax serve`

Start an agent as an A2A server.

```bash
rax serve [--port <number>] [--name <name>] [--provider <provider>] [--model <model>]
          [--with-tools] [--with-reasoning] [--with-memory]
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--port` | `3000` | HTTP port for the A2A server |
| `--name` | `"agent"` | Agent name (used in Agent Card) |
| `--provider` | `"test"` | LLM provider |
| `--model` | — | Model name |
| `--with-tools` | off | Enable built-in tools on the A2A server agent (file-write, web-search, etc.) |
| `--with-reasoning` | off | Enable reasoning strategies |
| `--with-memory` | off | Enable memory. With no extra token: default tier (`.withMemory()`). Pass `enhanced` or `2` immediately after the flag for full four-layer memory with embeddings (`.withMemory({ tier: "enhanced" })`). Optional `basic` or `1` after the flag keeps the default tier and consumes that token (same behavior as omitting it). |

**Endpoints served:**

- `GET /.well-known/agent.json` — Agent Card (A2A discovery)
- `GET /agent/card` — Agent Card (fallback)
- `POST /` — JSON-RPC 2.0 (`message/send`, `tasks/get`, `tasks/cancel`, `agent/card`)

**Example:**

```bash
rax serve --name researcher --provider anthropic --model claude-sonnet-4-20250514 --with-tools --port 4000
```

### `rax discover`

Fetch and display the Agent Card from a remote A2A-compatible agent server.

```bash
rax discover <url>
```

Fetches `GET <url>/.well-known/agent.json` and pretty-prints the agent's name, description, capabilities, and supported skills.

**Example:**

```bash
rax discover http://localhost:3000
```

```
Agent Card: researcher
  Provider: anthropic (claude-sonnet-4-20250514)
  Capabilities: streaming, tools
  Skills: web-search, file-write
  Endpoint: http://localhost:3000
```

### `rax deploy`

Deploy an agent using a provider adapter (local Docker, Fly.io, Railway, Render, Cloud Run, DigitalOcean).

```bash
rax deploy up [--target local|fly|railway|render|cloudrun|digitalocean]
              [--mode daemon|sdk]
              [--dry-run]
              [--scaffold-only]
              [--name <agent-name>]

rax deploy down [--target <target>]
rax deploy status [--target <target>]
rax deploy logs [-f] [--target <target>]
rax deploy init   # legacy alias for `deploy up --scaffold-only`
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--target` | `local` (auto-detected if config exists) | Deploy provider adapter |
| `--mode` | `daemon` | `daemon` for full agent loop, `sdk` for HTTP API mode |
| `--dry-run` | off | Run provider `preflight()` checks and print execution plan |
| `--scaffold-only` | off | Generate config files only, do not deploy |
| `--name` | auto-detected from `package.json` | Agent/app identifier |
| `--follow`, `-f` | off | Follow logs for `deploy logs` |

**Provider CLI Contracts:**

These commands and flags are validated by `apps/cli/tests/cli-contracts.test.ts` to detect upstream CLI breaking changes early.

| Provider | CLI | Contract Baseline |
|----------|-----|-------------------|
| local | Docker + Compose | Docker `>= 20`, Compose `>= 2`, supports `compose build/up/down/ps/logs`, `up -d`, `logs --tail/--follow`, `ps --format` |
| fly | `flyctl` / `fly` | supports `auth whoami`, `launch --copy-config --name --no-deploy`, `deploy`, `status`, `logs`, `apps destroy --yes` |
| railway | `railway` | supports `whoami`, `link`, `up`, `down --yes`, `status`, `logs`, `variables` |
| render | `render` | supports `blueprint launch`, `services list` |
| cloudrun | `gcloud` | SDK `>= 380`, supports `config get-value project`, `auth list --filter --format`, `run deploy --source --region --port --memory --timeout --allow-unauthenticated`, `run services describe/delete/update` |
| digitalocean | `doctl` | `>= 1.72`, supports `account get --format --no-header`, `apps create/list/update/delete/logs`, `--spec`, `--format` |

**Containerized CLI fallback:**

For `flyctl`, `gcloud`, and `doctl`, `rax deploy` resolves local binaries first and can fall back to a Docker-wrapped CLI when Docker is available.

**Contract test commands:**

```bash
bun test apps/cli/tests/cli-contracts.test.ts
RUN_SLOW_TESTS=1 bun test apps/cli/tests/cli-contracts.test.ts
```

`RUN_SLOW_TESTS=1` enables container image availability checks for the fallback images.

### `rax dev`

Run your local entrypoint in watch mode.

```bash
rax dev [--entry src/index.ts] [--no-watch]
```

Default entrypoint is `src/index.ts`. Use `--entry` if your project uses a different file.

### `rax eval`

Run an evaluation suite (placeholder).

```bash
rax eval run --suite <suite-name>
```

### `rax playground`

Launch an interactive agent REPL session.

```bash
rax playground [--provider <provider>] [--model <model>] [--tools] [--reasoning] [--stream]
```

Use `/help` and `/exit` inside the session.

### `rax inspect`

Inspect local deployment/runtime signals for an `agentId`.

```bash
rax inspect <agent-id> [--logs-tail 200] [--json]
```

This checks Docker/Compose availability, prints compose status, and scans recent logs for lines containing the provided `agentId`.

### `rax version`

```bash
rax version
rax --version
rax -v
```

### `rax help`

```bash
rax help
rax --help
rax -h
```
