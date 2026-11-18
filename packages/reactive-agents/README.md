# reactive-agents

**Agents you can control, audit and improve.**

> An open-source TypeScript agent harness for controllable execution, end-to-end observability, and reliable runs on local models and frontier APIs.

> **Stability:** stable. `ReactiveAgents.create()` and the `.with*()` chain are tier-1 stable; where a single export is less settled than its package it carries an `@unstable` JSDoc tag, and the tier itself is recorded in the stability reference.

[![npm version](https://img.shields.io/npm/v/reactive-agents?logo=npm&color=CB3837)](https://www.npmjs.com/package/reactive-agents)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE)
[![Bun](https://img.shields.io/badge/Bun-%E2%89%A51.1%20recommended-FBF0DF?logo=bun&logoColor=000000)](https://bun.sh)

[Documentation](https://docs.reactiveagents.dev/) · [Discord](https://discord.gg/Mp99vQam3Q) · [GitHub](https://github.com/tylerjrbuell/reactive-agents-ts) · [Changelog](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/CHANGELOG.md)

`reactive-agents` is the umbrella package: one install, one fluent builder, and the core `@reactive-agents/*` layers re-exported behind it. Built on Effect-TS with schema-validated boundaries and tagged errors. Optional capabilities (memory, guardrails, cost routing, durability) only run when you add them with a `.with*()` call; Reactive Intelligence is on by default.

## What's different about Reactive Agents

- **The same code runs on a local or a hosted model.** A 4B Ollama model or Claude, GPT or Gemini: only the model line changes. Per-model context profiles, tool-call healing ([`packages/tools/src/healing`](https://github.com/tylerjrbuell/reactive-agents-ts/tree/main/packages/tools/src/healing)), output verification and a single termination check ([`terminate.ts`](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/packages/reasoning/src/kernel/loop/terminate.ts)) do the adapting. [See the demo](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/apps/examples/src/demos/local-vs-frontier.ts).
- **A receipt for every run.** Each run returns a claim-to-evidence record with a verdict. Ed25519 signing is off by default: add `.withReceiptSigning()` or set `RA_RECEIPT_KEY`. [Receipt schema](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/packages/core/src/types/receipt.ts).
- **Failed runs explain themselves.** Every run writes a trace, and `rax-diagnose cause <runId>` names why it failed. Each of the 12 execution phases ([`packages/runtime/src/engine`](https://github.com/tylerjrbuell/reactive-agents-ts/tree/main/packages/runtime/src/engine)) has `before`, `after` and `on-error` hooks, and replay re-runs a trace with tool results held fixed (model calls stay live). [rax-diagnose](https://docs.reactiveagents.dev/reference/cli/diagnose/) · [Snapshot & replay](https://docs.reactiveagents.dev/features/snapshot-replay/).
- **Runs can survive a crash.** Opt in with `.withDurableRuns()`: the run checkpoints each step and a fresh process resumes it. [Durable execution](https://docs.reactiveagents.dev/guides/durable-execution/) · [demo](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/apps/examples/src/demos/durable-resume.ts).
- **Quiet and private by default.** No telemetry unless you opt in (`DO_NOT_TRACK` always wins), and output is quiet when piped. Memory, guardrails, cost routing and durability run only when you add them with a `.with*()` call ([builder](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/packages/runtime/src/builder.ts)). The entropy sensor (Reactive Intelligence) is on by default and sends no data anywhere. [Observability](https://docs.reactiveagents.dev/features/observability/).
- **A local studio, no hosted dashboard.** Cortex shows runs live, lets you inspect traces and build agents, all on your machine. [Cortex docs](https://docs.reactiveagents.dev/features/cortex/).

Docs: https://docs.reactiveagents.dev/

## Install

Bun >= 1.1.0 is recommended (native SQLite, subprocess and HTTP APIs). Node.js 22.5+ is supported through `@reactive-agents/runtime-shim`.

```bash
bun add reactive-agents
# or: npm install reactive-agents
```

## Quick start

No Effect knowledge needed for the basics: `createAgent` + `await agent.run()`.

```ts
import { createAgent } from "reactive-agents";

const agent = await createAgent({
  name: "research-assistant",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  reasoning: {},
  tools: { builtins: "research" },
  memory: { tier: "standard" },
  guardrails: {},
  costTracking: {},
});

const result = await agent.run("Summarize the latest research on retrieval-augmented generation");

console.log(result.output);
console.log(result.metadata); // { duration, cost, tokensUsed, stepsCount, strategyUsed }
```

`effect` is a dependency. If you import from `effect` in your own code, install it explicitly: `bun add effect`.

Run a local model with the same code:

```ts
import { ReactiveAgents } from "reactive-agents";

const local = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("qwen3:14b")
  .withReasoning()
  .withTools({ builtins: "research" })
  .withContextProfile({ tier: "local" })
  .build();
```

Providers: Anthropic, OpenAI, Gemini, Groq, xAI, Ollama, LiteLLM, and a deterministic Test provider for unit tests. Strategies: ReAct, Reflexion, Plan-Execute, Tree-of-Thought, Blueprint, Direct, Code-Action (experimental) and Adaptive; see [Choosing a strategy](https://docs.reactiveagents.dev/guides/choosing-strategies/).

## Highlights

Stream with cancellation:

```ts
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create().withProvider("anthropic").build();
const controller = new AbortController();

for await (const event of agent.runStream("Analyze this dataset", { signal: controller.signal })) {
  if (event._tag === "TextDelta") process.stdout.write(event.text);
}
```

Hook any lifecycle phase (`before`, `after` or `on-error` on each of the 12 phases). `think`, `act` and `observe` fire once per kernel turn and receive `{ phase, iteration, state }`; the other phases receive the `ExecutionContext`:

```ts
import { Effect } from "effect";
import { ReactiveAgents } from "reactive-agents";

const hooked = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools({ builtins: "research" })
  .withHook({
    phase: "act",
    timing: "after",
    handler: (ctx) => {
      // think/act/observe fire per kernel turn with { phase, iteration, state }
      if (!("metadata" in ctx)) {
        console.log(`Tools used so far: ${[...ctx.state.toolsUsed]}`);
      }
      return Effect.succeed(ctx);
    },
  })
  .build();
```

Compose agents functionally:

```ts
import { agentFn, pipe, parallel, race } from "reactive-agents";

const researcher = agentFn({ name: "researcher", provider: "anthropic" }, (b) => b.withReasoning().withTools({ builtins: "research" }));
const summarizer = agentFn({ name: "summarizer", provider: "anthropic" });

const sequential = pipe(researcher, summarizer);
const concurrent = parallel(researcher, summarizer);
```

Tools, MCP, memory, sessions and sub-agents each have a guide; see the links below. Provider API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`) and other settings are listed in the [configuration reference](https://docs.reactiveagents.dev/reference/configuration/). Ollama and the Test provider need no key.

## API

Root exports include `ReactiveAgents`, `createRuntime`, `agentFn`, `pipe`, `parallel` and `race` from `@reactive-agents/runtime`, plus re-exports from the layers below. Sub-path imports work too, for example `import { ToolBuilder } from "reactive-agents/tools"` or `reactive-agents/memory`.

| Bundled package | Use it for |
|---|---|
| `@reactive-agents/runtime` | Builder, execution engine, streaming, sessions |
| `@reactive-agents/core` | `EventBus`, canonical types |
| `@reactive-agents/llm-provider` | Provider layers |
| `@reactive-agents/memory` | SQLite-backed memory |
| `@reactive-agents/reasoning` | Strategies and the composable kernel |
| `@reactive-agents/tools` | `ToolBuilder`, MCP client |
| `@reactive-agents/guardrails` | Injection, PII, toxicity, kill switch |
| `@reactive-agents/verification` | Output verification |
| `@reactive-agents/cost` | Routing, caching, budgets |
| `@reactive-agents/identity` | Certificates, RBAC, delegation |
| `@reactive-agents/observability` | Tracing, metrics, logs |
| `@reactive-agents/interaction` | Autonomy modes, checkpoints |
| `@reactive-agents/prompts` | Versioned templates |
| `@reactive-agents/eval` | Evaluation and comparison |
| `@reactive-agents/a2a` | Agent-to-Agent protocol |
| `@reactive-agents/judgment` | Typed judgment primitive |
| `@reactive-agents/observe` | OpenTelemetry tracing (via `reactive-agents/observe`) |
| `@reactive-agents/cli` | The `rax` binary |

Install separately when needed: [`gateway`](https://www.npmjs.com/package/@reactive-agents/gateway), [`channels`](https://www.npmjs.com/package/@reactive-agents/channels), [`reactive-intelligence`](https://www.npmjs.com/package/@reactive-agents/reactive-intelligence), [`diagnose`](https://www.npmjs.com/package/@reactive-agents/diagnose), [`health`](https://www.npmjs.com/package/@reactive-agents/health), [`testing`](https://www.npmjs.com/package/@reactive-agents/testing), [`trace`](https://www.npmjs.com/package/@reactive-agents/trace), [`react`](https://www.npmjs.com/package/@reactive-agents/react), [`vue`](https://www.npmjs.com/package/@reactive-agents/vue), [`svelte`](https://www.npmjs.com/package/@reactive-agents/svelte) and the [Cortex studio](https://www.npmjs.com/package/@reactive-agents/cortex).

Prefer a leaner install? Skip the umbrella: `bun add @reactive-agents/runtime @reactive-agents/llm-provider @reactive-agents/reasoning`. `ReactiveAgents.create()` is exported from `@reactive-agents/runtime`.

Watch your agents run with Cortex: `bun add @reactive-agents/cortex`, then `rax cortex`.

![Cortex chat in Plan mode showing an editable three-step plan with tool chips for file-read, before it is executed.](https://docs.reactiveagents.dev/screens/cortex/chat-plan-card--crop.webp)
*Plan mode: the agent proposes a plan, one line per step with the tool it will use. Edit it, then Execute.*

![Cortex chat showing 'Stopped by you' with the tool already done, an optional note for the agent, and a Continue button.](https://docs.reactiveagents.dev/screens/cortex/chat-stopped-continue--crop.webp)
*A durable run you stopped keeps its place. Continue resumes the same run without repeating finished work.*

![Cortex Tools Lab listing three MCP servers: two connected with their tools, one failed with its error.](https://docs.reactiveagents.dev/screens/cortex/tools-lab--crop.webp)
*Tools Lab: MCP servers with live connection status and each tool's input schema.*

![Cortex run view for a run that hit its iteration limit, with the Why it ended card open: cause, what to try, decisive steps, and the trace below.](https://docs.reactiveagents.dev/screens/cortex/run-cause--crop.webp)
*The run view's Why it ended card: the cause, who is at fault, what to try, and the steps that decided it.*

## Documentation

- [Quickstart](https://docs.reactiveagents.dev/guides/quickstart/)
- [Installation](https://docs.reactiveagents.dev/guides/installation/)
- [Choosing a strategy](https://docs.reactiveagents.dev/guides/choosing-strategies/)
- [Tools and MCP](https://docs.reactiveagents.dev/guides/tools/)
- [Architecture](https://docs.reactiveagents.dev/concepts/architecture/)
- [Cortex studio](https://docs.reactiveagents.dev/features/cortex/)
- [GitHub issues](https://github.com/tylerjrbuell/reactive-agents-ts/issues)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
