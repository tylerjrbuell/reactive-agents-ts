---
type: design-spec
status: proposed
created: 2026-06-11
tags: [evidence-grounding, verifier, kernel, opt-in, scaffold-leak, DX]
---

# Spec: Opt-In Evidence-Grounding Redesign + Standalone Scaffold-Leak Guard

> Evidence-grounding currently impedes progress more than it helps: an always-on byte-substring check on `$…` figures flags **correct** answers (`$62,578`) because the compressed/reformatted tool observation lacks the literal `62578` substring. It fires as a mid-loop nudge AND a terminal warn. This redesign makes numeric grounding **opt-in (off by default)** and **genuinely good when on** (full-data corpus + tolerant numeric matching), while splitting the zero-false-positive **scaffold-leak** detector into a standalone **always-on** correctness guard. User decisions (2026-06-11): opt-in like verification; scaffold-leak stays always-on + separate; action is **configurable `block | warn`**; deterministic-only (no LLM-judge in scope — Approach A).

## 1. Goal & non-goals

**Goal.** By default, no numeric/claim grounding runs — zero progress impediment. When a user opts in via `.withGrounding({ mode })`, grounding is accurate (no false-positives on correctly-formatted figures) and adds real anti-hallucination value for data-extraction / financial tasks. A separate always-on guard still catches the model emitting framework scaffolding (`[STORED:]`, `_tool_result_N`) as its answer.

**Non-goals.**
- No LLM-judge / semantic grounding (Approach B/C) — deterministic only. Prose-claim grounding is **removed**, not reworked (it was 64-73% false-reject; not resurrected).
- No change to the runtime `withVerification` LLM-tier system (a separate concern from the kernel `defaultVerifier`).
- No change to the arbitrator controller-signal veto (separate mechanism).
- Grounding never **hard-fails a run** — `block` mode degrades to `warn` after retries.

## 2. Architecture — two independent concerns

| Concern | Module | Default | Severity | Rationale |
|---|---|---|---|---|
| **Scaffold-leak** (model parrots `[STORED:]`/`_tool_result_N`/`compressed preview` as the answer) | `kernel/capabilities/verify/scaffold-leak.ts` (NEW) | **always-on** | `reject` | Harness-leak correctness bug; always wrong; ~zero false-positive. Not "grounding". |
| **Numeric evidence-grounding** (figures in answer absent from tool data) | `kernel/capabilities/verify/evidence-grounding.ts` (REWORKED) | **off** (opt-in) | `reject` (block) / `warn` (warn) | The false-positive-prone check; gated + rebuilt. |

`evidence-grounding.ts` loses: `validateGeneralizedGrounding` (the prose claim pass + `enableClaimGrounding`/`syntheGrounding` option) and `COMPRESSION_MARKER_PATTERNS` (moves to `scaffold-leak.ts`). It keeps a reworked numeric path + `validateExpectedEntitiesInOutput` (only when grounding enabled).

## 3. Config & gating

```ts
// new — packages/reasoning/src/types (or kernel-state KernelInput)
export interface GroundingConfig {
  /** Required. Presence of the config = grounding enabled. */
  readonly mode: "block" | "warn";
  /** Numeric match tolerance as a fraction (rounding). Default 0.01 (1%). */
  readonly tolerance?: number;
  /** block mode: corrective retries before degrading to warn. Default 1. */
  readonly maxRetries?: number;
}
```

- Threaded as a **cross-cutting** field on `KernelInput` via the existing `buildKernelInput` Pick-partition (`CrossCuttingInput`), so every strategy/pass inherits it (consistent with `harnessPipeline`/`verifier`/etc., FM-I builder).
- Builder: `.withGrounding(opts: GroundingConfig)` wither in `packages/runtime/src/builder.ts` → sets the field. Declarative mirror: `GroundingConfigSchema` in `agent-config.ts`, wired in the `withGrounding` apply path.
- `KernelInput.grounding === undefined` ⇒ **off**: the verifier grounding check and the `think-guards` mid-loop guard both no-op.

## 4. The matcher (only runs when enabled)

Function: `validateNumericGrounding(output, corpus, tolerance): { ok } | { ok: false, violations }`.

