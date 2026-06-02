---
title: Tier-Aware Adaptive Context Architecture — control-first harness governance
date: 2026-05-29
status: design-spec
related:
  - "[[2026-05-29-harness-perf-cross-tier-campaign]]"
  - "[[2026-05-29-agentic-context-engineering-findings]]"
  - "[[2026-05-29-e2e-perf-bottleneck-findings]]"
---

# Tier-Aware Adaptive Context Architecture

## Goal (user-stated)

One coherent architecture that lets the harness **dynamically adapt to different
models and provider quirks** to maximize agentic performance, while remaining a
**transparent, control-first harness** (every adaptive knob overridable). Built
ON the existing well-designed systems — wire them together on sound logic, do
not rebuild.

## Evidence base (why)

Cross-tier N=3 baseline (proof gate T1–T5) — THREE distinct failure modes
(see campaign D3):

| Model | Tier | Failure mode | Root rule violated |
|---|---|---|---|
| gpt-4o-mini | mid | redundant recall (data was inline) | Rule 3 |
| qwen3.5 | local | 2× token bloat (12K vs 5.8K) | Rule 2 |
| cogito:14b | local | degraded context use → wrong (T3=34%) | Tier-calibration |

Research canonical model (see findings note): **(1) recent obs inline-full ·
(2) old obs cleared/compacted · (3) recall only for data NOT in context**, ×
a **tier axis** (budget·verbosity·render·clearing·thinking scaled to EFFECTIVE
context, not advertised window — RULER/Context-Rot).

## Existing systems inventory (KEEP / FIX / WIRE)

The substrate is already present. This spec wires it; it does not replace it.

| System | File | State | Disposition |
|---|---|---|---|
| `ContextProfile` + per-tier `CONTEXT_PROFILES` | `context/context-profile.ts` | well-designed; knobs: toolResultMaxChars, toolResultPreviewItems, toolSchemaDetail, maxIterations, temperature, maxTokens, recentObservationsLimit | **KEEP** — the governance knob surface |
| `ModelCalibration` (per-model measured) | `llm-provider/calibration.ts` | well-designed; `observationHandling`, `systemPromptAttention`, `optimalToolResultChars`, `steeringCompliance`, `parallelCallCapability`, `toolCallDialect` — each documents a consumer | **KEEP; WIRE** — `observationHandling` is the recall-gate, currently unwired |
| `applyCapabilityMaxTokens` (effective ctx) | `context-profile.ts:141` | wires `capability.recommendedNumCtx` → `maxTokens` | **KEEP** — effective-context source |
| `profile-resolver` (tier detection) | `context/profile-resolver.ts` | provider+model → tier | **KEEP** |
| `message-window` (old-turn clearing) | `context/message-window.ts` | `KEEP_FULL_TURNS_BY_TIER` | **FIX** — under-tuned for local (rule 2) |
| `context-engine` (system-prompt rules) | `context/context-engine.ts` | tier branch `:188`; recall rule gated on `hasStoredResults` `:189` | **FIX** — gate recall on calibration+truncation, reduce weak-tier verbosity |
| `conversation-assembly` (inline full data) | `act/conversation-assembly.ts` | G-4: full data inline ≤4000 (`TOOL_RESULT_INLINE_CAP`) | **KEEP** (rule 1 already correct) |
| `context-manager` (steering channel) | `context/context-manager.ts` | per-tier system-vs-hybrid delivery | **KEEP** |
| Provider adapters (7 hooks) | `llm-provider/adapters/` | provider-quirk seam | **KEEP** — quirk-adaptation lives here |

## The architecture — one governance flow

```
resolve(provider, model)
  → profile-resolver: tier            ─┐
  → ModelCalibration (measured)        ├─► EffectiveContextProfile  ──► drives:
  → applyCapabilityMaxTokens: eff-ctx ─┘     (tier defaults
                                              ⊕ calibration overrides
                                              ⊕ per-agent overrides ← control-first)
      │
      ├─ Rule 1  recent obs inline-full      → conversation-assembly (KEEP)
      ├─ Rule 2  old obs cleared             → message-window KEEP_FULL_TURNS (FIX, eff-ctx-scaled)
      ├─ Rule 3  recall only if absent       → context-engine recall rule gated on
      │                                         observationHandling + actually-truncated (WIRE)
      └─ Tier    verbosity/render/budget     → context-engine rule count + toolSchemaDetail +
                                                toolResultMaxChars + recency placement (FIX)
```

