---
title: Calibration-Adapter-Driven Tool-Calling — Per-Model Adaptation Loop
date: 2026-06-04
status: proposed (design approved; spec for review)
owner: tool-calling
related:
  - "[[2026-06-03-weak-model-toolcall-gap]]"
  - "[[2026-06-03-tool-calling-driver-redesign]]"
  - "[[Calibration (M7)]]"
  - "[[Provider Adapter Hooks]]"
tags: [design-spec, tool-calling, calibration, adapters, cross-tier, self-improving]
---

# Calibration-Adapter-Driven Tool-Calling

> **Thesis (user, 2026-06-04):** each model has a unique tool-calling failure mode,
> so the harness must **adapt per-model in realtime** via the calibration + adapter
> systems. Structured/native calling when the model is capable; a **reliable,
> model-specific way to extract (or elicit) actions** otherwise. "If we nail tools
> and tool-calling this is a huge win for the framework."

## ⚠️ SCOPE CORRECTION (2026-06-04, post code-audit) — the loop ALREADY EXISTS

Code audit after this spec was drafted found the per-model adaptation loop is
**built and running in production**, not to-be-built. Do not re-implement it:

- **Preflight (consume):** `community-profile-client.fetchCommunityProfile()` GETs
  `https://api.reactiveagents.dev/v1/profiles/<model>` → `Partial<ModelCalibration>`,
  24h-cached, offline-tolerant. `resolveCalibration` merges {community profile +
  local prior + observations}; runs **preflight** at `execution-engine.ts:608`.
- **Observe:** `RunObservation` (`observations-types.ts`) already captures
  `dialect: native-fc|fenced-json|pseudo-code|nameless-shape|none`,
  `classifierRequired` vs `classifierActuallyCalled` (= drift), `argValidityRate`.
  Built + persisted every run: `telemetry-emit.ts:261-275` →
  `persistRunObservation` → `appendObservation` (50-run window).
- **Refine:** `onRunCompleted` (`local-learning.ts`) folds observations back into
  the profile; `observations-merge.ts`.
- **Confidence:** `conformal.ts` (conformal prediction) — the PT2 abstain concern
  is already addressed.
- **Contribute:** `telemetry-client` → `/v1/reports`.

**The resolved `toolCallDialect` even reaches the kernel** (`tool-schemas.ts:123`).
The ONE severed link: **the router ignores it.** Stage A (`11996c5a`) made
`selectToolCallingDriver` capability-first (`_dialect` unused) to kill the
regression — correct then, but it means the calibrated/observed dialect is now
**inert at the routing decision**.

**Revised gap (this is the actual work — small; priorities corrected post-audit):**

- **G3 (route on calibrated dialect) is INERT — DROP it.** `NativeFCStrategy`
  (`native-fc-strategy.ts`) is calibration-blind and already tries ALL dialect
  tiers unconditionally every turn (native → fenced-json/nameless-shape →
  pseudo-code). Routing the extractor on the calibrated dialect adds nothing; the
  only dialect that *would* change routing (→ text-parse) is the 482c11e4
  regression. Stage A was right to ignore `_dialect`. Do not rewire.
- **▶ KEYSTONE — capture + consume `namespaceTolerance`.** The most dramatic
  measured failure (qwen3 0/15 namespaced, flips 14→0 on flat names) is a
  **name-string** problem, NOT a dialect problem. Capture freeze-on-namespaced in
  `RunObservation`; consume it by presenting **flat tool names** to freeze-prone
  models (de-sanitize on return — the roundtrip at `think.ts:627-633` already
  exists). This is **safe** (orthogonal to the driver/resolver divergence that
  caused 482c11e4 — it changes the name shown, not the routing) and
  **evidence-backed**. ~surgical change. This is the real win on the table.
