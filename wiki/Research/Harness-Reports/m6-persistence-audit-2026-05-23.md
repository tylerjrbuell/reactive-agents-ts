---
tags: [evidence, m6-persistence, q3-gate]
date: 2026-05-23
campaign-step: gate-check for steps 4 + 5
answers: prerequisite check before running learning probes
---

# M6 Skill Persistence — Wiring Audit

## TL;DR — Skill persistence is wired but gated, and errors are silent

The mechanism is **structurally complete** in code: SkillStoreService (`packages/memory/src/services/skill-store.ts`) has full CRUD with SQLite backing. Writes fire from `learning-engine.ts:166`. SO: M6 persistence is NOT missing.

But three structural barriers prevent it from working in default agent runs:

1. **Opt-in via `.withMemory()`.** Without this builder call, `MemoryDatabase` service isn't provided, `SkillStoreServiceLive` Layer can't resolve, and the write path no-ops.

2. **Errors are silently swallowed** — `learning-engine.ts:166`: `Effect.catchAll(emitErrorSwallowed)` wraps the `skillStore.store(entry)` call. SQLite write failures (no DB, schema drift, permissions) emit one debug event and disappear.

3. **`skillSynthesized` conditional gate.** The store call only fires when `skillSynthesized === true`. The synthesis criteria are buried; likely require accumulated success patterns that single-task runs don't trigger.

## Consequence for Step 5 (cross-session lift)

A naive Step 5 probe (`bun -e "...same task twice..."`) **will measure zero cross-session lift** even if the framework works correctly — because:

- Default builder won't enable memory
- Even with memory enabled, single-task runs won't trigger synthesis
- Even with synthesis triggered, errors disappear

**A meaningful Step 5 requires:**

```typescript
const agent1 = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel({ model: "qwen3:14b" })
  .withReasoning({ defaultStrategy: "reactive", maxIterations: 8 })
  .withReactiveIntelligence()  // gates learning-engine
  .withMemory({ tier: "enhanced", dbPath: "./test-cross-session.db" })  // gates SkillStoreService
  .withTools({ allowedTools: ["web-search", "final-answer"] })
  .withTracing({ dir: traceDir })
  .build();

// Run task 1 → 3 times → trains synthesis
// Dispose
// Build agent2 with SAME dbPath SAME agentId
// Run same task again
// Compare iter count, output quality
```

Plus: a debug toggle to disable `emitErrorSwallowed` on the skill store path so failures surface. Otherwise the probe is blind.

## Consequence for Q3c gate

The campaign's Q3c threshold ("≥5pp session-2 lift → scatter works") cannot be evaluated until the above probe runs. **Q3c is currently UNRUN, not falsified.**

## Consequence for M7 calibration consumer count

Previous audit ("14 fields, ~5 consumers") may undercount. Calibration consumers in RI fire conditionally on memory + RI both enabled. Our failure-corpus runs don't enable memory → calibration writes don't fire → consumer count appears smaller than it is. **M7 consumer audit must redo with `.withMemory()` ON.**

## Decision for the campaign

- Step 4 (within-session quality delta): can be analyzed from existing matrix data + sweep traces. Multi-iter runs already show iter-to-iter quality. **Defer to drill-down on existing data; no new probe needed.**

- Step 5 (cross-session repeat): **deferred.** Requires dedicated probe design (~80-100 LOC), persistent dbPath, and debug-error-surfacing toggle to be meaningful. ~2 hour design+run+analysis cycle. Mark Q3c as "unrun pending dedicated probe."

- Q3 verdict from existing evidence: **scattered learning IS structurally implemented; conditional firing means it's empirically untested.** This is *itself* a finding — the system has the wiring but no default path exercises it.

## What this means for morph direction

The drift analysis's Call 3 ("`learn/` capability — kernel or scattered") now sharpens:

- **NOT "scattered learning doesn't exist."** It exists.
- **IT IS "scattered learning is gated by opt-ins few users enable, with silent failure modes."**
- Symptom: framework advertises compounding intelligence; default config doesn't compound; failure is invisible.

This is **another instance of the "scaffold without callers" pattern (R2/R3/R4)** but with a twist — there IS a caller, it's gated, and the gate is hidden behind two builder method calls users may not know to combine.

**Fix shape:** either make `.withMemory()` default-on (with sensible defaults) OR document the combination clearly OR expose a single `.withLearning()` builder method that wires both required pieces.

## Anti-mission check

Mission Statement #5: *"NOT an instrumentation-late framework. Every shipped capability emits a trace event in the same commit. 'We'll add traces later' is permanent debt."*

The `emitErrorSwallowed` on skill persistence is the inverse — instrumentation that exists but suppresses observability of its own failures. Worse than missing instrumentation: it's anti-instrumentation. The skill-store error path needs to emit a distinct, surface-able event so users know learning is failing if it is.

## Recommended action

Add R11 to Phase 0 emergency surface bugs:

**R11 — Silent failure on skill persistence.** `learning-engine.ts:166` swallows store errors. Replace with explicit `emitLog({ _tag: "warning", warning: "skill-persistence-failed", ... })` so framework health is observable. ~5 LOC fix.

And one new mission anti-pattern to codify:

> **`emitErrorSwallowed` MUST emit a structured `error-swallowed` event** with site + tag. Already does (verified: `emitErrorSwallowed` IS the structured event). But trace consumers (rax-diagnose) need a filter view: `grep "kind === 'error-swallowed'"` should be a routine diagnostic step. Add to skill SKILL.md if not present.

## Status

- Step 4 reclassified: analyze from existing data, no new probe
- Step 5 deferred: needs dedicated probe + ~2hr cycle
- Step 7 (frontier) running in background
- Q3c: unrun
- Q3a: partial (matrix data provides iter-to-iter signal; specific multi-iter analysis pending)

Recommend: when Step 7 lands, write final synthesis + GitHub issue plan. Step 5 can be its own dedicated probe later.