**Precedence (control-first):** per-agent override > calibration measurement >
tier default > hard-coded fallback. Every adaptation is transparent and
overridable; calibration only fills what the user didn't pin.

## Cross-tier token reality (corrects the bloat root cause — advisor Block 2)

Same T2 task, inline tool-result payload HARD-CAPPED at 4000 for ALL tiers
(`conversation-assembly.ts:105` — tier-INDEPENDENT, not the per-tier
`toolResultMaxChars`):

| Model | T2 total tokens | composite |
|---|---|---|
| sonnet-4-6 (frontier) | **2,218** | 99% |
| gpt-4o-mini (mid) | 5,846 | 99% |
| qwen3.5 (local) | **12,157** | 99% |

6× spread with identical input payload → **the spread is OUTPUT / reasoning
generation verbosity, NOT input or tool-result data.** Weak local models
over-generate. ∴ the local "bloat" is NOT history re-send (the 20-step "93%
input" finding was a STALLED run — does not generalize to this 6-step run) and
NOT the per-tier inline budget (it's hard-capped tier-independent). Both prior
hypotheses refuted. **Requires input/output token split to fully confirm**
(`run-pass.ts:59,61` has `inputTokens`/`outputTokens` — surface in probe; cheap).

## Knob split (corrects advisor Block 1 — verbosity ≠ data-budget)

The existing design DELIBERATELY gives local the LARGEST tool-result data budget
(`toolResultMaxChars` local=4000 > mid=1200 > frontier=600) — comment
`context-profile.ts:67-72`: filter tasks need ALL items visible. **cogito never
recalls (0/15) → a weak model that won't recall needs MORE data inline, not
less.** Shrinking it would worsen cogito T3. So split the "verbosity" axis:
- **Reduce-for-weak (prose):** system-prompt rule count, `toolSchemaDetail`,
  reasoning/output budget. ✓ research-backed (OpenDev, ALP).
- **KEEP/raise-for-weak (data):** `toolResultMaxChars` tool-result payload —
  the existing design is correct; do NOT touch. Recency-place it instead.

## Build increments (each independently ablatable; ≥3pp / ≤15% tok gate)

### Increment 1 — recall redundant-fire (TRACE-PINNED, seam REDEFINED) — PROCEED
- **STALE PLAN SCRATCHED (2026-05-29, trace-verified):** the original "gate
  `buildRules` recall rule on `hasTruncatedResults`" targets **DEAD CODE in
  default config.** Both prompt-rule lure sites are gated OFF by lazyMode
  (`RA_LAZY_TOOLS !== "0"`, default lazy):
  - `context-engine.ts:90-92` buildRules → not called (default).
  - `context-curator.ts:143-144` buildRecentObservationsSection → null (default).
  Probe sets NO `RA_LAZY_TOOLS` → baseline ran default-lazy → those rules never
  fired. Tuning them = probe/production mismatch. **Do not build the buildRules plan.**
- **TRACE EVIDENCE (qwen3.5 T3, run `01KSV58K…`):** `get-hn-posts` →
  **resultLen=3928 (≤4000 `TOOL_RESULT_INLINE_CAP`)** → data FULLY inline, no
  truncation. conversation-assembly:118 hint NOT fired; :205 overflow nudge NOT
  fired (no overflow). Yet model called `recall` **twice** (iter2→40-char
  garbage, iter3→405 char) and composite/tokens degraded. **NONE of the prompt
  lures fired** — the sole lure is `recall` PRESENT IN THE TOOL SCHEMA. Model
  calls it speculatively from tool presence alone. Stochastic + harmful:
  gpt-4o-mini T4 identical-task A/B — one run recalls (composite 0.30, 11199 tok),
  next no-recall (composite 0.91, 5807 tok).
- **Seam (REDEFINED):** `tool-capabilities.ts:80-85` — `append(toToolSchema(
  recallTool))` exposes recall unconditionally when `metaTools.recall`. recall is
  ONLY ever useful at >4000 (≤4000 always inline) → it should not be advertised
  when no overflow exists.
- **Architectural fork (advisor pending):** schema is appended ONCE at setup
  before any tool runs → "gate on actual truncation" is a runtime fact unknown at
  setup. Two options:
  - **(A) per-iteration dynamic surfacing** — recall absent from schema until a
    scratchpad entry's full length >4000 exists, then surfaced (mirrors
    discover-tools lazy disclosure). Preserves mechanism B for ALL models. More
    invasive (find per-iteration schema-assembly seam).
  - **(B) setup-time calibration gate** — advertise recall iff
    `calibration.observationHandling === "uses-recall"`. Simple, but breaks
    mechanism B for non-calibrated models on genuine >4000 overflow.
  - **DECIDED: A** (advisor-confirmed, correctness-preserving). Seam =
    `think.ts:169` `augmentedToolSchemas` — already does per-iteration conditional
    tool visibility (`finalAnswerVisible`); recall becomes a FILTER (remove unless
    usable), not an add.
- **GATE PREDICATE (LOCKED, advisor-sharpened):** recall visible THIS iteration
  iff a **usable recall key is surfaced in the CURRENT window** — i.e. an in-window
  tool_result references stored overflow (reuse `observationReferencesStoredOverflow`,
  the canonical predicate at conversation-assembly:198). NOT ">4000-ever over the
  all-time scratchpad" — a key that scrolls out of the window is gone (message-
  window.ts has ZERO storedKey refs → compaction leaves no pointer; verified), so
  surfacing recall after the key is gone reintroduces the exact blind-recall bug.
  Calibration MAY force-on (`observationHandling === "uses-recall"`, control-first).