- **Capture `no-emission`** — `RunObservation` has dialect + drift but not
  "emitted zero calls" (cogito's ~20% failure mode). Add it so the loop can SEE
  that failure (prerequisite for any input-forcing lever later).

**Probe priors are untrustworthy (spike `bhu9jhu52`, 2026-06-04).** A fixed
probe task ANTI-predicts: qwen2.5 (real 20/20) scored 3/15 on an explicit
"call X with these args" probe (over-specifying suppressed emission); cogito
probe 11/15 vs bench 15/15. So the offline dialect probe (G1) is NOT worth
completing — **real-run observations (already wired) are the trustworthy signal.**
Completing G1 would cache a misleading prior.

§§4–9 below still describe the target shape correctly, but most components in §7
**already exist** — re-scope each "build" to "wire/extend" against the audit above.

## 1. Why this, why now

The measurement in [[2026-06-03-weak-model-toolcall-gap]] is unambiguous: tool-call
reliability is **model-specific**, not a single bug. qwen2.5:14b is perfect (60/60);
cogito:14b ~80% (forms intent, omits the native call); qwen3:14b 0/15 on namespaced
fetch (slash-name freeze + reasoning-mode). One universal fix cannot cover this.

The right structure is **per-model adaptation**, and the framework is ~70% there
already — the calibration profile, the 7 adapter hooks, the provider-level
`parseToolCalls` seam, and the `lastDialectObserved` signal all exist. They are
**not closed into a loop**. This spec closes the loop.

## 2. Current systems (what exists) + the three gaps

| System | State | Evidence |
|---|---|---|
| `ModelCalibration` (M7) — `toolCallDialect` + `steeringCompliance`, `systemPromptAttention`, `observationHandling`, `knownToolAliases`… | schema exists, rich | `llm-provider/src/calibration.ts:34-88` |
| Adapter hooks (M12) — 7 input-shaping hooks | **all wired** in kernel | `grep adapter.<hook>` → taskFraming/toolGuidance/continuationHint/errorRecovery/synthesisPrompt/qualityCheck/systemPromptPatch |
| `parseToolCalls` adapter hook — per-model extraction seam | **wired at provider level** | `providers/{openai,litellm,local}.ts` |
| `lastDialectObserved` — which dialect actually fired | **recorded** | `think.ts:889-894`, `kernel-state.ts:171` |

**Gaps that make the above inert:**

- **G1 — calibration never measures tool-calling style.** `calibration-runner.ts:313`
  hardcodes `toolCallDialect:"none"`. It probes parallel-calls + recall, never how
  the model emits a call. The keystone signal is fabricated.
- **G2 — the adaptation loop is OPEN.** `lastDialectObserved` is telemetry-only.
  Nothing (a) switches strategy mid-run, (b) persists it to calibration, or (c)
  reshapes the prompt from it. "Realtime adapt" is observed, not acted on.
- **G3 — routing ignores calibrated style.** Stage A (`11996c5a`,
  [[2026-06-03-tool-calling-driver-redesign]]) routes by *capability* only;
  calibrated dialect picks neither the extractor nor the input-shaping.

## 3. The model taxonomy (calibration's job to classify)

Calibration assigns each model an **extraction class** — the lever it needs:

| class | meaning | lever |
|---|---|---|
| **native-capable** | emits structured native FC reliably (qwen2.5, gemma) | native FC, zero overhead |
| **extractable-dialect** | doesn't emit native FC, but emits a *parseable structure* (fenced-json / pseudo-code / a defined `<tool_call>` carrier) | matched **extractor** (output-side) |
| **needs-input-forcing** | emits only prose/reasoning, nothing structured (qwen3 freeze) | adapter **prompt-shaping** (input-side): force-the-call, reasoning-mode handling — or route to native |

Plus orthogonal **trait flags** calibration records:
- `namespaceTolerance: ok | freezes` — qwen3 freezes on slash names; flat names flip
  no-emission 14→0. When `freezes`, expose flat names + de-sanitize on the way back
  (the sanitize roundtrip at `think.ts:627-633` already exists; this drives WHICH names are shown).
- `driftProneTo: [find, …]` — models that grab generic meta-tools; gate meta-tools / sharpen descriptions for them.
- `dialect: native-fc | fenced-json | pseudo-code | carrier | …` — the extractor key for the extractable class.

## 4. The loop (the canonical design)

```
   ┌─────────────────────────────────────────────────────────────────────────┐
   │  CALIBRATE  (offline probe → cached prior)                                │
   │    real dialect probe: give the model a tool + a forcing task, observe    │
   │    HOW it emits → {class, dialect, namespaceTolerance, driftProneTo}      │
   └───────────────┬───────────────────────────────────────────────────────────┘
                   ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │  ROUTE  (per calibrated class)                                            │
   │    native-capable      → native FC (Stage A, unchanged)                   │
   │    extractable-dialect → matched extractor + carrier-shaping prompt       │
   │    needs-input-forcing → force-call prompt-shaping (adapter), native attempt│
   │    + apply trait flags: flat names if freezes; gate meta-tools if drift   │
   └───────────────┬───────────────────────────────────────────────────────────┘
                   ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │  OBSERVE  (lastDialectObserved — already recorded)                        │
   └───────────────┬───────────────────────────────────────────────────────────┘
                   ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │  ADAPT (realtime)  +  PERSIST (self-improving)                            │
   │    in-run: native FC absent but a text dialect fired → switch extractor   │
   │            for remaining iterations + reshape prompt; if 0 parseable      │
   │            emission → escalate to force-call prompt (not prose-mining)    │
   │    cross-run: persist observed dialect/class to calibration (learning     │
   │            pipeline) so next run starts pre-tuned                         │
   └─────────────────────────────────────────────────────────────────────────┘
```

## 5. Safety boundary (carried from the gap design — NON-NEGOTIABLE)

Extraction reads **structure, never prose.** A model in the extractable class must
emit a *parseable* structure (fenced-json, pseudo-code, or a defined `<tool_call>`
carrier whose `tool`+`args` are fields). The harness MUST NOT NL-mine a free-text
rationale/prose for an executable action — negation ("do NOT use delete-file"),
alternatives, past-tense re-fire, and outward-facing tools (`signal/send_message`)
make prose-mining unsafe as default-on. If a model only emits prose intent, it is
`needs-input-forcing` (reshape the prompt so it emits structure or native), NOT a
prose-extraction target. See [[2026-06-03-weak-model-toolcall-gap]] §3.

## 6. Honest risks

- **Extraction floor.** Extraction helps only if the model emits *something*
  parseable. `needs-input-forcing` models depend on prompt-shaping working — which
  may not, for the weakest models. Calibration must be honest when a model is
  simply unreliable for tools (and the system should surface that, not paper over it).
- **Realtime cost.** In-run detection burns iterations before it corrects. The
  cached calibration prior is the fast path; realtime is the corrector for
  uncalibrated/mis-calibrated models. Persist-back amortizes it.
- **Calibration staleness / wrongness.** A wrong cached dialect is worse than none
  (mis-routes confidently). Realtime observation must be able to OVERRIDE a stale
  prior in-run, and persist the correction.
- **qwen2.5 regression.** Every change must leave already-perfect models untouched
  — they take the native path and must never be downgraded. **qwen2.5:14b is the
  regression control gate** for every stage.

## 7. Components (build/extend, mapped to existing code)

| # | Component | Action | Location | Owner |
|---|---|---|---|---|
| C1 | Real dialect probe | replace the `"none"` stub with a probe that gives the model a tool + forcing task and classifies its emission | `calibration-runner.ts` | provider-warden |
| C2 | Richer calibration fields | add `extractionClass`, `namespaceTolerance`, `driftProneTo`; widen `dialect` taxonomy | `calibration.ts` schema | provider-warden |
| C3 | Calibrated router | extend Stage-A `selectToolCallingDriver` to key on `{capability, calibratedClass, traits}` → {extractor, attachTools, names-shape} | `tools/drivers/select-driver.ts` + `runner.ts` | tools-warden + kernel-warden |
| C4 | Matched extractors | generalize resolver tiers into a dialect→extractor map (incl. the structured `<tool_call>` carrier) | `tools/tool-calling/` | tools-warden |
| C5 | Calibration-conditioned input-shaping | drive adapter `toolGuidance`/`systemPromptPatch`/force-call from `steeringCompliance` + class | `llm-provider` adapters + kernel wiring | provider-warden + kernel-warden |
| C6 | Realtime feedback | `lastDialectObserved` → in-run extractor switch + force-call escalation when 0 parseable emission | `think.ts` / reactive-observer | kernel-warden |
| C7 | Persist-back | observed dialect/class → calibration store (learning pipeline seam) | memory/learning + calibration | memory-warden + provider-warden |
| C8 | Validation bench | harden `apps/examples/toolcall-gap-probe.ts` into the cross-model gate | benchmarks/probe | — |

## 8. Staged plan (each stage gated; see companion plan)

1. **Stage 0 — bench.** Harden the probe harness (C8) into the repeatable cross-model
   gate (cogito/qwen3/qwen2.5/llama3.1; ERROR vs NO_EMISSION vs DRIFT vs SUCCESS;
   flat/namespaced; meta on/off). Establish baselines. *Gate for all later stages.*
2. **Stage 1 — calibration measures style (C1, C2).** Real dialect probe →
   {class, dialect, traits}. *Gate:* probe classification matches Stage-0 observed
   behavior per model (qwen2.5=native-capable, qwen3=needs-input-forcing+freezes,
   cogito=extractable/native-borderline).
3. **Stage 2 — route by calibration (C3, C4).** capable→native; extractable→matched
   extractor + carrier prompt; traits applied (flat names, meta-gating). *Gate:*
   cogito-class success ↑, **qwen2.5 unchanged (control)**, N≥15 cross-model.
4. **Stage 3 — input-forcing lever (C5).** Adapter prompt-shaping for
   needs-input-forcing/reasoning models. *Gate:* qwen3 success ↑ from 0, or honest
   "unreliable for tools" classification surfaced; qwen2.5 unchanged.
5. **Stage 4 — close realtime loop (C6, C7).** In-run switch + persist-back.
   *Gate:* uncalibrated model self-tunes within a run; second run starts calibrated;
   no regression.

Lift rule per stage (project standard): ≥3pp first-attempt success AND ≤15% token
overhead → default-on; else opt-in; else revert. **qwen2.5 regression control is a
hard gate on every stage.**

## 9. Relationship to prior work

- **Stage A (`11996c5a`)** — capability-first routing — is the **native-capable**
  branch of C3, already shipped. This spec generalizes routing to all three classes.
- The **structured-carrier** (gap design §3.1) becomes **one extractor** in C4 (the
  carrier dialect for extractable-dialect models) — not the whole answer.
- Stage-B "complete the text-parse think→acting transition" from the driver redesign
  is subsumed by C4 + C6 (matched extractor + realtime switch).

## 10. Open question for review

- **Probe cost & trigger.** When does the offline dialect probe run — first use of a
  model? a `rax-diagnose` invocation? CI? It costs a few LLM calls per model.
  Proposal: lazy (first-use, cached) + manual `rax-diagnose` refresh; persist-back
  (Stage 4) keeps it current. Confirm.