1. **Corpus = FULL tool data, not the compressed preview.** New `buildEvidenceCorpusFromSteps(steps, scratchpad)` resolves each observation step's `storedKey` → the scratchpad's full stored value; falls back to `extractedFact`, then step `content`. (The old corpus used the compressed preview text — the documented false-reject cause: preview held only the first ~N items, so figures from items N+1 read as "ungrounded".)
2. **Extract numeric claims** from `output`: dollar amounts + bare numbers with ≥3 significant digits.
3. **Normalize both sides:** strip `$ , whitespace` + currency words (`usd`, `dollars`); parse magnitude suffixes (`62.5k`→62500, `1.2M`→1_200_000); produce a numeric value per token.
4. **Tolerant value match:** a claim value `c` is grounded iff some corpus value `e` satisfies `|c − e| ≤ tolerance × max(|c|, |e|)`. (Handles rounding: `$62,578` grounds against `62578.12`.) Substring is NOT used.
5. Claims with no tolerant match → `violations` (`"unverified figure: $X"`). Empty/thin corpus (< 20 normalized chars) or zero numeric claims ⇒ `{ ok: true }` (never penalize when we can't ground).

## 5. Action wiring

Read in `verifier.ts` terminal verification + `think-guards.ts` mid-loop, gated on `grounding`.

- **`warn` mode:** push a verifier check `{ name: "evidence-grounding", passed: false, severity: "warn", reason: "unverified figures: …" }` → surfaces `verifierWarning` on the result, never suppresses. Emit a compose tag so observers can `.tap()` it. **No mid-loop guard** (advisory must not interrupt).
- **`block` mode:**
  - **Mid-loop** (`think-guards` `evidenceGroundingGuard`): on violation, set `pendingGuidance.evidenceGap` = the specific ungrounded figures + "cite values from tool results". Runs at most once/run (existing `evidenceGroundingDone` latch). Only in block mode.
  - **Terminal** (`verifier.ts`): on violation, severity `reject` → suppress + retry. Reuse the existing kernel grounding-retry counter (the `groundingRetry` state referenced in arbitrator). After `maxRetries` still ungrounded ⇒ **degrade**: emit the answer WITH a `verifierWarning` (severity downgraded to `warn`) — **never hard-fail the run**.

## 6. Edge cases

- Empty/thin corpus (no/again tool data) → skip, pass.
- No numeric claims → pass.
- `storedKey` present but value evicted from scratchpad → fall back `extractedFact` → preview; if all thin → skip (no false-reject).
- Number derived by reasoning (e.g. a computed sum) not in any tool result → may flag under `block`; documented: recommend `warn` for synthesis-heavy tasks, `block` for strict extraction.
- Retry exhausted → warn-surface (no infinite loop, no hard fail).
- Scaffold-leak fires independently of all the above (always-on).

## 7. Testing (gates)

1. **`scaffold-leak.test.ts` (new):** `[STORED:]` / `_tool_result_N` / `compressed preview` in output → `reject`; clean prose → pass. No config needed (always-on).
2. **`evidence-grounding.test.ts` (rework):**
   - **Off-by-default RED→GREEN:** the `$62,578`-answer-vs-compressed-`crypto-price`-obs case produces NO violation when `grounding` absent (the exact false-positive that bit the cross-tier bench).
   - Enabled + figure grounded in **full** tool data → pass (incl. when the figure is past the preview cutoff — the storedKey-corpus fix).
   - Enabled + genuinely fabricated figure → violation.
   - Tolerant match: `$62,578`↔`62578.12` pass; `$62.5k`↔`62500` pass; `$80,000`↔corpus-`62578` violation.
   - storedKey→scratchpad corpus resolution; evicted-key fallback.
3. **block-mode integration:** fabricated figure → 1 retry → (a) corrected → pass, (b) still wrong → warn-surface (status not failed).
4. **warn-mode:** violation → `verifierWarning` present + compose tag fired + output NOT suppressed.
5. **Live re-bench:** the crypto cross-tier task with grounding OFF — confirm `metadata.success` is no longer floored by grounding (isolates whether the prior 0% was grounding or a separate terminal-verify issue; record the finding).
6. **Regression floor:** full reasoning suite green; no other verifier check altered.

## 8. Phasing

| Phase | Scope | Owner | Gate |
|---|---|---|---|
| A | `scaffold-leak.ts` + always-on verifier check + test; remove compression markers from evidence-grounding.ts | kernel-warden | scaffold-leak test green; suite green |
| B | `GroundingConfig` type + `buildKernelInput` cross-cutting thread; rework `evidence-grounding.ts` matcher (full-corpus + tolerant); gate verifier + think-guards on `grounding`; remove prose claim-grounding | kernel-warden | off-by-default RED→GREEN; matcher tests green; suite green |
| C | `.withGrounding()` wither + `agent-config.ts` schema + declarative wiring | main-thread | builder test; config round-trip |
| D | block/warn integration + live re-bench + CHANGELOG (default-behavior change) + docs | main-thread | integration tests; live bench recorded |

## 9. Risks

- **Default-behavior change** (grounding off for everyone) — intended; CHANGELOG + the always-on scaffold-leak retains the only zero-false-positive protection. Low risk (current grounding is net-negative).
- **storedKey corpus resolution** must read the same scratchpad the kernel populates — verify against `act.ts` scratchpad sync; if a key isn't resolvable, fall back, never false-reject.
- **block-mode retry** must reuse the existing grounding-retry latch to avoid re-introducing loops; cap + degrade-to-warn is the hard stop.
- **Scope creep** — no LLM-judge, no prose-claim grounding. If a user needs prose grounding, that's a future opt-in scope, not this spec.
