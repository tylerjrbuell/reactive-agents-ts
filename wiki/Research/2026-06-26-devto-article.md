---
# Dev.to front matter — paste into the editor's front matter, or set via the UI.
title: "I built a TypeScript agent framework where the same code runs on a 4B local model and on Claude"
published: false
description: "The ecosystem says don't put a small model in an agent loop. Here's how I made the same agent code finish a tool task on a 4B Ollama model and on Claude — and the typed-effect runtime underneath."
tags: typescript, ai, llm, webdev
canonical_url: https://docs.reactiveagents.dev/guides/build-ai-agents-typescript/
cover_image: https://raw.githubusercontent.com/tylerjrbuell/reactive-agents-ts/main/apps/docs/src/assets/local-vs-frontier.gif
---

> **Note for publishing:** upload `ra-demo.gif` to Dev.to directly (drag-drop in the editor) for the inline embed, or keep the GitHub raw URL below. Set `published: true` when ready.

Most TypeScript agent frameworks quietly assume you're on a frontier model. The common wisdom is blunt: *don't put a 4B model in an agent loop* — it mangles the tool-call format, one bad call breaks the chain, and the loop falls apart.

I didn't want to accept that. I wanted to develop and test an agent **locally and privately** on a small model, then swap to Claude for the hard runs — with no rewrite. So I built [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) around that constraint.

Here's the same agent code finishing the same tool-using task on a 4B Ollama model and on Claude. The only line that changes is the model:

![Same builder code completing a tool task on a local 4B Ollama model and on Claude](https://raw.githubusercontent.com/tylerjrbuell/reactive-agents-ts/main/apps/docs/src/assets/local-vs-frontier.gif)

## The same builder, two models

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("ollama").withModel("qwen3:4b")              // runs on your laptop
  // .withProvider("anthropic").withModel("claude-sonnet-4-6") // frontier — same code, one line
  .withReasoning()
  .withTools()
  .build();

const result = await agent.run(
  "Write a haiku about TypeScript to ./haiku.txt with the file-write tool, then read it back."
);
console.log(result.output);
```

That's it. No separate "local mode," no second code path. The agent runs the think → act → observe loop, calls the `file-write` and `file-read` tools, and returns. On a 4B model **and** on Claude.

To be clear about the honest part: a 4B model isn't as *smart* as Claude. The claim isn't quality parity — it's that the **same code completes the loop**, which is what lets you use a small local model for development, offline work, and privacy-sensitive tasks, then move to a frontier model when you need the reasoning.

## Why small models usually break — and what fixes it

Two things make the small-model path actually finish.

**1. Model-adaptive context profiles.** Small models have small effective context and get lost in verbose prompts. Reactive Agents tunes prompt construction and compaction per model tier — lean prompts, aggressive truncation, earlier compaction for the local tier:

```typescript
.withContextProfile({ tier: "local" })   // lean prompts, aggressive compaction
```

**2. A tool-call healing pass.** This is the real unlock. Small models emit *almost*-valid tool calls: a slightly wrong tool name, a parameter alias, a path that needs normalizing. One malformed call and a naive loop dies. The healing pipeline normalizes tool names, parameter aliases, paths, and types **before** execution, so a near-miss becomes a successful call instead of a dead loop.

You don't configure any of this for the happy path — it's what `.withTools()` does. It's also why the demo's 4B run completes the file write/read round-trip that would otherwise fail.

## The part that isn't about local models: a typed runtime

The local-to-frontier story is the hook, but the reason I trust the thing in production is underneath it.

Reactive Agents is built on [Effect-TS](https://effect.website), so this isn't "types bolted onto a dynamic core." The **execution model itself** is typed end to end:

- An LLM or tool failure is a **value in an explicit error channel**, not a thrown exception you find out about in prod.
- Concurrency is structured; retries and fallbacks compose.
- Structured output is schema-validated before it reaches you.

And — because this is the first question every Effect-skeptic asks — **you don't write Effect to use it.** The builder and hooks are plain async:

```typescript
.withHook({
  phase: "act",
  timing: "after",
  handler: (ctx) => {
    const last = ctx.toolResults.at(-1);
    console.log("tool:", last?.toolName);
    return ctx;            // plain async, no Effect in your code
  },
})
```

## Observable by construction, no SaaS tether

Every run is a deterministic **12-phase lifecycle** — `bootstrap → guardrail → cost-route → think → act → observe → verify → … → complete` — with `before` / `after` / `on-error` hooks on every phase. You can inspect and steer each step locally. No graph to wire by hand, no hosted dashboard subscription to see what your agent did.

```typescript
import { ReactiveAgents, HarnessProfile } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic").withModel("claude-sonnet-4-6")
  .withProfile(HarnessProfile.balanced())   // memory + reactive intelligence + verifier
  .withTools()
  .withBudget({ tokenLimit: 100_000 })      // hard spend cap
  .build();
```

MCP-native tools, A2A multi-agent, durable crash-resume, and human-in-the-loop are all opt-in layers on the same engine.

## When *not* to reach for this

I'll save you the trouble:

- **You're committed to one provider and your loop is simple.** Use that vendor's Agent SDK. A framework is overhead.
- **You need the largest ecosystem today.** LangChain and Mastra have far more integrations and tutorials. Reactive Agents is early.
- **You want a battle-tested, widely-deployed framework right now.** This is early access (v0.12, MIT, ~6,500 tests). The architecture is the bet, and it's real and testable today — but it's young, and I'd rather tell you that than have you find out.

There are honest [side-by-side comparisons](https://docs.reactiveagents.dev/guides/build-ai-agents-typescript/) in the docs (vs LangGraph, Mastra, the Vercel AI SDK, and the vendor Agent SDKs) if you're evaluating.

## Try it

```bash
bun add reactive-agents
# or: npm install reactive-agents
```

- Repo: https://github.com/tylerjrbuell/reactive-agents-ts
- Docs: https://docs.reactiveagents.dev
- The exact demo above: [`apps/examples/src/demos/local-vs-frontier.ts`](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/apps/examples/src/demos/local-vs-frontier.ts)

If you try the local-model path, I'd genuinely like to hear what model you ran and whether the healing pass held up — that's the part I'm most curious to stress-test. Feedback and issues welcome.
