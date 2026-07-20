# reactive-agents

**The composable TypeScript AI agent framework — type-safe from prompt to production.**

One install. Five reasoning strategies. Six LLM providers. A live local studio. Built on Effect-TS, with no `any`, no hidden coupling, and no model lock-in.

[![CI](https://github.com/tylerjrbuell/reactive-agents-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/tylerjrbuell/reactive-agents-ts/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/reactive-agents?logo=npm&color=CB3837)](https://www.npmjs.com/package/reactive-agents)
[![npm downloads](https://img.shields.io/npm/dm/reactive-agents?logo=npm)](https://www.npmjs.com/package/reactive-agents)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Effect-TS](https://img.shields.io/badge/Effect--TS-3.x-7C3AED)](https://effect.website)
[![Bun](https://img.shields.io/badge/Bun-%E2%89%A51.1%20required-FBF0DF?logo=bun&logoColor=000000)](https://bun.sh)

[Documentation](https://docs.reactiveagents.dev/) · [Discord](https://discord.gg/498xEG5A) · [GitHub](https://github.com/tylerjrbuell/reactive-agents-ts) · [Changelog](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/CHANGELOG.md)

---

## What you get in one install

`reactive-agents` is the **umbrella package** that bundles the 17 most-used `@reactive-agents/*` modules behind a single fluent builder. One `bun add` gets you:

- **5 reasoning strategies** — ReAct, Reflexion, Plan-Execute, Tree-of-Thought, and an Adaptive meta-strategy that picks the right one per task.
- **6 LLM providers** — Anthropic, OpenAI, Google Gemini, Ollama (local), LiteLLM (40+ models), and a deterministic Test provider.
- **4-tier memory** — working, episodic, semantic (FTS5 + vectors), and procedural — all on `bun:sqlite`.
- **12-phase execution engine** — every phase is hookable (`before` / `after` / `on-error`).
- **Production guardrails** — injection, PII, toxicity, kill switch, behavioral contracts.
- **Adaptive tool calling** — native function calling on capable providers with a healing pipeline that recovers ~87% of malformed tool calls from local models.
- **Real-time streaming** — `agent.runStream()` AsyncGenerator with `AbortSignal` cancellation.
- **Cost tracking** — 27-signal complexity router, semantic cache, budget enforcement.
- **A2A protocol + multi-agent orchestration** — sequential, parallel, pipeline, map-reduce, dynamic sub-agents.
- **`rax` CLI** — scaffold projects, generate agents, run tasks, launch the Cortex studio.

> v0.10.2 — 4,672+ tests across 527 files. See [CHANGELOG.md](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/CHANGELOG.md) for the full Phase 1 mechanism validation report.

---

## Install

> **Requires [Bun](https://bun.sh) ≥ 1.1.0** — uses Bun's native SQLite, subprocess, and HTTP APIs. Node.js support is on the roadmap.

```bash
bun add reactive-agents
```

`effect` is bundled as a dependency; if you import from `effect` directly in your own code, install it explicitly: `bun add effect`.

---

## Quick Start

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("research-assistant")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .withReasoning()         // ReAct loop with adaptive strategy switching
  .withTools()             // Built-in tools + MCP support + meta-tools
  .withMemory("1")         // Persistent SQLite memory with FTS5 search
  .withGuardrails()        // Block injection, PII, toxicity
  .withCostTracking()      // Budget enforcement + complexity routing
  .build();

const result = await agent.run("Summarize the latest research on retrieval-augmented generation");

console.log(result.output);
console.log(result.metadata); // { duration, cost, tokensUsed, stepsCount, strategyUsed }
```

That's a fully observable, guardrailed, memory-backed reasoning agent in 12 lines.

---

## Why the umbrella package?

| You should use `reactive-agents` (this package) when... | You should reach for `@reactive-agents/*` directly when... |
| --- | --- |
| You want the full builder API in one import | You're shipping a library and want zero unused code |
| You're prototyping and don't want to track 17 versions | You only need one layer (e.g. just `@reactive-agents/a2a`) |
| You want `rax` CLI bundled and ready to go | You're integrating into an existing app with strict deps |
| You want a single `^0.10.2` upgrade path for everything | You need `@reactive-agents/channels` / `gateway` / `health` (not bundled here) |

Every layer is still opt-in via `.with*()` calls — the umbrella just spares you 17 imports.

---

## Feature highlights (v0.10.2)

### Adaptive tool calling — local models that actually work

The **healing pipeline** turns local models (Ollama qwen3, llama3, etc.) from frustrating into reliable. Four stages — tool-name healing, param-name healing, path resolution, type coercion — recover **86.7% of malformed tool calls** with **90% fewer tokens** than reprompt-based fallback.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("qwen3:14b")
  .withReasoning()
  .withTools()
  .withContextProfile({ tier: "local" }) // Lean prompts, aggressive compaction
  .build();
```

The `toolCallDialect` probe routes models to either `NativeFCDriver` (native FC) or `TextParseDriver` (3-tier XML/JSON/pseudo-code cascade) — automatically, per model, per session.

### Streaming with AbortSignal

```typescript
const controller = new AbortController();

for await (const event of agent.runStream("Analyze this dataset", {
  signal: controller.signal,
})) {
  if (event._tag === "TextDelta") process.stdout.write(event.text);
  if (event._tag === "IterationProgress") console.log(`Step ${event.iteration}/${event.maxIterations}`);
  if (event._tag === "StreamCompleted") {
    console.log("\nDone!");
    // event.toolSummary: Array<{ toolName, calls, successRate }>
  }
}

// Cancel from anywhere — HTTP request abort, user UI action, etc.
controller.abort();
```

### Lifecycle hooks on every phase

```typescript
import { Effect } from "effect";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .withHook({
    phase: "act",
    timing: "after",
    handler: (ctx) => {
      const last = ctx.toolResults.at(-1);
      if (last?.toolName) console.log(`Tool called: ${last.toolName}`);
      return Effect.succeed(ctx);
    },
  })
  .build();
```

Hookable phases: `bootstrap`, `guardrail`, `cost-route`, `strategy`, `think`, `act`, `observe`, `verify`, `memory-flush`, `complete`. Each supports `before`, `after`, and `on-error` timing.

### 5 reasoning strategies — pick one, or let the framework pick

| Strategy | How it works | Best for |
| --- | --- | --- |
| **ReAct** | Think → Act → Observe loop | Tool use, step-by-step tasks |
| **Reflexion** | Generate → Critique → Improve | Quality-critical output |
| **Plan-Execute** | Plan → Execute → Reflect → Refine | Structured multi-step work |
| **Tree-of-Thought** | Branch → Score → Prune → Synthesize | Creative, open-ended problems |
| **Adaptive** | Analyze task → auto-select | Mixed workloads |

```typescript
.withReasoning({ defaultStrategy: "adaptive" })
// or with automatic switching on loop detection:
.withReasoning({
  enableStrategySwitching: true,
  maxStrategySwitches: 1,
  fallbackStrategy: "plan-execute-reflect",
})
```

### Conversational chat + sessions

```typescript
// Single-turn — adaptive routing picks direct LLM or full ReAct loop
const answer = await agent.chat("What's the deployment status?");

// Multi-turn session
const session = agent.session();
await session.chat("Summarize yesterday's logs");
await session.chat("Which errors were most frequent?");
```

### Functional composition

```typescript
import { agentFn, pipe, parallel, race } from "reactive-agents";

const researcher = agentFn({ name: "researcher", provider: "anthropic" }, (b) =>
  b.withReasoning().withTools()
);
const summarizer = agentFn({ name: "summarizer", provider: "anthropic" });

const pipeline = pipe(researcher, summarizer);              // sequential
const fanout = parallel(researcher, summarizer);            // concurrent
const fastest = race(
  agentFn({ name: "claude", provider: "anthropic" }),
  agentFn({ name: "gpt", provider: "openai" })
);                                                          // first wins
```

### ToolBuilder — define tools without raw schemas

```typescript
import { ToolBuilder } from "reactive-agents/tools";
import { Effect } from "effect";

const webSearch = ToolBuilder.create("web_search")
  .description("Search the web for current information")
  .param("query", "string", "Search query", { required: true })
  .riskLevel("low")
  .timeout(10_000)
  .handler((args) => Effect.succeed(`Results for: ${args.query}`))
  .build();

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools({ tools: [webSearch] })
  .build();
```

Or register tools at runtime on a live agent: `agent.registerTool(...)` / `agent.unregisterTool(...)`.

### Dynamic sub-agent spawning

Let the model decide when to delegate — no pre-declared agent tools required:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .withTools()
  .withDynamicSubAgents({ maxIterations: 5 })
  .build();
```

Sub-agents get a clean context window, inherit the parent's provider/model, and are depth-limited to 3 levels.

---

## Multi-provider — switch with one line

| Provider | Models | Native FC | Streaming |
| --- | --- | :---: | :---: |
| **Anthropic** | `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`, Opus | Yes | Yes |
| **OpenAI** | `gpt-4o`, `gpt-4o-mini`, o1 | Yes | Yes |
| **Google Gemini** | `gemini-2.5-pro`, Flash | Yes | Yes |
| **Ollama** | Any local model (qwen3, llama3, etc.) | Yes | Yes |
| **LiteLLM** | 40+ models via LiteLLM proxy | Yes | Yes |
| **Test** | Deterministic mock for unit tests | — | — |

```typescript
.withProvider("ollama").withModel("qwen3:14b")
// or
.withProvider("openai").withModel("gpt-4o")
// or
.withProvider("anthropic").withModel("claude-sonnet-4-6")
```

Same agent code, different model. Provider fallback chains and dynamic pricing are also one-liners:

```typescript
.withFallbacks({ providers: ["anthropic", "openai"], errorThreshold: 3 })
.withDynamicPricing() // e.g. live OpenRouter pricing
```

---

## Cortex — the companion studio

[`@reactive-agents/cortex`](https://www.npmjs.com/package/@reactive-agents/cortex) is the optional live studio: real-time agent canvas, entropy charts, per-step token usage, AI-generated debrief summaries, and an interactive agent builder.

```bash
bun add @reactive-agents/cortex
rax cortex                               # Launch the studio
rax run "Plan a launch" --cortex         # Stream events to Cortex over WebSocket
```

Or wire it directly from code:

```typescript
.withCortex("ws://localhost:7777/ws/ingest")
```

[→ Full Cortex docs with screenshots](https://docs.reactiveagents.dev/features/cortex/)

---

## `rax` CLI — bundled

The CLI ships with this package — no extra install needed.

```bash
rax init my-project --template full                       # Scaffold a project
rax create agent researcher --recipe researcher           # Generate from recipe
rax create agent my-agent --interactive                   # Interactive scaffolding
rax run "Explain quantum computing" --provider anthropic  # One-off run
rax cortex                                                # Launch Cortex studio (after install)
```

---

## What's bundled

The umbrella re-exports these 17 packages. Sub-path imports are also available (e.g. `import { … } from "reactive-agents/memory"`).

| Sub-package | Re-exports / Highlights |
| --- | --- |
| `@reactive-agents/runtime` | `ReactiveAgents`, `createRuntime`, `agentFn`, `pipe`, `parallel`, `race` |
| `@reactive-agents/core` | `EventBus`, `AgentService`, `TaskService`, canonical types |
| `@reactive-agents/llm-provider` | `createLLMLayer` — Anthropic, OpenAI, Gemini, Ollama, LiteLLM, Test |
| `@reactive-agents/memory` | `createMemoryLayer` — 4-layer SQLite memory + ExperienceStore |
| `@reactive-agents/reasoning` | `createReasoningLayer` — 5 strategies, composable kernel |
| `@reactive-agents/tools` | `createToolsLayer`, `ToolBuilder`, MCP client, sub-agent adapter |
| `@reactive-agents/guardrails` | `createGuardrailsLayer` — injection, PII, toxicity, kill switch |
| `@reactive-agents/verification` | `createVerificationLayer` — semantic entropy, NLI, fact decomposition |
| `@reactive-agents/cost` | `createCostLayer` — 27-signal router, semantic cache, budgets |
| `@reactive-agents/identity` | `createIdentityLayer` — Ed25519 certs, RBAC, delegation, audit |
| `@reactive-agents/observability` | `createObservabilityLayer` — OTLP tracing, metrics, structured logs |
| `@reactive-agents/interaction` | `createInteractionLayer` — autonomy modes, checkpoints, approval gates |
| `@reactive-agents/prompts` | `createPromptsLayer` — versioned templates |
| `@reactive-agents/eval` | `createEvalLayer` — LLM-as-judge, EvalStore, comparison reports |
| `@reactive-agents/a2a` | `A2AServer`, `A2AClient` — Agent Cards, JSON-RPC 2.0, SSE |
| `@reactive-agents/cli` | `rax` CLI binary |

### Available separately on npm

These packages are **not bundled** — install them directly when needed:

| Package | Use it for |
| --- | --- |
| [`@reactive-agents/cortex`](https://www.npmjs.com/package/@reactive-agents/cortex) | Live agent studio (Beacon, Thalamus, Lab, debrief UI) |
| [`@reactive-agents/gateway`](https://www.npmjs.com/package/@reactive-agents/gateway) | Persistent autonomous harness (heartbeats, crons, webhooks, chat mode) |
| [`@reactive-agents/channels`](https://www.npmjs.com/package/@reactive-agents/channels) | Sender access control + chat-mode policy for the gateway |
| [`@reactive-agents/reactive-intelligence`](https://www.npmjs.com/package/@reactive-agents/reactive-intelligence) | Metacognitive layer — entropy sensor, controller, calibration |
| [`@reactive-agents/diagnose`](https://www.npmjs.com/package/@reactive-agents/diagnose) | Output-leak detector (PII, secrets, system prompts) — 100% TPR / 0% FPR |
| [`@reactive-agents/health`](https://www.npmjs.com/package/@reactive-agents/health) | Health checks + readiness probes |
| [`@reactive-agents/testing`](https://www.npmjs.com/package/@reactive-agents/testing) | Mock services + assertion helpers + scenario fixtures |
| [`@reactive-agents/react`](https://www.npmjs.com/package/@reactive-agents/react) | React 18+ hooks (`useAgent`, `useAgentStream`) |
| [`@reactive-agents/vue`](https://www.npmjs.com/package/@reactive-agents/vue) | Vue 3 composables |
| [`@reactive-agents/svelte`](https://www.npmjs.com/package/@reactive-agents/svelte) | Svelte 4/5 stores |
| [`@reactive-agents/scenarios`](https://www.npmjs.com/package/@reactive-agents/scenarios) | Pre-built test scenarios |
| [`@reactive-agents/trace`](https://www.npmjs.com/package/@reactive-agents/trace) | Lightweight tracing utilities |

---

## Modular install — cherry-pick what you need

Prefer leaner installs? Skip the umbrella and pull only what you use:

```bash
bun add @reactive-agents/runtime @reactive-agents/llm-provider @reactive-agents/reasoning
```

The builder API still works the same way — `ReactiveAgents.create()` is exported from `@reactive-agents/runtime`.

---

## Environment variables

```bash
ANTHROPIC_API_KEY=sk-ant-...                    # Anthropic Claude
OPENAI_API_KEY=sk-...                           # OpenAI GPT
GOOGLE_API_KEY=...                              # Google Gemini
EMBEDDING_PROVIDER=openai                       # For semantic memory (default: openai)
EMBEDDING_MODEL=text-embedding-3-small
LLM_DEFAULT_MODEL=claude-sonnet-4-6
```

Ollama and the Test provider need no API keys. LiteLLM picks up its own provider keys.

---

## Documentation & community

- **Full docs:** [docs.reactiveagents.dev](https://docs.reactiveagents.dev/)
  - [Quickstart](https://docs.reactiveagents.dev/guides/quickstart/)
  - [Reasoning strategies](https://docs.reactiveagents.dev/guides/reasoning/)
  - [Architecture deep dive](https://docs.reactiveagents.dev/concepts/architecture/)
  - [Cookbook](https://docs.reactiveagents.dev/cookbook/testing-agents/) — testing, multi-agent patterns, production deployment
  - [Cortex studio](https://docs.reactiveagents.dev/features/cortex/)
- **Discord:** [Join the community](https://discord.gg/498xEG5A)
- **GitHub:** [tylerjrbuell/reactive-agents-ts](https://github.com/tylerjrbuell/reactive-agents-ts)
- **Issues:** [Bug reports & feature requests](https://github.com/tylerjrbuell/reactive-agents-ts/issues)

---

## License

MIT — see [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
