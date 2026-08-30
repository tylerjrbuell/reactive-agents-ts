---
title: Harness Control Surface
description: >-
  Typed, per-agent configuration for the harness mechanisms that decide how
  much the harness spends per model turn and how much it hides from the model.
sidebar:
  order: 23
---

`.withHarness({...})` is the typed control surface for the 14 harness
mechanisms — tool disclosure, discovery, the tool index, verbose rules, stable
tool surface, context budgets, thought continuity, observe symmetry, rationale
audit, and the Tree-of-Thought explore budget. Before this surface existed,
every one of these mechanisms was reachable only through a process-global
`RA_*` environment variable read at its call site, so two agents in one
process could not differ and no sub-agent inherited anything from its parent.

:::note[Two unrelated `.withHarness()` overloads]
`.withHarness()` is overloaded on argument shape, and the two overloads do
**completely different things**:

- `.withHarness(config: HarnessConfig)` — **this page.** Pass a plain data
  object to configure the mechanism switches described below.
- `.withHarness(fn: (harness: Harness) => void)` — the **pipeline/tool
  composition** API, aliased by `.compose()`. Pass a callback that registers
  hooks, tools, or killswitches against the agent's `Harness` pipeline. It has
  nothing to do with the mechanism switches on this page.

They are distinguished at the call site by argument shape (function vs. plain
object) and never collide in practice — no `HarnessConfig` field is itself
callable. If you're looking for `.compose()`-style pipeline composition, see
[Harness Control Flow](/features/harness-control-flow/) instead.
:::

## Precedence: three layers

Resolution happens **once per run**, at the runtime boundary, and is threaded
through `RunEnvelope.harness` → `KernelInput.harness` to every consuming call
site. Sub-agents inherit the resolved harness automatically — it rides the
existing `parentReasoningOptions` passthrough, no separate mechanism needed.

1. **Explicit config** — `.withHarness({...})` on the builder. Typed,
   per-agent, wins over everything.
2. **Environment variable** — the matching `RA_*` variable (see
   `harness-flags.ts`). Process-global, used only where the config layer
   didn't decide.
3. **Built-in default** — what the framework does with nothing set. Every
   default resolves to today's behavior; this page introduces no default
   changes.

```ts
// Keep the tool array byte-stable so the provider's prompt cache survives:
agent.withHarness({ stableToolSurface: true })

// Small-model profile: show everything, no discovery round trips:
agent.withHarness({
  lazyDisclosure: false,
  toolDiscovery: false,
  verboseRules: true,
})
```

## The 14 fields

| Field | Type | Default | Env fallback |
| --- | --- | --- | --- |
| `lazyDisclosure` | `boolean` | `true` | `RA_LAZY_TOOLS` (`=0` to disable) |
| `toolDiscovery` | `boolean` | follows `lazyDisclosure` | `RA_TOOL_DISCOVERY` |
| `toolIndex` | `boolean` | `false` | `RA_TOOL_INDEX` |
| `toolIndexMaxEntries` | `number` (unset = tier decides) | unset | `RA_TOOL_INDEX_MAX_ENTRIES` |
| `verboseRules` | `boolean` | `false` | `RA_VERBOSE_RULES` |
| `stableToolSurface` | `boolean` | `false` | `RA_STABLE_TOOL_SURFACE` |
| `recencyBudgetChars` | `number` (unset = derived from window) | unset | `RA_RECENCY_BUDGET_CHARS` |
| `toolResultBudgetChars` | `number` (unset = tier table decides) | unset | `RA_TOOL_RESULT_BUDGET_CHARS` |
| `thoughtContinuity` | `boolean` | `false` | `RA_THOUGHT_CONTINUITY` |
| `toolObserveSymmetry` | `boolean` | `false` | `RA_TOOL_OBSERVE_SYMMETRY` |
| `auditRationale` | `boolean` | `false` | `RA_RATIONALE_AUDIT` |
| `treeOfThoughtExploreBudgetMs` | `number` | `120000` | `RA_TOT_EXPLORE_BUDGET_MS` |
| `assemblyDebug` | `boolean` | `false` | `RA_ASSEMBLY_DEBUG` |
| `promptDumpPathPrefix` | `string` (unset = disabled) | unset | `RA_PROMPT_DUMP` |

