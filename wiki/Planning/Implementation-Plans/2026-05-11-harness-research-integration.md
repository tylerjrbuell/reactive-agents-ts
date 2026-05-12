# Harness Research Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate verified harness engineering research findings into the reactive-agents-ts codebase: promote North Star to v5.0, update the Compose API spec with self-evolution hooks, make the kernel-level verifier opt-in by default, and update Hot.md with the session findings.

**Architecture:** Four independent workstreams (WS1–WS4) with no shared file conflicts. WS1 (North Star v5.0), WS2 (M3 opt-in code), and WS3 (Compose API spec) execute in parallel. WS4 (Hot.md) executes after WS1 completes. The code change in WS2 threads `enableVerification` from the runtime config layer through `ReasoningService.execute()` → `KernelInput` → `runner.ts`, replacing the unconditional `defaultVerifier` fallback with `noopVerifier` when the flag is absent.

**Tech Stack:** TypeScript, Effect-TS, Bun (test runner), packages/reasoning, packages/runtime

**Spec:** `wiki/Architecture/Design-Specs/2026-05-11-harness-research-integration.md`

---

## WS1 — North Star v4.0 → v5.0

**Files:**
- Modify: `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md`

### Task 1: Update version header

- [ ] **Open the file and find the header block** (first 10 lines). It currently reads `**North Star v4.0**` with a status note.

- [ ] **Replace the version line and add an amendment note**

Find:
```markdown
# Reactive Agents — Design North Star v4.0
```
Replace with:
```markdown
# Reactive Agents — Design North Star v5.0
```

Find the existing status/date block near the top (the block with `**Status:** AUTHORITATIVE...` and `**Date:** 2026-04-26`) and append to it:
```markdown
**v5.0 amendments (2026-05-11):** Pruning Principle added (§9); M14 Self-Evolution added to Phase 1.5 (§2.2, §6); M3 changed to ablation-gated (§2.2, §6); M8 elevated to Tier-1 (§2.2, §6); G-8 gap added (§2.3); Phase B Wave A/B tag catalog expanded to 7 tags (§6). All changes grounded in verified research (arXiv 2603.25723, 2603.28052). See `Architecture/Design-Specs/2026-05-11-harness-research-integration.md`.
```

### Task 2: Update §2.2 mechanism verdicts table

- [ ] **Find the M3 row** in the mechanism verdicts table (§2.2). It currently reads:

```markdown
| M3: Verifier + Retry | 🔄 IMPROVE | Core validated; retry context ineffective on cogito:14b | Tune retry context (target: ≥50% recovery) |
```

Replace with:
```markdown
| M3: Verifier + Retry | 🔄 IMPROVE (ablation-gated) | Research (arXiv:2603.25723) shows LLM-as-judge verifier gates are net-negative in isolation (-0.8pp SWE, -8.4pp OSWorld). Kernel-level defaultVerifier now opt-in via `enableVerification`. | **Step 1:** ablate (disable verifier, run gate corpus, measure delta). **Step 2 (only if net-positive):** tune retry context for cogito:14b. |
```

- [ ] **Find the M8 row**. It currently reads:

```markdown
| M8: Sub-agent Delegation | 🔄 IMPROVE | Test harness ready; real LLM metrics unvalidated | Real LLM execution (target: ≥15% accuracy lift) |
```

Replace with:
```markdown
| M8: Sub-agent Delegation | 🔄 TIER-1 | Research (arXiv:2603.25723) shows 90% of compute flows through delegated child agents in production harnesses — this is the primary pattern, not a side feature. | Real LLM execution on 10 scenarios; compose pipeline integration; target: ≥20% accuracy lift on complex (≥3-step) tasks. |
```

- [ ] **Add M14 row** directly after the M13 row:

```markdown
| M14: Self-Evolution | 🔄 IMPROVE (new) | Not yet implemented. Research (arXiv:2603.25723) shows acceptance-gated attempt narrowing is the most consistently positive module (+4.8pp SWE, +2.7pp OSWorld). | Implement as Compose API hooks (`lifecycle.failure` + `control.strategy-evaluated`) after Phase B Wave A ships. Target: ≥3pp lift on looping gate scenarios; no regression on non-looping scenarios. |
```

