---
# Dev.to front matter — paste into the editor's front matter, or set via the UI.
title: "Reliable LLM agents in TypeScript: one harness you fully control, from a local 4B model to Claude"
published: true
description: "I kept losing agents to the loop, not the model. So I built Reactive Agents — a composable TypeScript framework for building reliable LLM agents on a harness you fully control. The same code runs from a local 4B model to Claude, and resumes after a crash. Here's how it works."
tags: typescript, ai, llm, webdev
canonical_url: https://docs.reactiveagents.dev/guides/build-ai-agents-typescript/
cover_image: https://raw.githubusercontent.com/tylerjrbuell/reactive-agents-ts/main/apps/docs/src/assets/devto-cover.png
---

Every agent framework demo works. You wire up a couple of tools, point it at a frontier model, ask it something, and it nails it. Looks great in a tweet.

Then you point it at a real task with a smaller model and watch it fall apart on the third tool call.

That was most of my spring. I'd get an agent working nicely against Claude, swap in a local model to stop paying per token, and it would emit a tool call that was *almost* right — a tool named `getServiceHealth` instead of `get_service_health`, a param called `svc` instead of `service`, a path with a stray quote — and the loop would just die. Re-prompt, retry, burn through iterations doing nothing, give up. The model could do the task. The harness around it couldn't keep the loop alive long enough to find out.

So I stopped trying to fix the model and built the harness. It's called [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) — a composable TypeScript framework for building reliable LLM agents on a harness you fully control. It's organized around three things I kept wishing the other frameworks did:

- **Reliability** — the loop actually finishes.
- **Transparency** — I can see and steer every step instead of guessing at a black box.
- **Composability** — I add what I need and skip what I don't.

Reliability is the part I'm proudest of, so let me show you instead of telling you. Here's the same agent — investigate a service alert, call two tools, correlate the data, recommend a fix — running on a 4B local model *and* on Claude. The only thing that changes between the two runs is one line:

