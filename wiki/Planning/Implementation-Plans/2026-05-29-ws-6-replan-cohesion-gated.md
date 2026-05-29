---
title: WS-6 Re-Plan — Cohesion-Gated Decomposition
date: 2026-05-29
status: active
supersedes: WS-6 Phases 5-7 (LOC-driven)
related: [[2026-05-28-canonical-refactor]]
---

# WS-6 Re-Plan — Cohesion-Gated Decomposition

## Why this re-plan

The original WS-6 used **LOC ceilings as decomposition drivers**. Phase 4 (runner.ts) exposed the failure mode: the iteration body was relocated to `iterate-pass.ts` under a ceiling number via a 17-field mutable carrier + `sync()` scaffold — LOC moved, cohesion did not improve. Project owner flagged it (2026-05-29). CORRECTION 4 deleted the LOC ceiling tests; CORRECTION 5 re-decomposed iterate-pass for real cohesion.

**New rule (master plan §8.1 AMENDED):** decompose ONLY where a genuine cohesive sub-unit exists. A single cohesive unit is left large. LOC is a soft signal for "look here," never a gate. The test per file: *"does this extraction make it more maintainable/powerful, or just move LOC?"*

## Cohesion triage (first-hand signals 2026-05-29)

| File | LOC | fn-like | comment% | exports | Verdict |
|---|---|---|---|---|---|
| `act.ts` | 1209 | ~24 | 10% | 1 | ✅ **DECOMPOSE** — 24 distinct functions = distinct responsibilities; code-heavy; clearest cohesion |
| `think.ts` | 1366 | ~14 | 20% | 4 | ✅ **DECOMPOSE** — code-heavy; thinking + stream-parse + guard clusters |
| `arbitrator.ts` | 1208 | ~11 | 29% | 31 | ⛔ **LEAVE** — single cohesive arbitration decision; comment + decision-union-export heavy; splitting fragments the single-owner termination logic |
| `event-bus.ts` | 1419 | ~0 | 29% | 6 | ⛔ **LEAVE** — AgentEvent union type registry (schema file); splitting a discriminated union adds indirection for zero cohesion gain |
| `reactive-agent.ts` | 1420 | ~29 | 32% | 1 | 🔶 **TRIAGE** — API-surface-doc-heavy (like builder.ts); 32% is public-API JSDoc. Extract only genuinely cohesive internal handler clusters (e.g., gateway-runner, stream handlers); leave the public method surface |
| `execution-engine.ts` | 1404 | ~15 | 15% | 4 | 🔶 **TRIAGE** — already W24-decomposed into `engine/`. Extract residual cohesive clusters only if obvious |
| `runtime.ts` | 1291 | ~10 | 17% | 3 | → **WS-5d** convergence (createLightRuntime ↔ createRuntime), not decomposition |

## Re-planned phases

- **WS-6 Phase 5 — `act.ts` cohesion decomp.** 24 functions cluster into: tool-execution orchestration, tool-result assembly, observation building, completion/progress messaging. Extract cohesive clusters to `act/` siblings. Owner: kernel-warden. **No LOC target** — extract what's cohesive, report the shape.
- **WS-6 Phase 6 — `think.ts` cohesion decomp.** Thinking-call + stream-parse + think-guards clusters. Some already in `reason/` (think-guards.ts, stream-parser.ts). Extract residual cohesive units. Owner: kernel-warden.
- **WS-6 Phase 7 — `reactive-agent.ts` + `execution-engine.ts` triage.** Extract ONLY cohesive internal clusters; leave API-doc surface + already-decomposed engine spine. Owner: runtime-warden.
- **arbitrator.ts + event-bus.ts — explicitly NOT decomposed.** Documented as cohesive-by-design. Any future split needs a cohesion justification, not a LOC one.
- **WS-5d — runtime.ts convergence** (tracked separately; path to `as ComposableLayer` = 1).

## Done criteria

- Each decomposed file's extractions are cohesive (a reader can follow one extracted unit without holding the parent's full mutable state in their head)
- Zero behavior change (existing suites are the contract — exact pass-count match)
- No LOC ceiling tests (deleted CORRECTION 4); cohesion is the gate
- `arbitrator.ts` + `event-bus.ts` left large with documented rationale