- [ ] **Add file-backed state footnote** after the mechanism verdicts table (after the closing `|---|` row), before the next `###` heading:

```markdown
> **File-backed state confirmed:** The per-sender SQLite session history (gateway-chat, shipped May 1) corresponds to the NLAH "file-backed state" module, which was also robustly positive (+1.6pp SWE, +5.5pp OSWorld). This is a research confirmation of an already-correct decision.
```

### Task 3: Add G-8 to §2.3 architectural gaps

- [ ] **Find §2.3** (the architectural gaps table). Add a new row to the table:

```markdown
| **G-8** | Kernel-level `defaultVerifier` ran unconditionally even when `enableVerification: false`. Research shows verifier gates hurt most tasks. Fixed: `noopVerifier` is now the default; `defaultVerifier` only runs when `enableVerification: true` is threaded through to `KernelInput`. | Phase 1.5 (code shipped); Phase B (compose hook exposes control) |
```

### Task 4: Update Phase 1.5 table in §6

- [ ] **Find the Phase 1.5 mechanism table** in §6. Replace the M3 and M8 rows and add M14:

Replace M3 row:
```markdown
| **M3** Verifier Retry | **Step 1 (ablation):** Disable verifier (`enableVerification: false`), run gate corpus (minimum 20 tasks), measure accuracy delta vs. baseline. **Step 2 (conditional):** Only if Step 1 shows net-positive signal — tune retry context (temperature 0.0→0.2, retry prompt variants). If Step 1 shows net-negative, close M3 as opt-in-only. | Step 1: ablation result with delta on gate corpus. Step 2 (conditional): ≥50% recovery on cogito:14b with verified net-positive. | Step 1: 1 day. Step 2: 3–5 days (conditional). |
```

Replace M8 row:
```markdown
| **M8** Sub-agent Delegation | Run 10 delegation scenarios on frontier + qwen3:14b. Wire delegation traces through `control.strategy-evaluated` compose hook (Phase B Wave A prereq). Measure accuracy lift, token ROI, and trace completeness. | ≥20% accuracy lift on complex tasks (≥3-step); delegation events visible in trace via compose hook. | 3–5 days (after Phase B Wave A). |
```

Add M14 row after M10:
```markdown
| **M14** Self-Evolution | Implement `composeNarrowRetry(maxBroadenAfter)` helper using `lifecycle.failure` + `control.strategy-evaluated` compose hooks. Validate on 3 gate scenarios where agents currently loop. | ≥3pp lift on looping gate scenarios vs. baseline; no regression on non-looping scenarios. | 4–6 days (after Phase B Wave A). |
```

Update the Phase 1.5 completion gate — add:
```markdown
- [ ] M14 self-evolution: ≥3pp lift on looping gate scenarios; evidence artifact in `wiki/Research/Harness-Reports/phase-1.5-m14-YYYY-MM-DD.md`
```

### Task 5: Update Phase B Wave A tag count in §6

- [ ] **Find the Wave A row** in the Phase B wave sequence table. It currently says "5 initial tags". Change to:

```markdown
| **Wave A** | `harness-pipeline.ts` registry + resolver; `harness-tag-catalog.generated.ts` (**7 initial tags** — 5 original + `lifecycle.failure` + `control.strategy-evaluated` for M14 self-evolution); `TagMap`, `PayloadFor`, `ContextFor` type system; `.compose()` on builder | Type inference works; pipeline registry resolves tags |
```

- [ ] **Add two new rows to the Wave B chokepoints list** (find the list inside Wave B description):

```markdown
- `lifecycle.failure` — fires from `kernel/capabilities/act/tool-execution.ts` (tool errors) and `kernel/capabilities/verify/verifier.ts` (rejections); payload: `{ reason, errorMessage, attemptNumber, failureStreak, currentStrategy }`
- `control.strategy-evaluated` — fires from `kernel/capabilities/reflect/strategy-evaluator.ts`; payload: `{ currentStrategy, score, failureStreak, recommendedAction, availableStrategies }`
```