![The same agent completing a tool-using investigation on a local 4B Ollama model and on Claude](https://raw.githubusercontent.com/tylerjrbuell/reactive-agents-ts/main/apps/docs/src/assets/local-vs-frontier.gif)

## Same builder, two models

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("ollama").withModel("qwen3:4b")              // runs on your laptop
  // .withProvider("anthropic").withModel("claude-sonnet-4-6") // frontier — same code, one line
  .withReasoning()
  .withTools({ tools: [getServiceHealth, getRecentDeploys] })
  .build();

const result = await agent.run(
  "The payments-api is alerting. Investigate with the health and recent-deploys " +
  "tools, then tell me the likely cause and what to do."
);
console.log(result.output);
```

No `if (local)` branch. No second code path. The agent runs the same think → act → observe loop, calls `get_service_health` and `get_recent_deploys`, notices that the degradation lines up with a deploy from twelve minutes ago, and says: roll it back. On a 4B model and on Claude. (The two tools are plain `ToolBuilder.create(...)` definitions — [here's the demo source](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/apps/examples/src/demos/local-vs-frontier.ts).)

Let me be straight about what this is and isn't. A 4B model is not as smart as Claude, and I'm not pretending it is. The claim is narrower and a lot more useful: the *same code finishes the loop*. So I build and test locally, on my own hardware, for free, and swap one line to a frontier model when the task actually needs the horsepower.

## Why the small-model loop usually dies — and what keeps it alive

Two things do most of the work.

First, context profiles. Small models have a small effective context and drown in verbose prompts. So the local tier gets leaner prompts and more aggressive compaction:

```typescript
.withContextProfile({ tier: "local" })   // lean prompts, aggressive compaction
```

Second — and this is the one that actually moved the needle — a healing pass on tool calls. Remember the `getServiceHealth`-instead-of-`get_service_health` problem from the top? A naive loop sees "invalid tool" and gives up. The healing pipeline fixes the obvious near-misses — tool names, param aliases, paths, types — *before* the call runs, so "almost right" becomes "ran." That one pass is the whole difference between the 4B run in that GIF finishing and stalling.

You don't turn any of this on. It's just what `.withTools()` does.

## The part I actually trust in production: a typed runtime

The local-model thing is the fun demo. The reason I'd run this on something that matters is underneath it.

It's built on [Effect-TS](https://effect.website), which usually makes people groan, so let me get ahead of it: **you don't write Effect to use this.** The builder and hooks are plain async functions.

What you get for free is a runtime that's typed end to end. A failed tool call or a model timeout is a typed value in an explicit error channel — not an exception you meet for the first time in prod at 2am. Retries and fallbacks compose. Structured output is schema-checked before it lands in your hands.

```typescript
.withHook({
  phase: "act",
  timing: "after",
  handler: (ctx) => {
    const last = ctx.toolResults.at(-1);
    console.log("tool:", last?.toolName);
    return ctx;            // that's the whole hook contract. no Effect.
  },
})
```

## You can see what it's doing

This is the thing I missed most everywhere else. Every run is a fixed 12-phase lifecycle — bootstrap, guardrail, cost-route, think, act, observe, verify, and so on — and every phase has `before` / `after` / `on-error` hooks. I can watch and steer any step, locally, without shipping my traces off to someone's dashboard.

```typescript
import { ReactiveAgents, HarnessProfile } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic").withModel("claude-sonnet-4-6")
  .withProfile(HarnessProfile.balanced())   // memory + reactive intelligence + verifier
  .withTools()
  .withBudget({ tokenLimit: 100_000 })      // hard spend cap
  .build();
```

Memory, MCP tools, multi-agent, durable resume — opt-in layers on the same engine. Add the ones you want.

## When the process dies mid-run, it picks up where it left off

Here's the other half of reliability, and honestly the feature I'd lead with for anything long-running: agents crash. The box reboots, the container gets rescheduled, a deploy rolls your process. Usually that means starting the entire run over — and re-paying for every tool call and token you already spent.

With `.withDurableRuns()`, every iteration is checkpointed to disk. Kill the process mid-run, and a fresh one picks up the exact run from its last checkpoint and finishes it. The tools that already ran don't run again.

![An agent checkpointing each step, getting killed mid-run, then a fresh process reconstructing the run from its last checkpoint and finishing it](https://raw.githubusercontent.com/tylerjrbuell/reactive-agents-ts/main/apps/docs/src/assets/durable-resume.gif)

```typescript
// Process A — works, checkpoints each step, then gets hard-killed.
const a = await build();                       // .withDurableRuns({ dir })
for await (const _ of a.runStream(task)) { /* ...process dies mid-run... */ }

// Process B — a fresh start, same agent, same dir.
const b = await build();
const runId = (await b.listRuns({ status: "running" }))[0].runId;
const result = await b.resumeRun(runId);       // reconstructs + finishes
```

The same checkpoint machinery is what makes human-in-the-loop durable too: a gated tool call pauses the run, saves it, and someone can approve or deny it from a completely different process to pick it back up.

## When you should *not* use this

Let me save you some time.

- **One provider, a simple loop?** Use that vendor's Agent SDK. You don't need a harness, and I won't be offended.
- **Want the biggest ecosystem and the most tutorials today?** That's LangChain or Mastra, not me. This is early.
- **Need something that's been battle-tested across a thousand production deployments right now?** It isn't that yet — v0.12, MIT, ~6,500 tests. I'd rather say that out loud than have you find out three weeks in.

If you're comparing, the docs have honest side-by-sides with LangGraph, Mastra, the Vercel AI SDK, and the vendor Agent SDKs.

## Try it

```bash
bun add reactive-agents
# or: npm install reactive-agents
```

- Repo: https://github.com/tylerjrbuell/reactive-agents-ts
- Docs: https://docs.reactiveagents.dev
- The exact demo above: [`apps/examples/src/demos/local-vs-frontier.ts`](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/apps/examples/src/demos/local-vs-frontier.ts)

If you run the local-model path, I'd love to know which model you tried and whether the healing held up — that's the bit I most want people to throw real workloads at. Issues and feedback welcome; I read all of them.
