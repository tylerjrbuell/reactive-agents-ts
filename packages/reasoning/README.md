# @reactive-agents/reasoning

> Version: **0.10.3** — reasoning strategies and the composable kernel for [Reactive Agents](https://docs.reactiveagents.dev/).

This package contains five reasoning strategies (ReAct, Reflexion, Plan-Execute, Tree-of-Thought,
Adaptive), the composable **reasoning kernel** that powers the runtime's `think → act → observe →
verify` loop, and the **Intelligent Context Synthesis** (ICS) layer that keeps prompts compact
without sacrificing fidelity.

## Installation

```bash
bun add @reactive-agents/reasoning
```

The `runtime` package re-exports everything you typically need; install this directly only if you
are wiring strategies into your own Effect program.

## Strategies

| Strategy | Export | Description | LLM calls | Best for |
|---|---|---|---|---|
| ReAct | `executeReactive` | Think → Act → Observe loop with native function calling | 1 / iteration | General tool use |
| Reflexion | `executeReflexion` | Generate → Critique → Improve loop | 3 / retry | Quality-critical output |
| Plan-Execute | `executePlanExecute` | Plan all steps, execute, optionally re-plan | 2+ | Multi-step / sequential tasks |
| Tree-of-Thought | `executeTreeOfThought` | Explore branches, score, prune | 3 × breadth × depth | Complex reasoning |
| Adaptive | `executeAdaptive` | Analyze task → auto-pick strategy → delegate | 1 + delegated cost | Mixed workloads |

## Quick example

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("researcher")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withReasoning() // defaults to ReAct
  .withTools()
  .build();

const result = await agent.run("Analyze the trade-offs between TCP and UDP");
```

To enable runtime strategy switching (RI dispatcher) — the kernel will swap strategy mid-run when
loop detection or low-progress signals fire:

```typescript
.withReasoning({
  defaultStrategy: "reactive",
  strategySwitching: { enabled: true },
})
```

Strategy switching is **opt-in**; the default is single-strategy (`reactive`).

## ReAct loop

The default strategy. A native function-calling Think → Action → Observation loop:

```
Thought:  "I need to find information about X"
Action:   web_search({"query": "X"})
Observation: [actual search results from the registered tool]
Thought:  "Based on the results, I can conclude..."
FINAL ANSWER: ...
```

When `ToolService` is present (via `.withTools()`), tool calls execute real registered tools.
Tool arguments must be valid JSON; if a plain string is provided, it maps to the first required
parameter. When `ToolService` is absent the kernel returns a clear descriptive observation instead
of crashing.

## Reflexion loop

Based on the [Reflexion paper](https://arxiv.org/abs/2303.11366). Use when output quality matters
more than latency:

```typescript
import { executeReflexion } from "@reactive-agents/reasoning";
import { Effect } from "effect";

const result = await Effect.runPromise(
  executeReflexion({
    taskDescription: "Write a concise technical explanation of RAFT consensus.",
    taskType: "explanation",
    memoryContext: "",
    availableTools: [],
    config: {
      defaultStrategy: "reflexion",
      adaptive: { enabled: false, learning: false },
      strategies: {
        reactive: { maxIterations: 10, temperature: 0.7 },
        planExecute: { maxRefinements: 2, reflectionDepth: "deep" },
        treeOfThought: { breadth: 3, depth: 3, pruningThreshold: 0.5 },
        reflexion: { maxRetries: 3, selfCritiqueDepth: "deep" },
      },
    },
  }).pipe(Effect.provide(llmLayer)),
);

console.log(result.output);
console.log(result.metadata.confidence); // 0.6–1.0
console.log(result.status);              // "completed" | "partial"
```

## The reasoning kernel

The kernel is a composable, capability-grouped state machine that drives every reasoning strategy.
It lives at `kernel/` inside this package:

```
kernel/
  capabilities/
    act/        - tool execution, gating, parsing, healing
    attend/     - context formatting, tool relevance filtering
    comprehend/ - task intent classification
    decide/     - the arbitrator (sole termination authority)
    reason/     - think loop, stream parsing
    reflect/    - loop detection, reactive observer, strategy evaluator
    sense/      - step utilities
    verify/     - verifier + retry policy + evidence grounding
  loop/         - runner, react-kernel, terminate, output assembly
  state/        - kernel state, hooks, constants
  utils/        - diagnostics, ICS coordinator, lane controller
```

Two records, distinct purposes:

- `state.messages[]` — what the LLM sees (provider conversation thread).
- `state.steps[]` — what observers see (entropy, metrics, debrief).

The **arbitrator** at `kernel/capabilities/decide/arbitrator.ts` is the single owner of the
termination decision; every signal (verifier-fail, max-iterations, completion, controller veto, …)
funnels through it.

## Intelligent Context Synthesis (ICS)

ICS coordinates three context-shaping stages so they don't fight each other:

1. **Stash** — preserve original verbatim text for replay.
2. **Curator** — entropy- and relevance-driven pruning of observations.
3. **Patch** — last-mile message-window compaction.

Configure via `withReasoning({ synthesis: { ... } })`. The default profile is task-phase aware
(planning → execution → finalization).

```typescript
import {
  defaultContextCurator,
  applyMessageWindowWithCompact,
  type SynthesisConfig,
} from "@reactive-agents/reasoning";
```

## Verifier and retry

`defaultVerifier` runs semantic + evidence-grounding checks on candidate outputs. The
`defaultVerifierRetryPolicy` (Sprint 3.5) decides whether to retry, with what signal text, on each
verifier rejection — overrideable for custom quality gates.

## Tool-calling drivers

Two drivers drive the act phase, selected by provider capability:

- **`NativeFCDriver`** (`@reactive-agents/tools`) — native function calling for Anthropic, OpenAI,
  Gemini, and modern Ollama models.
- **`TextParseDriver`** — fallback that parses ACTION/JSON from text completions for older or
  text-only models.

Both pass through the **healing pipeline** (4-stage: tool-name → param-name → path resolution →
type coercion), which recovers ~87% of malformed tool calls without re-prompting.

## Key exports

| Export | Purpose |
|---|---|
| `executeReactive` / `executeReflexion` / `executePlanExecute` / `executeTreeOfThought` / `executeAdaptive` | Strategy entry points |
| `ReasoningService` / `ReasoningServiceLive` | Effect service tag + layer |
| `StrategyRegistry` / `StrategyRegistryLive` | Strategy registration |
| `defaultContextCurator` / `applyMessageWindowWithCompact` | ICS primitives |
| `defaultVerifier` / `defaultVerifierRetryPolicy` | Verification primitives |
| `arbitrate` / `applyTermination` / `arbitrateAndApply` | Arbitrator API |
| `inferRequiredTools` / `classifyToolRelevance` | Structured-output helpers |
| `CONTEXT_PROFILES` / `resolveProfile` | Per-tier context profiles |

## Documentation

- Strategies guide: [docs.reactiveagents.dev/guides/reasoning/](https://docs.reactiveagents.dev/guides/reasoning/)
- Kernel architecture: [docs.reactiveagents.dev/architecture/kernel/](https://docs.reactiveagents.dev/architecture/kernel/)
- Related: [`@reactive-agents/runtime`](../runtime/README.md),
  [`@reactive-agents/llm-provider`](../llm-provider/README.md),
  [`@reactive-agents/tools`](../tools/README.md).

## License

MIT