### Task 6: Add Pruning Principle to §9

- [ ] **Find §9** ("What Stays vs What Changes"). Add a new subsection at the end:

```markdown
### The Pruning Principle (v5.0)

Harness components encode assumptions about what the model cannot do alone. Those assumptions expire as model capability improves.

**Empirical basis:** Full harness skill set costs ~13.6× the tokens and produces outcomes 0.8pp *worse* than a lighter configuration (NLAH arXiv:2603.25723, Table 1). Adding structure actively degrades outcomes while consuming resources.

**Operational rule:** Before adding any new harness mechanism, identify and document the model-capability assumption it encodes. During each major version review, test whether that assumption still holds on current frontier models. Mechanisms whose assumptions have expired are removal candidates, not improvement candidates.
```

### Task 7: Append amendment log entry

- [ ] **Find the amendment log** (near the end of the file, `## 11. Amendment Log` or similar). Append:

```markdown
| v5.0 | 2026-05-11 | Pruning Principle (§9); M14 Self-Evolution (§2.2 + §6 Phase 1.5); M3 ablation-gated (§2.2 + §6 Phase 1.5); M8 Tier-1 elevation (§2.2 + §6 Phase 1.5); G-8 gap (§2.3); Phase B Wave A/B tag catalog expanded to 7 (§6). Research basis: arXiv 2603.25723, 2603.28052. Design spec: `Architecture/Design-Specs/2026-05-11-harness-research-integration.md`. |
```

### Task 8: Commit WS1

- [ ] **Commit**

```bash
git add wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md
git commit -m "docs(wiki): promote North Star to v5.0 — harness research integration

M3 ablation-gated, M8 Tier-1, M14 self-evolution added, Pruning Principle.
Research basis: arXiv 2603.25723 (Tsinghua NLAH) + 2603.28052 (Stanford Meta-Harness)."
```

---

## WS2 — M3 Opt-In Code Change

**Files:**
- Modify: `packages/reasoning/src/kernel/capabilities/verify/verifier.ts`
- Modify: `packages/reasoning/src/index.ts` (add `noopVerifier` to public exports)
- Modify: `packages/reasoning/src/kernel/state/kernel-state.ts`
- Modify: `packages/reasoning/src/kernel/loop/runner.ts`
- Modify: `packages/reasoning/src/strategies/reactive.ts`
- Modify: `packages/reasoning/src/strategies/direct.ts`
- Modify: `packages/reasoning/src/services/reasoning-service.ts`
- Modify: `packages/runtime/src/engine/phases/agent-loop/reasoning-harness-hooks.ts`
- Create: `packages/runtime/tests/verifier-opt-in-default.test.ts`

**Context:** `runner.ts:568` currently does `const verifier = effectiveInput.verifier ?? defaultVerifier` — this runs the heuristic verifier gate on every agent run regardless of whether `withVerification()` was called on the builder. The `enableVerification` flag already exists at the runtime config layer and is already respected by `engine/phases/verify.ts:90` (the LLM-based verify phase) and `engine/phases/agent-loop/verification-quality-gate.ts:38`. The gap is the kernel-level `defaultVerifier` in runner.ts which has no equivalent gate. This change closes that gap.

### Task 9: Export `noopVerifier` from verifier.ts

- [ ] **Read `packages/reasoning/src/kernel/capabilities/verify/verifier.ts`** around line 135–145 to find the `Verifier` interface and `VerificationResult` shape.

- [ ] **Write a failing test first**

