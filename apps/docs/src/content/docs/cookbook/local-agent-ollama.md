---
title: Build a Local AI Agent with Ollama in TypeScript
description: >-
  Step-by-step tutorial to build and run a local AI agent in TypeScript with
  Ollama — no API key, full privacy, and one-line parity with frontier models.
sidebar:
  order: 30
badge:
  text: New in v0.12
  variant: success
  __auto: '1'
lastCommit:
  subject: 'docs(seo): pillar page + 3 intent tutorials + awesome-list campaign'
  hash: b934c56
  date: '2026-06-26'
  daysAgo: 5
since: v0.12
---

This is a complete, runnable guide to **building a local AI agent in TypeScript with Ollama**. You will install Ollama, pull a small open model, wire it into Reactive Agents, give it tools, tune it for small-model reliability, and — the payoff — swap to a frontier API by changing a single line. The same agent code runs on a 4B model on your laptop and on Claude or GPT in production.

## Why run an AI agent locally?

Running a local LLM agent has three concrete advantages over calling a hosted API:

- **Privacy** — prompts, tool results, and documents never leave your machine. Nothing is logged by a third party.
- **Cost** — local inference is free. You pay for electricity, not per-token API billing. An agent that loops through many reasoning steps costs $0 to run locally.
- **No API key, no rate limits** — pull a model and go. No account, no quota, no network dependency.

The historical downside was quality: small open models were unreliable at tool calling, the core skill an agent needs. Reactive Agents closes most of that gap. A **Healing Pipeline** normalizes malformed tool calls from small models, and **model-adaptive context profiles** trim prompts and compact history so a 4B model isn't drowned in tokens. The result is local-to-frontier parity: write the agent once, run it anywhere.

## Prerequisites

