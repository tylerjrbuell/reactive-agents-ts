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

- **Faster time-to-first-agent**: scaffold a working project in one command.
- **Consistent team workflows**: shared command surface for dev, test, inspect, and deploy.
- **Production-friendly defaults**: safe templates, explicit provider/model flags, and clear runtime options.
- **No hidden magic**: every command maps to framework capabilities you can later customize in code.

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

- `rax init`: create a project with minimal, standard, or full templates.
- `rax create agent`: scaffold role-specific agent starters.
- `rax run`: execute prompts with provider/model/capability flags.
- `rax playground`: interactive loop with tool and thought streaming.
- `rax serve`: expose an A2A-compatible server.
- `rax discover`: inspect remote A2A agent cards.
- `rax deploy`: deploy through local or cloud adapters.
- `rax inspect`: debug runtime signals and logs.
- `rax dev`: run entrypoints in watch mode.

## When to Use CLI vs SDK

Use `rax` when you want speed and operational consistency.
Use the SDK directly when you need deep, application-specific composition.
Most teams use both: CLI for workflow, SDK for custom behavior.

## Next Steps

- [Quickstart](../quickstart/) for a five-minute setup
- [CLI Reference](../../reference/cli/) for full command details
- [Builder API](../../reference/builder-api/) for low-level composition