Create `packages/runtime/tests/verifier-opt-in-default.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { noopVerifier } from "@reactive-agents/reasoning";

describe("noopVerifier", () => {
  it("always returns verified: true", () => {
    const result = noopVerifier.verify({
      action: "final-answer",
      content: "some output",
      actionSuccess: true,
      task: "do something",
      priorSteps: [],
      requiredTools: [],
      toolsUsed: [],
      availableUserTools: [],
      terminal: true,
      terminatedBy: "final-answer",
    });
    expect(result.verified).toBe(true);
    expect(result.checks).toEqual([]);
  });

  it("preserves action from context", () => {
    const result = noopVerifier.verify({
      action: "tool-call",
      content: "irrelevant",
      actionSuccess: true,
      task: "do something",
      priorSteps: [],
      requiredTools: [],
      toolsUsed: [],
      availableUserTools: [],
      terminal: false,
      terminatedBy: "in-loop",
    });
    expect(result.action).toBe("tool-call");
  });
});
```

- [ ] **Run the test to confirm it fails**

```bash
cd packages/runtime && bun test tests/verifier-opt-in-default.test.ts
```

Expected: import error (`noopVerifier` not exported from `@reactive-agents/reasoning` yet).

- [ ] **Add `noopVerifier` to `verifier.ts`**

Read the file, find the `Verifier` interface definition (around line 139). Add after the interface closing `}`:

```typescript
/** Pass-through verifier. Used when enableVerification is false (the default). Always passes. */
export const noopVerifier: Verifier = {
  verify: (ctx) => ({
    verified: true,
    checks: [],
    summary: "verification disabled",
    action: ctx.action,
  }),
};
```

- [ ] **Export `noopVerifier` from `packages/reasoning/src/index.ts`**

Find the existing `defaultVerifier` export block (around line 186):
```typescript
defaultVerifier,
```
Add `noopVerifier` to the same export block so it reads:
```typescript
defaultVerifier,
noopVerifier,
```

- [ ] **Run the test to confirm it passes**

```bash
cd packages/runtime && bun test tests/verifier-opt-in-default.test.ts
```

Expected: PASS (2 tests).

### Task 10: Add `enableVerification` to `KernelInput`

- [ ] **Read `packages/reasoning/src/kernel/state/kernel-state.ts`** around line 340–365. Find the `verifier?` and `verifierRetryPolicy?` fields in the `KernelInput` interface.

- [ ] **Add the field** after `verifierRetryPolicy`:

```typescript
  /**
   * When false (default), runner.ts uses noopVerifier — all verifier gates
   * are bypassed. Set to true only when the builder's withVerification() was
   * called. Matches the flag at the runtime config layer.
   */
  readonly enableVerification?: boolean;
```

### Task 11: Update `runner.ts` to gate on `enableVerification`

- [ ] **Find the import line in runner.ts** (around line 60):

```typescript
import { defaultVerifier, defaultVerifierRetryPolicy } from "../../kernel/capabilities/verify/verifier.js";
```

Replace with:

```typescript
import { defaultVerifier, defaultVerifierRetryPolicy, noopVerifier } from "../../kernel/capabilities/verify/verifier.js";
```

- [ ] **Find line 568 in runner.ts**:

```typescript
const verifier = effectiveInput.verifier ?? defaultVerifier;
```

Replace with:

```typescript
const verifier = effectiveInput.enableVerification
  ? (effectiveInput.verifier ?? defaultVerifier)
  : noopVerifier;
```

### Task 12: Thread `enableVerification` through strategies

- [ ] **In `packages/reasoning/src/strategies/reactive.ts`**, find the `kernelInput: KernelInput = {` block (around line 168). Add after the last field (after `calibration: input.calibration,`):

```typescript
      enableVerification: input.enableVerification,
```

- [ ] **In `packages/reasoning/src/strategies/direct.ts`**, find its equivalent `kernelInput: KernelInput = {` block (around line 147). Add the same field after the last existing field:

```typescript
      enableVerification: input.enableVerification,
```

### Task 13: Add `enableVerification` to `ReasoningService.execute()` params

- [ ] **Read `packages/reasoning/src/services/reasoning-service.ts`** around lines 27–115. Find the execute parameter object — it has fields like `taskDescription`, `availableTools`, `calibration`, etc.

- [ ] **Add the field** after the last existing field in the execute params object (find the closing `}>` of the execute type and add before it):

```typescript
      /** When false (default), kernel-level verifier gates are bypassed (noopVerifier). */
      readonly enableVerification?: boolean;
```

