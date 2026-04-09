---
title: Rax CLI
description: Rax (Reactive Agents Executable) is to Reactive Agents what Artisan is to Laravel.
sidebar:
    hidden: true
---

`Rax` stands for **Reactive Agents Executable**.

`rax` is to Reactive Agents what Artisan CLI is to Laravel: the primary command-line interface for building, running, and operating your application.

The framework gives you composable layers and a powerful runtime. The CLI turns that power into a fast daily workflow: scaffold, run, inspect, serve, and deploy without ceremony.

## Why Start with Rax

-   **Faster time-to-first-agent**: scaffold a working project in one command.
-   **Consistent team workflows**: shared command surface for dev, test, inspect, and deploy.
-   **Production-friendly defaults**: safe templates, explicit provider/model flags, and clear runtime options.
-   **No hidden magic**: every command maps to framework capabilities you can later customize in code.

## The Core Flow

```bash
# 1) Scaffold a project
bunx rax init my-agent --template standard
cd my-agent
bun install

# 2) Generate an agent starter
rax create agent researcher --recipe researcher

# 3) Run with reasoning + tools
rax run "Summarize this week in AI" --provider anthropic --reasoning --tools --stream

# 4) Explore interactively
rax playground --provider anthropic --tools --reasoning

# 5) Inspect runtime signals
rax inspect researcher
```

## Command Surface at a Glance

-   `rax init`: create a project with minimal, standard, or full templates.
-   `rax create agent`: scaffold role-specific agent starters.
-   `rax run`: execute prompts with provider/model/capability flags.
-   `rax cortex`: launch the **Cortex** local studio — live agent grid, trace panel, chat, signal charts.
-   `rax playground`: interactive loop with tool and thought streaming.
-   `rax serve`: expose an A2A-compatible server.
-   `rax discover`: inspect remote A2A agent cards.
-   `rax deploy`: deploy through local or cloud adapters.
-   `rax inspect`: debug runtime signals and logs.
-   `rax dev`: run entrypoints in watch mode.

## Cortex — Local Agent Studio

The most powerful dev workflow pairs `rax run` with `rax cortex`:

```bash
# Terminal 1 — open the Cortex studio
rax cortex --dev
# Opens http://localhost:5173 (API on :4321)

# Terminal 2 — run an agent that streams to Cortex
rax run "Research the top 5 AI agent frameworks" \
  --provider anthropic \
  --reasoning \
  --tools \
  --cortex
```

The `--cortex` flag calls `.withCortex()` on the builder, which streams every EventBus event to Cortex over WebSocket. You get:

-   **Beacon grid** — live cognitive-state tiles for every connected agent
-   **D3 entropy signal** — real-time chart of reasoning quality across iterations
-   **Trace panel** — step-by-step Thought → Action → Observation breakdown
-   **Debrief card** — structured post-run summary with confidence and sources
-   **Persistent history** — every run is saved to SQLite and fully replayable

You can also set `CORTEX_URL` to target a different host:

```bash
CORTEX_URL=http://cortex.internal:4321 \
  rax run "Task" --cortex --provider anthropic
```

> See [Cortex Studio](/features/cortex/) for the full feature reference and `.withCortex()` SDK docs.

## When to Use CLI vs SDK

Use `rax` when you want speed and operational consistency.
Use the SDK directly when you need deep, application-specific composition.
Most teams use both: CLI for workflow, SDK for custom behavior.

## Next Steps

-   [Quickstart](../quickstart/) for a five-minute setup
-   [CLI Reference](../../reference/cli/) for full command details
-   [Builder API](../../reference/builder-api/) for low-level composition