- **EVIDENCE AIRTIGHT (trace `01KSV58K`):** recall call args = invented key
  `{"found":false,"key":"hn_posts"}` (real key `_tool_result_1` never surfaced —
  3928 ≤ 4000 inline). Model recalled BLIND purely because the tool was in schema.
  Hiding recall when no key is visible removes ZERO working capability (cleared
  ≤4000 data was never recallable — no key in window).
- **Calibration reality:** `cogito-14b.json` HAS observationHandling; qwen3.5 +
  gpt-4o-mini do NOT. No-calibration default = treat as "needs-inline-facts."
- **Prove:** gpt-4o-mini/qwen3.5 recall-rate → 0 when no >4000 overflow; >4000
  still surfaces recall and it fires; composite flat-or-up; token p95 ↓.
- **Safety:** mechanism-B (>4000 genuine overflow) recall path MUST stay intact.
- **Follow-up (separate commit):** plan-execute / ToT / adaptive have own LLM call
  sites — recall could leak there. think.ts covers the reactive proof substrate first.

### Increment 2 — RE-REVISED: auxiliary LLM-call overhead (debrief/extract/classify)
- **Root cause (localized via in/out split, 2026-05-29):** `inputTokens +
  outputTokens` ≠ `tokensUsed` — the gap = AUXILIARY LLM calls (debrief
  synthesis, memory extraction, classifier) that fold into `tokensUsed` but not
  the reasoning split. On qwen3.5 the gap is **44% of all tokens** (T2: 5217 of
  11893); on gpt-4o-mini **13%** (779). Reasoning input is SIMILAR across tiers
  (qwen3.5 5791 ≈ gpt-4o-mini 4796). **The 2× local bloat is auxiliary calls,
  NOT reasoning context, output verbosity, or history re-send** (all three prior
  hypotheses refuted by the split). Connects to issue #143 (debrief burns
  ~825 tok/task on local, 52% hit max_tokens) + B3 (memory-flush O(conversation)).