### Task 14: Thread through `reasoning-harness-hooks.ts`

- [ ] **Read `packages/runtime/src/engine/phases/agent-loop/reasoning-harness-hooks.ts`** around lines 81–120. Find the `buildExecuteRequest` function, specifically the `request` object literal.

- [ ] **Add after `calibration: resolvedCalibration,`** (the last field before the closing `}`):

```typescript
      enableVerification: config.enableVerification,
```

### Task 15: Write verifier selection unit tests

- [ ] **Add a second describe block** to `packages/runtime/tests/verifier-opt-in-default.test.ts` that directly tests the selection logic from runner.ts:

```typescript
import { describe, it, expect } from "bun:test";
import { defaultVerifier, noopVerifier } from "@reactive-agents/reasoning";

// These tests mirror the exact ternary in runner.ts:568:
//   const verifier = effectiveInput.enableVerification
//     ? (effectiveInput.verifier ?? defaultVerifier)
//     : noopVerifier;
// They verify the selection contract without needing to run the full kernel.

describe("runner.ts verifier selection (mirrors runner.ts:568)", () => {
  function selectVerifier(
    enableVerification: boolean | undefined,
    customVerifier?: typeof defaultVerifier,
  ) {
    return enableVerification
      ? (customVerifier ?? defaultVerifier)
      : noopVerifier;
  }

  it("selects noopVerifier when enableVerification is false", () => {
    expect(selectVerifier(false)).toBe(noopVerifier);
  });

  it("selects noopVerifier when enableVerification is undefined (the default)", () => {
    expect(selectVerifier(undefined)).toBe(noopVerifier);
  });

  it("selects defaultVerifier when enableVerification is true and no custom verifier", () => {
    expect(selectVerifier(true)).toBe(defaultVerifier);
  });

  it("selects custom verifier when enableVerification is true and custom verifier provided", () => {
    const customVerifier = { verify: () => ({ verified: true, checks: [], summary: "custom", action: "pass" }) };
    expect(selectVerifier(true, customVerifier as typeof defaultVerifier)).toBe(customVerifier);
  });

  it("ignores custom verifier when enableVerification is false", () => {
    // Even if a verifier object is passed in KernelInput, it is not used when
    // enableVerification is false. noopVerifier is always selected.
    const customVerifier = { verify: () => ({ verified: false, checks: [], summary: "fail", action: "reject" }) };
    expect(selectVerifier(false, customVerifier as typeof defaultVerifier)).toBe(noopVerifier);
  });
});
```

- [ ] **Run all tests in the file**

```bash
cd packages/runtime && bun test tests/verifier-opt-in-default.test.ts
```

Expected: PASS (7 tests — 2 from Task 9 + 5 from Task 15).

### Task 16: Run the full test suite

- [ ] **Typecheck the affected packages**

```bash
cd packages/reasoning && bun run typecheck
cd packages/runtime && bun run typecheck
```

Expected: clean (0 errors). If errors appear, they will be in the `kernelInput` construction sites or the `ReasoningService.execute()` callers — fix any `Type '... | undefined' is not assignable to type 'boolean'` errors by ensuring the field is `?: boolean` (optional) everywhere.

- [ ] **Run the reasoning package tests**

```bash
cd packages/reasoning && bun test
```

Expected: all existing tests pass.

- [ ] **Run the runtime package tests**

```bash
cd packages/runtime && bun test
```

Expected: all existing tests pass plus the 2 new `noopVerifier` unit tests.

### Task 17: Commit WS2

- [ ] **Commit**

```bash
git add \
  packages/reasoning/src/kernel/capabilities/verify/verifier.ts \
  packages/reasoning/src/kernel/state/kernel-state.ts \
  packages/reasoning/src/kernel/loop/runner.ts \
  packages/reasoning/src/strategies/reactive.ts \
  packages/reasoning/src/strategies/direct.ts \
  packages/reasoning/src/services/reasoning-service.ts \
  packages/runtime/src/engine/phases/agent-loop/reasoning-harness-hooks.ts \
  packages/runtime/tests/verifier-opt-in-default.test.ts
git commit -m "feat(reasoning): make kernel-level verifier opt-in by default

defaultVerifier now only runs when enableVerification: true is threaded
through ReasoningService.execute() -> KernelInput -> runner.ts.
noopVerifier (always-pass) is the new default. Research basis: NLAH
arXiv:2603.25723 shows verifier gates are net-negative in isolation."
```

