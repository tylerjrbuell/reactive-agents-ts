---
aliases: [FM-I, Kernel-Input Field Drop, Strategy Divergence]
tags: [failure-modes, architecture, compose, kernel, empirical, v0.12]
severity: high
discovered: 2026-06-11
status: open
---

# FM-I: Strategy Kernel-Input Divergence

> **One line.** Heavy / composite strategies hand-construct the `KernelInput` object literal at each sub-kernel call site and silently drop cross-cutting fields that only `reactive`/`direct` thread — so advertised features (Compose hooks, killswitches, model calibration) are dead on `reflexion`, `plan-execute-reflect`, `tree-of-thought`, `adaptive`, and `code-action`.

## Severity: HIGH

This is a **silent correctness bug on advertised public API**. A user calls `.compose(h => h.on('observation.tool-result', …))` (per `composition-recipes.mdx`), the agent runs `reflexion`, tools execute, and the hook **never fires** — no error, no warning. Worse, the dropped `calibration` field degrades exactly the local-model behavior that is the framework's headline differentiator.

## Empirical evidence (2026-06-11)

`scratch.ts`: `ollama/gemma4:e4b`, `defaultStrategy: 'reflexion'`, `.compose(h => h.on('observation.tool-result', obs => console.log(obs)))`, task fetches HN posts via a tool.

- **Tools executed** — output shows real HN scores (201, 289, 577, …) fetched by `get-hn-posts`.
- **Hook fired zero times** — no `obs` object ever printed.
- Exit 0; no error surfaced.

## Root cause (the architectural weakness)

There is **no canonical `KernelInput` assembly**. Every strategy builds the kernel input as an inline object literal at each `runKernel` / `runPass` / `executeReActKernel` call site. When a cross-cutting field is added (e.g. `harnessPipeline` for Compose, GH #112/#127), only the call sites someone remembered to edit get it. The field-set diverges per strategy, per call site.

### Field-drop matrix (code-verified 2026-06-11)

Cross-cutting kernel fields = `{ harnessPipeline, budgetLimits, calibration, auditRationale, verifier }`.

| Strategy | Kernel call site(s) | Threads cross-cutting fields? |
|---|---|---|
| `reactive` | `reactive.ts:221` | ✅ all 5 (`:205,207,214-218`) |
| `direct` | `direct.ts` | ✅ (delegates like reactive) |
| `reflexion` | `reflexion.ts:149` genPass, `:451` improvePass | ❌ **0/5 — no `harnessPipeline` anywhere in file** |
| `plan-execute-reflect` | step exec `plan-execute/step-executor.ts:344` (`executeReActKernel`) | ❌ **0/5 on the tool-running step path**; `plan-execute.ts:952` threads `harnessPipeline` only to a non-tool (synthesis) pass |
| `tree-of-thought` | `tree-of-thought.ts:189`, `:647` (branch kernels) | ❌ 0/5 on branch kernels; `:599` `harnessPipeline` is for the RI dispatchContext only, not the kernel |
| `adaptive` | delegates to sub-strategy | ❌ **0 references — drops the field before delegating, so even `adaptive→reactive` loses Compose** |
| `code-action` | bypasses kernel entirely | ❌ no kernel → no Compose at all (by design, but undocumented) |

The runtime **does** supply the field upstream (`runtime.ts:348 harnessPipeline: options.harnessPipeline`; built at `runtime-construction.ts:293`). It arrives at the strategy boundary and is dropped per-strategy.

## Consequences per dropped field

- `harnessPipeline` → all Compose `.on/.tap/.before/.after/.onError` + the `prompt.system` / `nudge.loop-detected` / `message.tool-result` / `observation.tool-result` tags no-op.
- `budgetLimits` → `budgetLimit` and `watchdog` killswitches (ride phase hooks) don't fire during heavy-strategy sub-passes — a runaway-cost safety hole.
- `calibration` → model-adaptive steering channel selection off → degraded local-model behavior (the differentiator).
- `auditRationale` → per-tool-call rationale audit silently off.
- `verifier` → a user-supplied custom verifier is ignored on sub-passes.

## Mitigation

**Tactical (v0.12, correctness patch):** thread all 5 cross-cutting fields into every kernel call site — `reflexion` (2), `step-executor` (1), `tree-of-thought` (2), and make `adaptive` forward them to every sub-strategy input. ~6 edit sites. Add a regression test per strategy asserting a registered `.on('observation.tool-result')` fires ≥1×.

**Structural (the durable fix — the user's consolidation instinct):** introduce a single `buildKernelInput(strategyInput, perPassOverrides)` helper in `kernel/state/` that is the ONLY way to construct a `KernelInput`. Cross-cutting fields pass through by construction; per-pass code supplies only what varies (task, systemPrompt, maxIterations, kernelPass…). Lint/type-guard so a raw `KernelInput` object literal outside the builder fails review. This makes field-drop *structurally impossible* — the same discipline `transitionState()` brought to status mutations.

## Related

- Compose tags: `core/src/services/harness-pipeline.ts`, `composition-recipes.mdx`
- Design: `wiki/Architecture/Design-Specs/2026-06-11-canonical-kernel-input.md`
- Prior near-miss: MCP `relevantTools` drop (same class — heavy strategies didn't forward a classifier field; `project_mcp_relevant_tools_drop_fix`). **This is the second instance of the same root cause** → structural fix justified.