- **CONFIRMATION RESULT (2026-05-29):** memory+debrief OFF → gap PERSISTS
  (qwen3.5 T2 gap 5217→5600, T3 3101→3104). **debrief/memory REFUTED.** Mechanism
  traced: think.ts:651-653 accumulates `tokens`/`inputTokens`/`outputTokens` from
  the SAME per-call usage; local.ts:745 sets `totalTokens = in+out` → per-think-
  call gap is 0, NOT a double-count. ∴ the gap is REAL tokens from NON-reasoning
  LLM calls that hit `tokensUsed` but never the in/out accumulators (only think
  updates those). **Leading suspect: classifier (task-intent) + adaptive
  strategy-analysis (`adaptive.ts:303` folds `analysisTokens` into total,
  unsplit).** Local-specific = expensive on verbose local, cheap/skipped frontier.
- **PINNED DEFINITIVELY (2026-05-29):** the gap = `extractObservationFacts`
  (`tool-execution.ts:822`) — a per-tool-result LLM fact-extraction pass, gated
  `act.ts:143-144`: `shouldExtract = obsMode===true || (obsMode!==false &&
  tier∈{local,mid})`. Fires on **local+mid only, NOT frontier**. Matches ALL
  evidence: frontier gap ~0 (off), mid 13% (on, terse), local 44% (on, verbose),
  T1/no-tools gap 0 (no tool result to extract). One extra LLM call per large
  tool result.
- **The redesign question (connects to Rule 3):** extraction pre-digests tool
  results into "facts" for weaker tiers — but the FULL data is ALREADY inline
  (≤4000, conversation-assembly G-4). So it may be REDUNDANT — the same
  "separate call for data already in-context" anti-pattern as the recall lure,
  on the producer side. ~44% of local tokens for possibly-zero correctness gain.
- **ABLATION to decide its fate (run before fixing):** local (qwen3.5 + cogito)
  N=3, `obsMode=false` (extraction OFF) vs baseline. If composite holds (esp.
  cogito T3 strict-correctness) and tokens drop ~44% → extraction is dead weight
  on these tasks → default it off for tiers where inline data suffices, or make
  it conditional on actual truncation (>4000), mirroring Rule 3. If composite
  DROPS (cogito needs pre-digested facts) → extraction earns its keep on the
  weakest tier → keep but make cheaper. **This is the honest fork; the ablation
  decides, not assumption.**
- **Change (candidate, post-confirmation):** tier-gate auxiliary calls — on
  local: skip/cap debrief (or non-blocking), window memory extraction (B3 lever),
  skip classifier via `calibration.classifierReliability === "low"`. Existing
  systems: debrief.ts, memory-flush-dispatch.ts, classifier path.
- **Prove:** qwen3.5 aux-gap ↓ ≥15% of total, composite flat, debrief/memory
  value preserved where it matters (don't blanket-kill — measure value).

### Increment 3 — REVISED: prose-verbosity + recency (NOT data-budget shrink)
- **Change:** weak tiers get FEWER system-prompt rules + trimmed
  `toolSchemaDetail` (prose only); synthesis-critical data RECENCY-placed
  (lost-in-the-middle). **`toolResultMaxChars` UNCHANGED** (keep local=4000).
- **Correctness metric (composite too lenient — it hid cogito's 34%):** define a
  STRICT per-item check (exact top-3-by-comments id match) for T3 before build;
  composite stays as a coarse guardrail only.
- **Prove:** cogito:14b T3 STRICT-correctness variance ↓ + mean ↑ (eliminate the
  34% silent-degradation runs); other tiers no regression.

## Secondary (separate track, not blocking) — stall signal
Entropy is non-discriminating (flat 0.15 → false "stuck" → self-suppress).
Replace with structural "boredom detection" (same-tool+same-params repetition).
`loop-detector` (maxConsecutiveThoughts) is already structural — keep; demote the
entropy stall-detect. Tracked separately from the context architecture.

## Done / proof
- Each increment: cross-tier before/after on PRIMARY structural metrics
  (recall-rate, toolCalls, input-tokens, iterations) via `rax:diagnose diff`;
  composite as correctness guardrail; `bun test` no net-new regressions.
- Control-first verified: every adaptive knob has a working per-agent override
  with a test.
- GitHub-MCP discovery run (mechanism-B / >4000 case) confirms recall still
  fires correctly where genuinely needed.

## Out of scope
Per-workflow model binding (OpenDev pattern) — future. New memory tiers
(Memory v2) — separate track. The stall-signal replacement — separate track.