---

## WS3 — Compose API Spec: Self-Evolution Hooks

**Files:**
- Modify: `wiki/Architecture/Design-Specs/2026-05-06-compose-harness-api.md`

### Task 18: Add two new tags to the tag catalog

- [ ] **Read the file** to find the existing tag catalog table. It will have columns like `| Tag | Namespace | Fires from | Payload type |` or similar. Find where existing tags are listed (look for `prompt.system`, `nudge.loop-detected`, etc.).

- [ ] **Add two new rows** to the tag catalog table:

```markdown
| `lifecycle.failure` | `lifecycle.*` | `kernel/capabilities/act/tool-execution.ts` (tool errors), `kernel/capabilities/reason/think.ts` (LLM refusals), `kernel/capabilities/verify/verifier.ts` (rejections) | `LifecycleFailurePayload` |
| `control.strategy-evaluated` | `control.*` | `kernel/capabilities/reflect/strategy-evaluator.ts` | `ControlStrategyEvaluatedPayload` |
```

### Task 19: Add self-evolution hooks section

- [ ] **Find a logical insertion point** after the existing tag catalog section (before the Wave implementation notes or at the end of the design sections).

- [ ] **Add the following section**:

````markdown
---

## Self-Evolution Hooks (v5.0 addition)

Two new tags added to support M14 (Self-Evolution). Research basis: NLAH arXiv:2603.25723 — acceptance-gated attempt narrowing is the most consistently positive harness module (+4.8pp SWE-bench Verified, +2.7pp OSWorld).

### `lifecycle.failure`

Fires after: tool execution error, LLM refusal, or verifier rejection.

```typescript
type LifecycleFailurePayload = {
  reason: 'tool-error' | 'llm-refusal' | 'verifier-rejection';
  errorMessage: string;
  attemptNumber: number;    // total attempts on current task
  failureStreak: number;    // consecutive failures without a successful step
  currentStrategy: string;  // name of active reasoning strategy
};

// Handler return values:
// undefined                    → continue with default behavior
// { narrowTo: string }         → switch to named sub-strategy before next attempt
// { abandon: true }            → escalate to parent / exit-failure immediately
```

### `control.strategy-evaluated`

Fires after `strategy-evaluator.ts` completes a trajectory score.

```typescript
type ControlStrategyEvaluatedPayload = {
  currentStrategy: string;
  score: number;                  // 0–1 confidence in current trajectory
  failureStreak: number;
  recommendedAction: 'continue' | 'switch' | 'escalate';
  availableStrategies: string[];
};

// Handler return values:
// undefined                                     → accept recommendedAction
// { override: 'continue' | 'switch' | 'escalate' } → override recommendation
// { switchTo: string }                          → switch to specific named strategy
```

### Built-in helper: `composeNarrowRetry`

```typescript
import { composeNarrowRetry } from '@reactive-agents/runtime/compose';

/**
 * Acceptance-gated attempt loop.
 * Stays on current (narrow) strategy until maxBroadenAfter consecutive failures,
 * then allows strategy-evaluator to broaden. Implements NLAH self-evolution pattern.
 */
export function composeNarrowRetry(maxBroadenAfter: number = 3) {
  return (harness: Harness) => {
    harness.on('control.strategy-evaluated', (payload) => {
      if (payload.failureStreak < maxBroadenAfter) {
        return { override: 'continue' }; // stay narrow
      }
      return undefined; // allow broadening after threshold
    });
  };
}

// Usage:
const agent = buildAgent()
  .withReasoning(...)
  .compose(composeNarrowRetry(3))
  .build();
```
````

