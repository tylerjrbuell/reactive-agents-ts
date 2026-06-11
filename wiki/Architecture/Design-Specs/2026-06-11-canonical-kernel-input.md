---
type: design-spec
status: proposed
created: 2026-06-11
tags: [v0.12.0, kernel, strategies, compose, consolidation, canonical-path]
---

# Canonical KernelInput assembly — collapse strategy divergence

> **Problem (FM-I, empirically confirmed 2026-06-11):** every reasoning strategy hand-builds the `KernelInput` object literal at each sub-kernel call site. Cross-cutting fields (`harnessPipeline`, `budgetLimits`, `calibration`, `auditRationale`, `verifier`, and historically `relevantTools`) silently drop wherever a call site wasn't updated. Result: Compose hooks, killswitches, and model calibration are dead on `reflexion`, `plan-execute-reflect`, `tree-of-thought`, `adaptive`. This is the **second** occurrence of this exact class (first: MCP `relevantTools` drop, 2026-05-30). Recurrence ⇒ fix the structure, not the instance.

## The user's framing (correct)

> "Even though the kernel is shared the strategies diverge depending on if it's reactive or a heavier strategy … this could be one of the bigger weaknesses — it's a strength and a weakness."

The shared kernel is the strength. The **per-strategy hand-assembly of kernel input** is the weakness. They are separable: keep the shared kernel, kill the hand-assembly.

## Design

### 1. One builder, mandatory

```ts
// kernel/state/build-kernel-input.ts
export interface PerPassOverrides {
  task: string;
  systemPrompt?: string;
  priorContext?: string;
  maxIterations: number;
  kernelPass: string;
  temperature?: number;
  availableToolSchemas?: readonly ToolSchema[];
  // …only fields that legitimately vary per sub-pass
}

/**
 * The ONLY sanctioned way to construct a KernelInput. Cross-cutting fields
 * are copied from `strategyInput` by construction; callers supply only what
 * varies per pass. Adding a new cross-cutting field here makes it flow to
 * EVERY strategy automatically — no per-call-site edit, no silent drop.
 */
export function buildKernelInput(
  strategyInput: StrategyInputBase,   // carries the cross-cutting bundle
  overrides: PerPassOverrides,
): KernelInput
```

`StrategyInputBase` declares the cross-cutting bundle once (`harnessPipeline`, `budgetLimits`, `calibration`, `auditRationale`, `verifier`, `relevantTools`, `requiredTools`, `resultCompression`, `agentId`, `sessionId`, `modelId`, `synthesisConfig`, `metaTools`, …). Every strategy input extends it.

### 2. Migrate all call sites

- `reactive.ts:221`, `direct.ts` → use builder (no behavior change; proves equivalence).
- `reflexion.ts:149,451` → use builder (restores all 5 fields).
- `plan-execute/step-executor.ts:344` + `plan-execute.ts:952` → use builder.
- `tree-of-thought.ts:189,647` → use builder.
- `adaptive.ts` → spread the cross-cutting bundle into each sub-strategy input (or pass `strategyInput` straight through — sub-strategies already extend the base).
- `code-action.ts` → out of scope for the kernel builder (bypasses kernel); instead **document** the Compose limitation and, if cheap, emit `observation.tool-result` from its own tool loop.

### 3. Enforcement (make regression impossible)

- A raw `KernelInput` object literal anywhere outside `build-kernel-input.ts` fails review — enforce via a lint rule or a `// eslint-disable`-gated factory, mirroring the `transitionState()` discipline (106 callsites, 0 raw `state.status =`).
- Per-strategy regression test: register `.on('observation.tool-result', spy)`, run a 1-tool task on the test provider, assert `spy` fired ≥1×. One test × 5 strategies. These tests are the durable guard.

## Phasing

| Phase | Scope | Gate |
|---|---|---|
| **0 — tactical correctness (ship first)** | Thread the 5 fields into the 5 heavy call sites + adaptive forward. No builder yet. | 5 per-strategy compose-fires tests green; scratch.ts hook fires under reflexion |
| **1 — builder** | Introduce `buildKernelInput`; migrate reactive+direct (equivalence), then heavy strategies | All reasoning tests green; diff shows every call site routes through builder |
| **2 — enforcement** | Lint/guard against raw `KernelInput` literals | CI fails on a planted raw literal |

Phase 0 restores advertised behavior immediately (it's a correctness bug on public API). Phases 1–2 are the consolidation that prevents the third occurrence. Phase 0's tests are written so they survive into Phase 1 unchanged.

## Why this is a v0.12 "Honest" item

v0.12 theme is "Durable & Honest." Shipping a Compose API + killswitches that silently no-op on 4 of 7 strategies is the definition of dishonest surface. This fix + the FM-I writeup (publishing our own bug) is exactly the honesty posture the roadmap commits to.

## Risks

- Builder must not change reactive/direct behavior — pin with an equivalence test (snapshot the constructed KernelInput before/after).
- `adaptive` forwarding: ensure no double-classification or field-shadowing when passing the base through.
- `code-action` stays a documented exception, not a silent one.

## Related

- `wiki/Failure-Modes/FM-I Strategy Kernel-Input Divergence.md`
- `project_mcp_relevant_tools_drop_fix` (first instance of this class)
- Compose: `composition-recipes.mdx`, `core/src/services/harness-pipeline.ts`
