---
title: CLI Reference
description: Command reference for the rax CLI.
---

The `rax` CLI provides project scaffolding, agent generation, and agent execution.

## Commands

### `rax init`

Create a new Reactive Agents project.

```bash
rax init <name> [--template minimal|standard|full]
```

**Templates:**

| Template | Packages Included |
|----------|------------------|
| `minimal` | core, runtime, llm-provider |
| `standard` | + memory, reasoning, tools |
| `full` | + guardrails, verification, cost, orchestration, prompts |

### `rax create agent`

Generate an agent file from a recipe.

```bash
rax create agent <name> [--recipe basic|researcher|coder|orchestrator]
```

**Recipes:**

| Recipe | What It Generates |
|--------|------------------|
| `basic` | Minimal agent with LLM only |
| `researcher` | Agent with memory + reasoning |
| `coder` | Agent optimized for code tasks |
| `orchestrator` | Multi-agent orchestrator with memory |

### `rax run`

Run an agent with a prompt.

```bash
rax run <prompt> [--provider anthropic|openai|ollama|test] [--model <model>] [--name <name>]
```

**Example:**

```bash
rax run "Explain quantum computing" --provider anthropic --model claude-sonnet-4-20250514
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
| `--with-memory` | off | Enable memory (tier 2) |

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

### `rax dev`

Start the development server (placeholder).

```bash
rax dev
```

### `rax eval`

Run an evaluation suite (placeholder).

```bash
rax eval run --suite <suite-name>
```

### `rax playground`

Launch interactive REPL (placeholder).

```bash
rax playground
```

### `rax inspect`

Inspect agent state (placeholder).

```bash
rax inspect <agent-id> [--trace last]
```

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