### Task 20: Update Wave A tag count

- [ ] **Find the Wave A description** in the wave sequence table or section. It currently says "5 initial tags". Change every occurrence to "7 initial tags (includes `lifecycle.failure` + `control.strategy-evaluated` for M14 self-evolution)".

### Task 21: Commit WS3

- [ ] **Commit**

```bash
git add wiki/Architecture/Design-Specs/2026-05-06-compose-harness-api.md
git commit -m "docs(wiki): add self-evolution compose hooks to Compose API spec

lifecycle.failure + control.strategy-evaluated tags added to Wave A scope.
composeNarrowRetry helper designed. Research basis: NLAH arXiv:2603.25723."
```

---

## WS4 — Hot.md Update

**Depends on:** WS1 complete (North Star v5.0 must be promoted before Hot.md references it)

**Files:**
- Modify: `wiki/Hot.md`

### Task 22: Replace Latest Session block

- [ ] **Find `## Latest Session (2026-05-10)`** in `wiki/Hot.md`. Replace the entire block (from that heading down to the `---` separator before `## What's Next`) with:

```markdown
## Latest Session (2026-05-11)

### Harness Research Integration — Three Papers Verified ✅

Four March 2026 papers reviewed; all quantitative claims verified against primary sources before any changes were made.

| Finding | Source | Impact |
|---|---|---|
| Verifier gates net-negative: -0.8pp SWE, -8.4pp OSWorld | Tsinghua NLAH (arXiv:2603.25723) | M3 ablation-gated; kernel-level `defaultVerifier` now opt-in (G-8 closed) |
| Self-evolution most consistent positive module: +4.8pp SWE, +2.7pp OSWorld | Same | M14 added to Phase 1.5 as Compose API hook |
| File-backed state also positive: +1.6pp SWE, +5.5pp OSWorld | Same | Confirms SQLite session history (gateway-chat) was correct |
| Adding full harness costs 13.6× tokens and is 0.8pp *worse* | Same | Pruning Principle added to North Star §9 |
| Raw traces essential: 50% → 34.6% accuracy without them | Stanford Meta-Harness (arXiv:2603.28052) | `@reactive-agents/trace` + Snapshot/Replay are critical path |
| Harness transfers across 5 models (+4.7pp avg) | Same | Strengthens M7 calibration consumer priority |

### North Star v5.0 Promoted ✅

Canonical doc: `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md`
Design spec: `wiki/Architecture/Design-Specs/2026-05-11-harness-research-integration.md`

### v0.10.6 Shipped ✅

All packages on npm. All P1 issues resolved.
```

### Task 23: Update What's Next

- [ ] **Find `## What's Next`** and prepend a new section before the existing "Immediate: Phase B" block:

```markdown
### Pre-Phase-B Gate: M3 Ablation (1 day)

Run the M3 ablation before starting Compose API Wave A. Disable `enableVerification` (now the default), run gate corpus (20+ tasks), measure accuracy delta. Result determines whether G-8 is fully closed in Phase 1.5 or requires Phase B compose control.

```

### Task 24: Update the footer metadata

- [ ] **Find the bottom of Hot.md** — the `**Last Updated:**`, `**Current Phase:**`, and `**Next Review:**` lines. Update:

```markdown
**Last Updated:** 2026-05-11
**Current Phase:** B (Compose API) — Wave A next; M3 ablation gate first
**Next Review:** After M3 ablation result + Compose API Wave A lands
```

### Task 25: Commit WS4

- [ ] **Commit**

```bash
git add wiki/Hot.md
git commit -m "docs(wiki): update Hot.md — harness research integration session (2026-05-11)"
```

---

## Final: Full Test Run

After all four workstreams commit:

- [ ] **Run the full test suite from root**

```bash
bun test
```

Expected: all tests pass (no regressions). Note the pre-existing 18 TypeScript errors in `packages/runtime` are tracked separately and are not introduced by this change.

- [ ] **Typecheck all packages**

```bash
bun run typecheck
```

Expected: same error count as baseline (the 18 pre-existing errors). No new errors.
