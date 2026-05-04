---
aliases: [reasoning package, Cognitive Kernel]
tags: [package, composition, kernel]
layer: Composition
owner: Reasoning Team
status: Stable (v0.10.0)
debt: builder.ts (6082 LOC) + execution-engine.ts (4499 LOC) need decomposition
---

# Package: reasoning

**Layer:** Composition (depends on core, llm-provider, memory)

**Owner:** Reasoning Team

**Status:** ✅ Stable (v0.10.0) — M1, M2, M9 validated

---

## Purpose

The `reasoning` package implements the cognitive kernel:
- **12-Phase Kernel** — Think → Act → Observe → Verify → Reflect loop
- **5 Strategies** — raw, naive, todo, plan-execute, tree-of-thought
- **Observable State** — KernelState, step accumulation, metrics

---

## Architecture

### Kernel Phases

| Phase | File | Purpose |
|-------|------|---------|
| Think | `kernel/capabilities/reason/think.ts` | LLM reasoning |
| Act | `kernel/capabilities/act/act.ts` | Tool execution |
| Observe | `kernel/capabilities/sense/step-utils.ts` | Observation collection |
| Verify | `kernel/capabilities/verify/verifier.ts` | M3 quality gates |
| Reflect | `kernel/capabilities/reflect/` | M1 RI dispatch, loop detection |

### Strategies

```
packages/reasoning/src/strategies/
├── raw.ts                 # Direct LLM response
├── naive.ts              # Single turn with tools
├── todo.ts               # Break into steps
├── plan-execute.ts       # Plan then execute (M2 switching + perRIEarlyStop)
└── tree-of-thought.ts    # Explore multiple paths
```

---

## Key Files

| File | LOC | Purpose |
|------|-----|---------|
| `kernel/loop/runner.ts` | 1,706 | Main kernel loop |
| `kernel/capabilities/decide/arbitrator.ts` | 250+ | M9 termination arbitration |
| `kernel/capabilities/reflect/reactive-observer.ts` | 400+ | M1 RI dispatch (6 handlers) |
| `kernel/capabilities/reflect/loop-detector.ts` | 200+ | Loop detection (IC-1 fix) |
| `kernel/capabilities/act/act.ts` | 400+ | Tool execution |
| `kernel/capabilities/reason/think.ts` | 500+ | LLM reasoning |

---

## Tests

| Test Suite | Tests | Pass | Coverage |
|------------|-------|------|----------|
| strategy-switching.test.ts | 20 | 20 | M2 heuristics |
| termination-oracle.test.ts | 24 | 24 | M9 paths (9/9) |
| loop-detection.test.ts | 18 | 18 | IC-1 fix validation |
| verifier.test.ts | 22 | 22 | M3 gates |
| healing-pipeline.test.ts | 15 | 15 | M4 recovery |
| **Total** | 287+ | 287 | 100% |

---

## Phase 1 Validation

### M1: RI Dispatcher ✅ KEEP
- 6 handlers registered at builder.ts:2673-2731
- All event wiring validated
- Entropy-driven intervention working

### M2: Strategy Switching ✅ KEEP
- 20 passing tests on switching heuristics
- Requires real LLM validation Phase 1.5

### M9: Termination Oracle ✅ KEEP
- All 9 termination paths consolidated
- 100% path coverage enforced
- Single arbitrator at arbitrator.ts

---

## Architectural Debt

**Phase 2 Decomposition Target:**

- `builder.ts` — 6,082 LOC (strategy selection, config wiring)
- `execution-engine.ts` — 4,499 LOC (not in reasoning; in runtime)

Both need splitting into 3 focused components:
1. Strategy selector
2. Kernel coordinator
3. State machine

---

## Dependencies

**Depends on:**
- `core` — EventBus, types
- `llm-provider` — LLM calls
- `memory` — Context preservation
- `tools` — Tool execution
- `verification` — M3 verifier gates

**Used by:**
- `runtime` — ExecutionEngine wraps reasoning kernel
- `orchestration` — Coordinates multi-kernel workflows

---

## Phase 2 Improvements

- Default-enable M2 strategy switching for multi-step tasks
- Decompose builder.ts + execution-engine.ts (Phase 2 gate)
- Wire M9 arbitrator to ToT outer loop (current gap)

---

## Key Design Patterns

### Observable State

```typescript
interface KernelState {
  messages: Message[];        // What LLM sees
  steps: Step[];             // What system observes
  phase: 'think' | 'act' | ...; // Current phase
  entropy: number;            // M1 signal
  // ... metrics, diagnostics
}
```

### Event-Driven Intervention

```typescript
// M1 RI dispatcher listens to entropy
onEntropyScored: (signal) => {
  if (signal.entropy > threshold) {
    dispatch('controllerDecision', { suggestion: 'switch-strategy' });
  }
}
```

---

## References

- [[MOCs/Architecture MOC|Architecture MOC]] — 12-phase kernel design
- [[Experiments/M1 RI Dispatcher|M1 RI Dispatcher]] — Intervention logic
- [[Experiments/M2 Strategy Switching|M2 Strategy Switching]] — Strategy selection
- [[Experiments/M9 Termination Oracle|M9 Termination Oracle]] — Arbitration

---

**Last Updated:** 2026-05-04  
**Layer:** Composition  
**Status:** ✅ Stable — Phase 1 mechanisms validated