- **[Ollama](https://ollama.com)** installed and running. On macOS/Linux:
  ```bash
  curl -fsSL https://ollama.com/install.sh | sh
  ```
- **A pulled model.** Start with a small, fast one:
  ```bash
  ollama pull qwen3:4b
  ```
  For tool-heavy work, `qwen3:14b` is the most reliable local model at its size (see [Local Models](/guides/local-models/) for the full comparison).
- **[Bun](https://bun.sh)** ≥ 1.0 (or Node ≥ 20). This guide uses Bun.

Confirm Ollama is serving on its default port (`http://localhost:11434`):

```bash
ollama list   # should show qwen3:4b
```

## Step 1 — Install Reactive Agents

```bash
mkdir local-agent && cd local-agent
bun init -y
bun add reactive-agents
```

`effect` ships as a dependency and installs automatically — you only import it directly if you write custom tools or hooks.

## Step 2 — A minimal local agent

Create `src/agent.ts`. This is the smallest agent that **builds a local AI agent in TypeScript with Ollama** — no API key required:

```typescript title="src/agent.ts"
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("qwen3:4b")
  .build();

const result = await agent.run("Explain what an AI agent is in two sentences.");
console.log(result.output);
```

Run it:

```bash
bun run src/agent.ts
```

The agent talks to your local Ollama server — the prompt never leaves the machine. `result.output` holds the model's answer; `result.metadata` carries `{ duration, cost, tokensUsed, stepsCount }`, and `cost` is `0` because there's no API meter.

## Step 3 — Give the agent tools and reasoning

A model that only chats isn't an agent. Add `.withReasoning()` to enable the Think → Act → Observe loop and `.withTools()` to register the built-in toolset (file read/write, HTTP, code execution, crypto prices, git, and more):

```typescript title="src/agent.ts"
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("qwen3:4b")
  .withReasoning()                                   // Think → Act → Observe loop
  .withTools({ allowedTools: ["http-get", "file-write"] }) // scope to a small tool set
  .build();

const result = await agent.run(
  "Fetch https://api.github.com/repos/oven-sh/bun and write the star count to stars.txt",
);
console.log(result.output);
```

Tools are passed to the model through Ollama's native function-calling API. When the model decides to act, the framework validates the arguments against the tool schema, runs the tool in a sandbox, and feeds the real result back into the loop.

:::tip[Keep the tool set small for small models]
Scope tools with `.withTools({ allowedTools: [...] })`. A 4B model picks the right tool far more reliably from 3–5 options than from the full built-in set. `allowedTools` is the small-model-friendly way to narrow the surface.
:::

## Step 4 — Tune for small models

Small models need leaner prompts and a sized context window. Two methods do the heavy lifting.

**Context profile** — `.withContextProfile({ tier: "local" })` switches on lean prompts, aggressive history compaction, and 800-character tool-result truncation. Without it the framework defaults to the verbose `"large"` tier, which wastes tokens and confuses small models.

**Context window** — pass the object form of `.withModel()` to set Ollama's `num_ctx` exactly. The profile tunes *how* the prompt is built; `numCtx` sets *how much* context Ollama allocates.

```typescript title="src/agent.ts"
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("local-researcher")
  .withProvider("ollama")
  .withModel({ model: "qwen3:4b", numCtx: 32768 })   // exact num_ctx sent to Ollama
  .withReasoning({ defaultStrategy: "reactive" })     // ReAct is the most reliable local strategy
  .withTools({ allowedTools: ["http-get", "file-read", "file-write"] })
  .withContextProfile({ tier: "local" })              // lean prompts + aggressive compaction
  .withMaxIterations(8)                               // cap the loop so it can't run away
  .build();

const result = await agent.run(
  "Read notes.md, summarize the key points, and write the summary to summary.md",
);
console.log(result.output);
console.log(result.metadata); // { duration, cost: 0, tokensUsed, stepsCount }
```

Stick with the `"reactive"` (ReAct) strategy on local models. Heavier strategies like Plan-Execute or Tree-of-Thought rely on structured generation that's fragile below ~14B parameters.

## Step 5 — Swap to a frontier model in one line

Here's the parity payoff. Nothing about the agent's logic, tools, or prompts is tied to Ollama. To run the exact same agent on a frontier API, change the provider and model — and add the relevant API key to your environment:

```typescript title="src/agent.ts" {5-6}
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("cloud-researcher")
  .withProvider("anthropic")                          // was "ollama"
  .withModel("claude-sonnet-4-6")                     // was "qwen3:4b"
  .withReasoning({ defaultStrategy: "reactive" })
  .withTools({ allowedTools: ["http-get", "file-read", "file-write"] })
  .withContextProfile({ tier: "frontier" })           // was "local"
  .withMaxIterations(8)
  .build();

const result = await agent.run(
  "Read notes.md, summarize the key points, and write the summary to summary.md",
);
console.log(result.output);
```

```bash
# .env — only needed for hosted providers
ANTHROPIC_API_KEY=sk-ant-...
```

Develop and iterate locally for free, then ship the same code against a frontier model when you need maximum quality. Bump the context tier to `"frontier"` to take advantage of the larger window. That's the whole change.

## Troubleshooting

**`model "qwen3:4b" not found`** — the model isn't pulled. Run `ollama pull qwen3:4b` and confirm with `ollama list`. The model name in `.withModel()` must match an entry in that list exactly.

**Connection refused / agent hangs at start** — the Ollama server isn't running. Start it (the desktop app, or `ollama serve`) and verify it answers on `http://localhost:11434`.

**Tool calls fail or use wrong parameter names** — this is the classic small-model failure, and it's largely handled for you: the Healing Pipeline corrects malformed tool names, parameter names, paths, and types before they error out. To improve it further, set `.withContextProfile({ tier: "local" })`, keep the tool set to 3–5 via `.withTools({ allowedTools: [...] })`, and prefer `qwen3:14b` over a 4B model for tool-heavy work.

**The agent loops without making progress** — the circuit breaker catches most loops, but you can tighten the cap with `.withMaxIterations(5)` and simplify the prompt.

**Out of memory / Ollama crashes** — use a smaller model or a quantized build, e.g. `ollama pull qwen3:14b-q4_K_M` (~60% less memory, minimal quality loss).

## Next steps

You now have a working local AI agent in TypeScript that runs entirely on Ollama and ports to frontier APIs without a rewrite. Go deeper:

- **[Local Models Guide](/guides/local-models/)** — model recommendations by task, context tiers, strategy fit, and cost comparison.
- **[Tools Guide](/guides/tools/)** — built-in tools, custom tools via `ToolBuilder`, MCP servers, and tool-result compression.
- **[Quickstart](/guides/quickstart/)** — the broader 5-minute walkthrough and `HarnessProfile` presets.
