---
title: Implementation Plan — Calibration-Adapter-Driven Tool-Calling
date: 2026-06-04
status: proposed (awaiting review before code)
spec: "[[2026-06-04-calibration-adapter-toolcalling]]"
related:
  - "[[2026-06-03-weak-model-toolcall-gap]]"
  - "[[2026-06-03-tool-calling-driver-redesign]]"
tags: [implementation-plan, tool-calling, calibration, adapters]
---

# Implementation Plan — Calibration-Adapter-Driven Tool-Calling

Executes the loop in [[2026-06-04-calibration-adapter-toolcalling]]: calibrate →
route (per class) → observe → adapt realtime → persist. Branch:
`fix/text-parse-bare-toolcall` (continues from Stage A `11996c5a`).

**Cross-cutting gates (every stage):**
- **qwen2.5:14b regression control** — must stay at its baseline (zero degradation).
- Cross-model N≥15 on the Stage-0 bench (cogito:14b, qwen3:14b, qwen2.5:14b, llama3.1).
- Lift rule: ≥3pp first-attempt success AND ≤15% token overhead → default-on; else opt-in; else revert.
- Team-ownership pilot routing (→ 2026-06-15): calibration/probe → `provider-warden`;
  kernel routing/realtime → `kernel-warden`; tools extractors → `tools-warden`;
  persist-back → `memory-warden`. MissionBrief in / UpwardReport out.
- TDD: RED test per task before implementation.

---

## Stage 0 — Validation bench (keystone; gates everything)

**Goal:** a repeatable cross-model gate; baselines recorded.

- T0.1 Harden `apps/examples/toolcall-gap-probe.ts`: keep ERROR≠NO_EMISSION≠DRIFT≠SUCCESS;
  matrix over {model} × {task: trivial, fetch} × {tool-name: flat, namespaced} ×
  {meta: on, off}; per-cell N configurable; emit `GAP_PARTIAL` + final JSON.
- T0.2 Run baselines for the 4 models; record to
  `wiki/Research/Harness-Reports/2026-06-04-toolcall-baselines.md`.
- **Gate:** matrix reproduces the §5b findings within variance; baselines committed.

---

## Stage 1 — Calibration measures tool style (C1, C2)

**Goal:** replace the `toolCallDialect:"none"` stub with a real probe that
classifies the model.

- T1.1 (RED) Test: a probe harness, given a stub model that emits native FC, returns
  `extractionClass:"native-capable"`; given one that emits fenced-json,
  `"extractable-dialect", dialect:"fenced-json"`; given prose-only, `"needs-input-forcing"`.
- T1.2 Extend `ModelCalibration` schema (C2): add `extractionClass`
  (`native-capable | extractable-dialect | needs-input-forcing`),
  `namespaceTolerance` (`ok | freezes`), `driftProneTo: string[]`; widen `dialect`.
  Keep `toolCallDialect` for back-compat (derive from new fields).
- T1.3 Implement the probe in `calibration-runner.ts` (C1): present a single tool +
  a forcing task ("call X with these args"); run k≥3; observe emission via the
  existing native-FC + dialect detection (`lastDialectObserved` machinery); also
  probe a namespaced-name variant to set `namespaceTolerance`.
- T1.4 Wire probe output into the calibration write path; `capability-resolver` reads it.
- **Gate:** probe classifies the 4 live models to match Stage-0 observed behavior
  (qwen2.5=native-capable/ok; qwen3=needs-input-forcing/freezes; cogito≈
  extractable-or-native-borderline; llama3.1 per its real behavior). No qwen2.5 change.

---

## Stage 2 — Route by calibration (C3, C4)

**Goal:** the calibrated class/traits pick extractor + names-shape; extractable models
get a matched extractor.

- T2.1 (RED) Test: router returns native for native-capable; matched extractor +
  carrier-instructions for extractable; flat names when `namespaceTolerance:freezes`;
  meta-gated when `driftProneTo` non-empty.
- T2.2 Extend `selectToolCallingDriver` (C3) to take `{supportsToolCalling,
  calibration}` → coherent route (generalizes Stage A's capability-first triple).
- T2.3 Generalize resolver tiers into a dialect→extractor map (C4); add the
  structured `<tool_call>{tool,args}` carrier extractor (reads FIELDS, never prose — §5 safety).
- T2.4 Apply trait flags in the kernel: expose flat names + de-sanitize when freezes;
  gate meta-tools (or sharpen `find` description) when drift-prone.
- **Gate:** cogito-class success ↑ vs Stage-0; **qwen2.5 unchanged**; namespaced qwen3
  no-emission ↓ (flat-name routing); N≥15 cross-model. Harness report.

---

## Stage 3 — Input-forcing lever (C5)

**Goal:** for `needs-input-forcing`/reasoning models, shape the prompt to elicit a
structured/native call (output-side extraction cannot help when nothing parseable is emitted).

- T3.1 (RED) Test: for a needs-input-forcing calibration, the adapter injects a
  force-call directive (and reasoning-mode handling) via `toolGuidance`/`systemPromptPatch`.
- T3.2 Implement calibration-conditioned input-shaping in the adapter layer, keyed by
  `extractionClass` + `steeringCompliance`.
- T3.3 Reasoning-mode (`<think>`) handling: ensure intent that lands in the thinking
  channel is given a structured path to a call (broaden/repair the `rescueFromThinking`
  seam at `think.ts:747` to route to a call, not just text — within §5 safety).
- **Gate:** qwen3 success ↑ from 0 OR an honest "unreliable for tools" surfaced
  (not papered over); qwen2.5 unchanged; cross-model N≥15.

---

## Stage 4 — Close the realtime loop (C6, C7)

**Goal:** in-run adaptation + cross-run self-improvement.

- T4.1 (RED) Test: when native FC is absent but a text dialect fires, the next
  iteration uses the matched extractor + reshaped prompt; when 0 parseable emission
  for k iters, escalate to force-call (NOT prose-mining).
- T4.2 Implement in-run switch from `lastDialectObserved` (C6) in think/reactive-observer.
- T4.3 Persist observed `{dialect, class, traits}` back to calibration via the
  learning-pipeline seam (C7); next run reads the updated prior.
- **Gate:** an uncalibrated model self-tunes within a run; second run starts
  calibrated (fewer wasted iters); no regression; persist-back is idempotent + honest
  (never fabricates a class on insufficient evidence).

---

## Done criteria

- 4-model bench: weak-model success materially ↑ vs Stage-0 baselines; qwen2.5 flat.
- Calibration honestly classifies each model; routing + shaping derive from it.
- Realtime loop closes (observe→adapt→persist) and is self-improving.
- All gates green; lift rule satisfied for default-on pieces; rest opt-in or reverted.
- Harness reports per stage in `wiki/Research/Harness-Reports/`.

## Risks / kill conditions

- If Stage 1's probe can't reliably classify (high variance), STOP — realtime-only
  fallback (no offline prior) until the probe is trustworthy.
- If input-forcing (Stage 3) can't move qwen3-class, classify honestly as
  tool-unreliable and document; do not ship a fake fix.
- Prose-mining stays rejected as default-on throughout (§5).