Fields whose "unset" state is meaningful (`toolIndexMaxEntries`,
`recencyBudgetChars`, `toolResultBudgetChars`, `promptDumpPathPrefix`) are
absent from the resolved harness — not `undefined` — when nothing sets them,
so a fallback distinguishes "no override" from "override of zero."

## Tool disclosure: four postures

`toolDisclosureMode` (set on a `ContextProfile`, or expanded via
`fromDisclosureMode()`) is shorthand for three of the mechanism switches
above — `lazyDisclosure`, `toolDiscovery`, and `toolIndex`:

| Mode | `lazyDisclosure` | `toolDiscovery` | `toolIndex` | Pick this when… |
| --- | --- | --- | --- | --- |
| `"full"` | off | off | off | The tool catalog is small enough that pruning is pure overhead — every tool stays visible every turn. |
| `"discover"` | on | on | off | Today's default posture: lazy per-iteration pruning, with the `discover-tools` meta-tool as the escape hatch when the model needs something hidden. |
| `"index"` | on | off | on | Pruning stays on, but hidden tools get a cheap always-visible name+one-line index instead of a reactive meta-tool round trip. Best for small/local models that don't reliably think to call `discover-tools`. |
| `"hybrid"` | on | on | on | Large catalogs: a capped index (`toolIndexMaxEntries`) covers the common case, `discover-tools` covers the overflow. |

`fromDisclosureMode()` expands a mode into a plain `HarnessConfig`, so you can
spread it and override any single field:

```ts
import { fromDisclosureMode } from "@reactive-agents/reasoning"
import { ReactiveAgents } from "@reactive-agents/runtime"

const agent = ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withHarness({ ...fromDisclosureMode("index"), verboseRules: true })
```

`CONTEXT_PROFILES` sets one of these as the **per-tier default**:

| Tier | Default mode |
| --- | --- |
| `local` | `"index"` |
| `mid` | `"hybrid"` |
| `large` | `"discover"` |
| `frontier` | `"discover"` |

**These four tier defaults are declarations of intent, not measured
verdicts, pending future ablation-warden measurement.** No cross-tier lift
data backs them yet — treat them as a reasonable starting posture per tier,
not a benchmarked recommendation. An explicit `.withHarness({...})` or
`toolDisclosureMode` on a `contextProfile` override always wins over the tier
default.

## Worked example: a small local model

A 4B–8B Ollama model tends to ignore reactive tool-discovery hints and
benefits from everything being spelled out up front rather than pruned:

```ts
import { ReactiveAgents } from "@reactive-agents/runtime"

const agent = ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("qwen3:4b")
  .withReasoning()
  .withTools({ builtins: true })
  .withContextProfile({ tier: "local" }) // toolDisclosureMode: "index" by default
  .withHarness({
    // Override the tier default explicitly: show everything, skip both
    // pruning and the index text — the model rarely needs more than a
    // handful of tools on any given task.
    lazyDisclosure: false,
    toolDiscovery: false,
    toolIndex: false,
    verboseRules: true, // spell out the ReAct loop instead of assuming it
  })
  .build()
```

## What this does not do

- **No default changes.** With no `.withHarness()` call and no `RA_*`
  variables set, every mechanism resolves exactly as it did before this
  surface existed.
- **`overhaulEnabled()` (`RA_OVERHAUL`) stays env-only.** It is a build-time
  construction switch (`runtime-construction.ts`), not a per-run mechanism,
  so it is deliberately outside `HarnessConfig`.
- **`packages/tools/src/flags.ts` and `packages/a2a/src/flags.ts` are
  untouched.** They gate deployment/sandbox concerns in packages that cannot
  import `harness-flags.ts` without a dependency cycle — a different problem
  from the one this surface solves.
