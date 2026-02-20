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
