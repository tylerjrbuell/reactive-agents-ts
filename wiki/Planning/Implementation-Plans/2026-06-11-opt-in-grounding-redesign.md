# Opt-In Evidence-Grounding Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make numeric evidence-grounding opt-in (off by default) and accurate when on (full-data corpus + tolerant numeric matching), and split the zero-false-positive scaffold-leak detector into a standalone always-on correctness guard.

**Architecture:** Two independent concerns in `kernel/capabilities/verify/`. (1) A new `scaffold-leak.ts` module + always-on verifier check (`reject`) catches the model emitting framework internals (`[STORED:]`, `_tool_result_N`) as its answer. (2) `evidence-grounding.ts` is reworked: the prose claim-grounding path is removed, the numeric matcher is rebuilt (tolerant value-match against full tool data resolved via `storedKey`→scratchpad), and the whole numeric path is gated behind a new opt-in `GroundingConfig` threaded through `KernelInput` via `buildKernelInput`. Grounding never hard-fails a run — `block` mode degrades to `warn` after one retry.

**Tech Stack:** TypeScript, Effect-TS, Bun test runner. Package: `@reactive-agents/reasoning` (kernel) + `@reactive-agents/runtime` (builder/config).

**Source spec:** `wiki/Architecture/Design-Specs/2026-06-11-opt-in-grounding-redesign.md`.

**Ownership (warden pilot active until 2026-06-15):** Phases A, B touch `packages/reasoning/src/kernel/**` → **kernel-warden**. Phases C, D touch `packages/runtime/**` + docs → **main-thread**.

**Key code facts (verified 2026-06-11, so the engineer doesn't re-derive):**
- `verifier.ts` terminal block (`ctx.terminal && ctx.actionSuccess && hasContent`, ~:302-564) holds Check 5 `evidence-grounded` (`:525-546`, `validateOutputGroundedInEvidence`, severity `warn`) + Check 6 `synthesis-grounded` (`:548-562`, `validateGeneralizedGrounding`, severity `warn`). Check 6 today only catches compression markers (claim-grounding is opt-in-off).
- **`verified` is `true` only when overall severity = `pass`.** A `warn`-only failure sets `verified=false`, and `runner.ts` acts on `!verified`. So today's "advisory" grounding warn DOES cascade — this is the impediment. (severity rollup `verifier.ts:578-595`.)
- `validateOutputGroundedInEvidence` / `validateGeneralizedGrounding` / `buildEvidenceCorpusFromSteps` / `COMPRESSION_MARKER_PATTERNS` all live in `evidence-grounding.ts`.
- `guardEvidenceGrounding(state, thought, newSteps, newTokens, newCost)` — `think-guards.ts:417`; the mid-loop nudge; called once at `think.ts:1094`.
- Grounding only runs at **terminal** verification (`ctx.terminal`); per-tool-obs verify sites (`act.ts:609`, `tool-observe.ts:327`) pass `terminal=false`, so they never reach the grounding checks — **no change needed there.**
- Terminal `VerificationContext` is built in `runner.ts` feeding `verifyAndEmit({ verifier, context, taskId, iteration })` (`verifier.ts:658`).
- `KernelInput` cross-cutting fields are Pick-partitioned in `build-kernel-input.ts` (`CrossCuttingInput`, ~:33-56).

---

## File Structure

| File | Responsibility | Phase |
|---|---|---|
| `packages/reasoning/src/kernel/capabilities/verify/scaffold-leak.ts` | **NEW.** `SCAFFOLD_LEAK_PATTERNS` + `detectScaffoldLeak(output) → { leaked, reason }`. Pure. | A |
| `packages/reasoning/tests/kernel/verify/scaffold-leak.test.ts` | **NEW.** Always-on leak detection. | A |
| `packages/reasoning/src/kernel/capabilities/verify/verifier.ts` | MODIFY. Add always-on scaffold-leak check (`reject`); gate + rebuild grounding check; remove Check 6; extend `VerificationContext`. | A,B |
| `packages/reasoning/src/kernel/capabilities/verify/evidence-grounding.ts` | MODIFY. Remove `validateGeneralizedGrounding` + `COMPRESSION_MARKER_PATTERNS`; replace numeric matcher with tolerant `validateNumericGrounding`; `buildEvidenceCorpusFromSteps` gains scratchpad. | A,B |
| `packages/reasoning/tests/kernel/verify/evidence-grounding.test.ts` | MODIFY/NEW. Off-by-default RED→GREEN; tolerant match; full-corpus. | B |
| `packages/reasoning/src/kernel/state/kernel-state.ts` | MODIFY. Add `GroundingConfig` type + `KernelInput.grounding?`. | B |
| `packages/reasoning/src/kernel/state/build-kernel-input.ts` | MODIFY. Add `grounding` to `CrossCuttingInput`. | B |
| `packages/reasoning/src/kernel/capabilities/reason/think-guards.ts` | MODIFY. Gate `guardEvidenceGrounding` on grounding config (param) + block mode. | B |
| `packages/reasoning/src/kernel/capabilities/reason/think.ts:1094` | MODIFY. Pass `context.input.grounding` to the guard. | B |
| `packages/reasoning/src/kernel/loop/runner.ts` | MODIFY. Thread `groundingConfig` + `scratchpad` into terminal `VerificationContext`; block-mode retry/degrade. | B,D |
| `packages/runtime/src/builder.ts` | MODIFY. `.withGrounding(opts)` wither → `KernelInput.grounding`. | C |
| `packages/runtime/src/builder/types.ts` | MODIFY. `GroundingOptions` type. | C |
| `packages/runtime/src/agent-config.ts` | MODIFY. `GroundingConfigSchema` + `AgentConfigSchema.grounding`. | C |
| `CHANGELOG.md` | MODIFY. Default-behavior change note. | D |

---

## Task A1: Scaffold-leak module (always-on)

**Files:**
- Create: `packages/reasoning/src/kernel/capabilities/verify/scaffold-leak.ts`
- Test: `packages/reasoning/tests/kernel/verify/scaffold-leak.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { detectScaffoldLeak } from "../../../src/kernel/capabilities/verify/scaffold-leak.js";

describe("detectScaffoldLeak", () => {
  it("flags [STORED:] scaffolding echoed as the answer", () => {
    const r = detectScaffoldLeak("[STORED: _tool_result_1] the data is above");
    expect(r.leaked).toBe(true);
    expect(r.reason).toContain("scaffolding");
  });
  it("flags _tool_result_N references", () => {
    expect(detectScaffoldLeak("See _tool_result_3 for details").leaked).toBe(true);
  });
  it("flags compressed-preview marker", () => {
    expect(detectScaffoldLeak("[crypto-price result — compressed preview]\n...").leaked).toBe(true);
  });
  it("passes clean prose", () => {
    expect(detectScaffoldLeak("Bitcoin is currently $62,578 USD.").leaked).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/reasoning && bun test tests/kernel/verify/scaffold-leak.test.ts --timeout 15000`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
/**
 * scaffold-leak.ts — Always-on correctness guard. Detects when the model
 * emitted framework-internal scaffolding ([STORED:], _tool_result_N,
 * "compressed preview", schema dumps) AS its final answer instead of
 * synthesizing real content. This is always wrong regardless of grounding,
 * and the patterns have ~zero false-positive rate. Extracted from the former
 * evidence-grounding `COMPRESSION_MARKER_PATTERNS`.
 *
 * Pure — no Effect, no state.
 */

const SCAFFOLD_LEAK_PATTERNS: readonly RegExp[] = [
  /\[recall result\b/i,
  /\bcompressed preview\b/i,
  /^Type:\s*(Array|Object)\(/m,
  /^Schema:\s/m,
  /\b_tool_result_\d+\b/i,
  /— full text is stored\b/i,
  /\[STORED:\s*_tool_result_/i,
];

export interface ScaffoldLeakResult {
  readonly leaked: boolean;
  readonly reason: string;
}

/** Returns leaked=true when the output echoes framework internal scaffolding. */
export function detectScaffoldLeak(output: string): ScaffoldLeakResult {
  const leaked = SCAFFOLD_LEAK_PATTERNS.some((re) => re.test(output));
  return {
    leaked,
    reason: leaked
      ? "output contains framework scaffolding markers (e.g., [STORED:], _tool_result_N, compressed preview) — the model echoed internal scaffolding instead of synthesizing an answer"
      : "no scaffolding markers",
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/reasoning && bun test tests/kernel/verify/scaffold-leak.test.ts --timeout 15000`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/kernel/capabilities/verify/scaffold-leak.ts packages/reasoning/tests/kernel/verify/scaffold-leak.test.ts
git commit -m "feat(reasoning): standalone always-on scaffold-leak detector"
```

---

## Task A2: Wire scaffold-leak as an always-on verifier check; remove compression markers from evidence-grounding

**Files:**
- Modify: `packages/reasoning/src/kernel/capabilities/verify/verifier.ts` (terminal block + imports)
- Modify: `packages/reasoning/src/kernel/capabilities/verify/evidence-grounding.ts` (delete markers + claim-grounding)

- [ ] **Step 1: Add the scaffold-leak check to the terminal block**

In `verifier.ts`, add the import near the other verify imports (`:35`):
```ts
import { detectScaffoldLeak } from "./scaffold-leak.js";
```
Inside the terminal block (`if (ctx.terminal && ctx.actionSuccess && hasContent) {`), BEFORE the existing Check 5 (`:525`), add:
```ts
      // Check 4b: scaffold-leak (ALWAYS-ON). Output echoing framework internals
      // ([STORED:], _tool_result_N, compressed preview) is never a valid answer.
      // Severity: reject — always wrong, ~zero false-positive.
      const scaffoldLeak = detectScaffoldLeak(ctx.content);
      checks.push({
        name: "scaffold-leak",
        passed: !scaffoldLeak.leaked,
        severity: scaffoldLeak.leaked ? "reject" : "pass",
        reason: scaffoldLeak.leaked ? scaffoldLeak.reason : undefined,
      });
```

- [ ] **Step 2: Remove Check 6 (synthesis-grounded) — its only live behavior (compression markers) is now Check 4b**

Delete the Check 6 block in `verifier.ts` (`:548-562`, the `validateGeneralizedGrounding` call + the `synthesis-grounded` push). Remove `validateGeneralizedGrounding` from the import at `:37`.

- [ ] **Step 3: Delete the dead paths from evidence-grounding.ts**

In `evidence-grounding.ts`, delete: `COMPRESSION_MARKER_PATTERNS` (`:134-142`), `normalizeForClaimMatch` (`:125-127`), `extractClaimTokens` (`:151-169`), `GeneralizedGroundingResult` (`:171-178`), and `validateGeneralizedGrounding` (`:189-290`). Keep `validateOutputGroundedInEvidence`, `validateExpectedEntitiesInOutput`, `buildEvidenceCorpusFromSteps`, and their helpers (reworked in Phase B).

- [ ] **Step 4: Verify build + full suite**

Run: `bunx turbo run build --filter=@reactive-agents/reasoning`
Run: `cd packages/reasoning && bun test --timeout 60000`
Expected: build green. Suite: any test asserting the old `synthesis-grounded` check name must be updated to `scaffold-leak` (grep `synthesis-grounded` in tests; rename assertions). The `evidence-grounded` (Check 5) still runs always-on at this point (gated in Phase B) — its tests still pass. Investigate any other failure.

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/kernel/capabilities/verify/verifier.ts packages/reasoning/src/kernel/capabilities/verify/evidence-grounding.ts packages/reasoning/tests
git commit -m "refactor(reasoning): always-on scaffold-leak check; remove dead claim-grounding path"
```

> **End of Phase A (kernel-warden).** Gate: scaffold-leak test green; build green; full suite green. UpwardReport.

---

## Task B1: GroundingConfig type + KernelInput thread

**Files:**
- Modify: `packages/reasoning/src/kernel/state/kernel-state.ts`
- Modify: `packages/reasoning/src/kernel/state/build-kernel-input.ts`

- [ ] **Step 1: Add the type + KernelInput field**

In `kernel-state.ts`, near the other config types, add:
```ts
/** Opt-in numeric evidence-grounding. Presence on KernelInput = enabled. */
export interface GroundingConfig {
  /** block: suppress + corrective retry → degrade to warn. warn: advisory only. */
  readonly mode: "block" | "warn";
  /** Numeric match tolerance as a fraction (rounding). Default 0.01 (1%). */
  readonly tolerance?: number;
  /** block mode: corrective retries before degrading to warn. Default 1. */
  readonly maxRetries?: number;
}
```
Add to the `KernelInput` interface (beside `auditRationale?`/`harnessPipeline?`):
```ts
  /** Opt-in evidence-grounding config. Absent ⇒ grounding off (default). */
  readonly grounding?: GroundingConfig;
```

- [ ] **Step 2: Add `grounding` to the cross-cutting partition**

In `build-kernel-input.ts`, add `| "grounding"` to the `CrossCuttingInput` Pick (after `| "budgetLimits"`).

- [ ] **Step 3: Verify build**

Run: `bunx turbo run build --filter=@reactive-agents/reasoning`
Expected: green (additive optional field). `buildKernelInput` now forwards `grounding` to every pass automatically.

- [ ] **Step 4: Commit**

```bash
git add packages/reasoning/src/kernel/state/kernel-state.ts packages/reasoning/src/kernel/state/build-kernel-input.ts
git commit -m "feat(reasoning): add opt-in GroundingConfig cross-cutting kernel field"
```

---

## Task B2: Rework the numeric matcher (tolerant value-match + full-data corpus)

**Files:**
- Modify: `packages/reasoning/src/kernel/capabilities/verify/evidence-grounding.ts`
- Test: `packages/reasoning/tests/kernel/verify/evidence-grounding.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "bun:test";
import {
  validateNumericGrounding,
  buildEvidenceCorpusFromSteps,
} from "../../../src/kernel/capabilities/verify/evidence-grounding.js";
import type { ReasoningStep } from "../../../src/types/index.js";

describe("validateNumericGrounding (tolerant value-match)", () => {
  it("grounds $62,578 against corpus 62578.12 (rounding tolerance)", () => {
    const r = validateNumericGrounding("BTC is $62,578 USD.", "price: 62578.12 usd", 0.01);
    expect(r.ok).toBe(true);
  });
  it("grounds $62.5k against corpus 62500 (magnitude suffix)", () => {
    expect(validateNumericGrounding("about $62.5k", "62500", 0.01).ok).toBe(true);
  });
  it("flags a fabricated figure absent from corpus", () => {
    const r = validateNumericGrounding("BTC is $80,000", "price: 62578", 0.01);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations[0]).toContain("80,000");
  });
  it("passes when corpus is thin", () => {
    expect(validateNumericGrounding("$62,578", "x", 0.01).ok).toBe(true);
  });
  it("passes when output has no numeric claims", () => {
    expect(validateNumericGrounding("Bitcoin went up.", "price 62578 usd", 0.01).ok).toBe(true);
  });
});

describe("buildEvidenceCorpusFromSteps resolves storedKey to full data", () => {
  it("uses the scratchpad full value over the compressed step content", () => {
    const steps: ReasoningStep[] = [{
      id: "s1" as never, type: "observation", content: "[preview] item1 only", timestamp: new Date(),
      metadata: { storedKey: "_tool_result_1", observationResult: { toolName: "web-search" } as never },
    }];
    const scratch = new Map([["_tool_result_1", "item1 $10  item2 $9,999"]]);
    const corpus = buildEvidenceCorpusFromSteps(steps, scratch);
    expect(corpus).toContain("9,999"); // figure past the preview cutoff is present
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/reasoning && bun test tests/kernel/verify/evidence-grounding.test.ts --timeout 15000`
Expected: FAIL — `validateNumericGrounding` not exported; `buildEvidenceCorpusFromSteps` arity.

- [ ] **Step 3: Implement the tolerant matcher + full-corpus resolution**

In `evidence-grounding.ts`, replace `validateOutputGroundedInEvidence` with `validateNumericGrounding` and extend the corpus builder:

```ts
/** Parse a numeric token (handles $, commas, k/M/B suffixes) → value or null. */
function parseNumericValue(token: string): number | null {
  const cleaned = token.replace(/[$,~≈\\\s]/gi, "").replace(/approx\.?/gi, "").toLowerCase();
  const m = cleaned.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!m) {
    const plain = cleaned.match(/\d+(?:\.\d+)?/);
    return plain ? Number(plain[0]) : null;
  }
  const base = Number(m[1]);
  const mult = m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : m[2] === "b" ? 1e9 : 1;
  return Number.isFinite(base) ? base * mult : null;
}

/** Extract candidate numeric values from text (dollar amounts + bare ≥3-digit numbers). */
function extractNumericValues(text: string): number[] {
  const values: number[] = [];
  for (const m of text.matchAll(/(?:~|≈|approx\.?\s*)?(?:\\)?\$\s?[\d,]+(?:\.\d+)?(?:\s?[kmbKMB])?/g)) {
    const v = parseNumericValue(m[0]);
    if (v !== null) values.push(v);
  }
  for (const m of text.matchAll(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d{3,}(?:\.\d+)?\b/g)) {
    const v = parseNumericValue(m[0]);
    if (v !== null) values.push(v);
  }
  return values;
}

/**
 * Numeric grounding (opt-in). A figure in `output` is grounded iff some figure
 * in `evidence` is within `tolerance` (fractional). Tolerant value-match — NOT
 * substring — so $62,578 grounds against 62578.12 and $62.5k against 62500.
 * Skips when corpus is thin or output has no numeric claims (never false-reject).
 */
export function validateNumericGrounding(
  output: string,
  evidence: string,
  tolerance: number,
): { readonly ok: true } | { readonly ok: false; readonly violations: readonly string[] } {
  if (evidence.replace(/\s/g, "").length < 20) return { ok: true };
  const corpusValues = extractNumericValues(evidence);
  if (corpusValues.length === 0) return { ok: true };

  // Re-extract output dollar tokens for human-readable violation messages.
  const outDollarTokens = [...output.matchAll(/(?:~|≈|approx\.?\s*)?(?:\\)?\$\s?[\d,]+(?:\.\d+)?(?:\s?[kmbKMB])?/g)].map((m) => m[0]);
  const violations: string[] = [];
  for (const token of outDollarTokens) {
    const c = parseNumericValue(token);
    if (c === null) continue;
    const grounded = corpusValues.some((e) => Math.abs(c - e) <= tolerance * Math.max(Math.abs(c), Math.abs(e)));
    if (!grounded) violations.push(`unverified figure: ${token}`);
  }
  if (violations.length === 0) return { ok: true };
  return { ok: false, violations };
}
```

Extend the corpus builder to resolve `storedKey` → full scratchpad value:
```ts
export function buildEvidenceCorpusFromSteps(
  steps: readonly ReasoningStep[],
  scratchpad?: ReadonlyMap<string, string>,
): string {
  const chunks: string[] = [];
  for (const s of steps) {
    if (s.type !== "observation") continue;
    const tr = s.metadata?.observationResult as { toolName?: string } | undefined;
    const tn = tr?.toolName;
    if (tn === "system" || tn === "final-answer") continue;
    // Prefer the FULL stored value (preview is lossy — past-cutoff figures read
    // as ungrounded against the compressed step content).
    const storedKey = s.metadata?.storedKey as string | undefined;
    const full = storedKey ? scratchpad?.get(storedKey) : undefined;
    const fact = s.metadata?.extractedFact as string | undefined;
    const body = full ?? (typeof s.content === "string" ? s.content : "");
    if (body.trim().length > 0) chunks.push(body);
    if (fact && fact.trim().length > 0) chunks.push(fact);
  }
  return chunks.join("\n\n");
}
```

Delete the old `validateOutputGroundedInEvidence`, `extractDollarAmounts`, `normalizeForDigitMatch`, `primaryNumericKey`, `significantDigitCount` (superseded).

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/reasoning && bun test tests/kernel/verify/evidence-grounding.test.ts --timeout 15000`
Expected: PASS (all tests including the storedKey-corpus resolution).

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/kernel/capabilities/verify/evidence-grounding.ts packages/reasoning/tests/kernel/verify/evidence-grounding.test.ts
git commit -m "feat(reasoning): tolerant numeric grounding matcher + full-data corpus via storedKey"
```

---

## Task B3: Gate the verifier grounding check on GroundingConfig

**Files:**
- Modify: `packages/reasoning/src/kernel/capabilities/verify/verifier.ts`

- [ ] **Step 1: Extend VerificationContext**

Add to the `VerificationContext` interface (after `terminatedBy?`):
```ts
  /** Opt-in grounding config. Absent ⇒ numeric grounding does NOT run. */
  readonly grounding?: import("../../state/kernel-state.js").GroundingConfig;
  /** Scratchpad for resolving storedKey→full tool data in the grounding corpus. */
  readonly scratchpad?: ReadonlyMap<string, string>;
```

- [ ] **Step 2: Replace Check 5 with the gated, reworked grounding check**

Replace the Check 5 block (`:525-546`, `evidence-grounded`) with:
```ts
      // Check 5: numeric evidence-grounding (OPT-IN). Runs ONLY when the user
      // enabled grounding via .withGrounding(). Severity follows mode:
      // block → reject (suppress + retry, degrades to warn — see runner);
      // warn  → warn (advisory). Off by default = no false-positive impediment.
      if (ctx.grounding) {
        const corpus = buildEvidenceCorpusFromSteps(ctx.priorSteps, ctx.scratchpad);
        if (corpus.length > 0) {
          const tolerance = ctx.grounding.tolerance ?? 0.01;
          const grounding = validateNumericGrounding(ctx.content, corpus, tolerance);
          const sev = ctx.grounding.mode === "block" ? "reject" : "warn";
          checks.push({
            name: "evidence-grounded",
            passed: grounding.ok,
            severity: grounding.ok ? "pass" : sev,
            reason: grounding.ok ? undefined : grounding.violations.join(", "),
          });
        }
      }
```
Update the `evidence-grounding.js` import at `:35-38` to import `validateNumericGrounding` (not `validateOutputGroundedInEvidence`).

- [ ] **Step 3: Run build + suite**

Run: `bunx turbo run build --filter=@reactive-agents/reasoning`
Run: `cd packages/reasoning && bun test --timeout 60000`
Expected: build green. **Behavior change:** terminal grounding no longer runs unless `ctx.grounding` set. Any existing test that fed a grounding-violation scenario and asserted `evidence-grounded` failure WITHOUT setting `grounding` must now either (a) pass `grounding: { mode: "warn" }` in its context, or (b) assert the check is absent. Update those tests to match the opt-in contract. Document each change in the commit.

- [ ] **Step 4: Commit**

```bash
git add packages/reasoning/src/kernel/capabilities/verify/verifier.ts packages/reasoning/tests
git commit -m "feat(reasoning): gate terminal numeric grounding behind opt-in GroundingConfig"
```

---

## Task B4: Gate the mid-loop think-guard + thread grounding into terminal verify context

**Files:**
- Modify: `packages/reasoning/src/kernel/capabilities/reason/think-guards.ts`
- Modify: `packages/reasoning/src/kernel/capabilities/reason/think.ts:1094`
- Modify: `packages/reasoning/src/kernel/loop/runner.ts`

- [ ] **Step 1: Gate guardEvidenceGrounding (block mode only)**

Change the signature + body in `think-guards.ts`:
```ts
export function guardEvidenceGrounding(
  state: KernelState,
  thought: string,
  newSteps: readonly ReasoningStep[],
  newTokens: number,
  newCost: number,
  grounding: import("../../state/kernel-state.js").GroundingConfig | undefined,
): KernelState | undefined {
  // Opt-in: the mid-loop "fix before finishing" nudge runs ONLY in block mode.
  // warn mode is advisory (must not interrupt); off = never runs.
  if (!grounding || grounding.mode !== "block") return undefined;
  if (state.iteration <= 0) return undefined;
  if (state.meta.evidenceGroundingDone) return undefined;

  const extractedFacts = newSteps
    .filter((s) => s.type === "observation")
    .map((s) => (s.metadata?.extractedFact as string | undefined) ?? "")
    .filter(Boolean)
    .join("\n");
  const rawObservations = buildEvidenceCorpusFromSteps(newSteps, state.scratchpad);
  const evidenceCorpus = extractedFacts.length > 0
    ? `${rawObservations}\n\n${extractedFacts}`
    : rawObservations;

  const tolerance = grounding.tolerance ?? 0.01;
  const check = validateNumericGrounding(thought, evidenceCorpus, tolerance);
  if (check.ok) return undefined;

  const violationsMsg =
    `Output contains figures not found in tool observations:\n` +
    check.violations.map((v) => `• ${v}`).join("\n") +
    `\nRevise your answer to use only figures from the tool results.`;

  const gapStep = makeStep("observation", violationsMsg, {
    observationResult: makeObservationResult("system", false, violationsMsg),
  });

  return transitionState(state, {
    steps: [...newSteps, gapStep],
    pendingGuidance: { evidenceGap: violationsMsg },
    tokens: newTokens,
    cost: newCost,
    iteration: state.iteration + 1,
    meta: { ...state.meta, evidenceGroundingDone: true },
  });
}
```
Update the import in `think-guards.ts` from `validateOutputGroundedInEvidence` → `validateNumericGrounding`.

- [ ] **Step 2: Pass the config at the call site**

In `think.ts:1094`, change:
```ts
          guardEvidenceGrounding(state, resolverResult.content, newSteps, newTokens, newCost);
```
to:
```ts
          guardEvidenceGrounding(state, resolverResult.content, newSteps, newTokens, newCost, context.input.grounding);
```
(Confirm the local is `context`; if the KernelInput is reachable under another name in that scope, use it. Grep `context.input` nearby to confirm.)

- [ ] **Step 3: Thread grounding + scratchpad into the terminal VerificationContext**

In `runner.ts`, locate the terminal `VerificationContext` built for the `verifyAndEmit(...)` call (the one with `terminal: true`). Add to that context object literal:
```ts
        grounding: input.grounding,
        scratchpad: state.scratchpad,
```
(Use the in-scope names for `input`/`state` at that site.)

- [ ] **Step 4: Run build + suite**

Run: `bunx turbo run build --filter=@reactive-agents/reasoning`
Run: `cd packages/reasoning && bun test --timeout 60000`
Expected: green. The mid-loop guard now no-ops unless block grounding is on.

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/kernel/capabilities/reason/think-guards.ts packages/reasoning/src/kernel/capabilities/reason/think.ts packages/reasoning/src/kernel/loop/runner.ts
git commit -m "feat(reasoning): gate mid-loop grounding nudge + thread config into terminal verify"
```

> **End of Phase B (kernel-warden).** Gate: off-by-default — a terminal verify on the `$62,578`-vs-compressed-obs scenario WITHOUT `grounding` yields no `evidence-grounded` violation (RED→GREEN of the original bug); enabled paths tested; full suite green. UpwardReport.

---

## Task C1: Builder `.withGrounding()` + declarative schema

**Files:**
- Modify: `packages/runtime/src/builder/types.ts`
- Modify: `packages/runtime/src/builder.ts`
- Modify: `packages/runtime/src/agent-config.ts`
- Test: `packages/runtime/tests/builder/grounding.test.ts` (new)

- [ ] **Step 1: Write the failing builder test**

```ts
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../../src/index.js";

describe(".withGrounding", () => {
  it("threads grounding config to the kernel input", async () => {
    const agent = await ReactiveAgents.create()
      .withName("g").withProvider("test").withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withGrounding({ mode: "warn" })
      .build();
    // Introspect the compiled config (mirror how other wither tests assert —
    // grep an existing wither test e.g. withVerification for the exact accessor).
    expect(agent).toBeDefined();
  });

  it("is absent by default (no withGrounding call)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("g2").withProvider("test").withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .build();
    expect(agent).toBeDefined();
  });
});
```
> Model the config-introspection assertion on the closest existing wither test (`rg -l "withVerification" packages/runtime/tests`); assert the grounding field lands on the compiled runtime input the same way that test checks verification.

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/runtime && bun test tests/builder/grounding.test.ts --timeout 15000`
Expected: FAIL — `.withGrounding` is not a function.

- [ ] **Step 3: Add the types + wither + schema**

In `builder/types.ts`:
```ts
/** Options for `.withGrounding()` — opt-in numeric evidence-grounding. */
export interface GroundingOptions {
  readonly mode: "block" | "warn";
  readonly tolerance?: number;
  readonly maxRetries?: number;
}
```
In `builder.ts`, add a wither beside `withVerification` (`:834`):
```ts
    /**
     * Enable opt-in numeric evidence-grounding. Off by default. When on,
     * figures in the final answer are checked against the FULL tool data with
     * rounding tolerance. `mode: "warn"` = advisory; `mode: "block"` = one
     * corrective retry then degrade to warn (never hard-fails the run).
     */
    withGrounding(options: GroundingOptions): this {
        return this.n(applyGroundingConfig(this, options));
    }
```
Implement `applyGroundingConfig` (mirror `applyWithVerification`'s shape — it sets the field onto the builder's kernel-input bundle so `buildKernelInput` forwards `grounding`). Wire `KernelInput.grounding = options` through the runtime construction path that already forwards cross-cutting fields (the same path that forwards `harnessPipeline`/`budgetLimits`).
In `agent-config.ts`, add the schema + root field:
```ts
export const GroundingConfigSchema = Schema.Struct({
  mode: Schema.Literal("block", "warn"),
  tolerance: Schema.optional(Schema.Number),
  maxRetries: Schema.optional(Schema.Number),
});
```
Add `grounding: Schema.optional(GroundingConfigSchema)` to `AgentConfigSchema`, and in the declarative apply path (near where `verification` is applied, `:458`) add:
```ts
    if (config.grounding) builder = builder.withGrounding(config.grounding);
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/runtime && bun test tests/builder/grounding.test.ts --timeout 15000`
Expected: PASS.

- [ ] **Step 5: Run build + runtime suite**

Run: `bunx turbo run build --filter=@reactive-agents/runtime`
Run: `cd packages/runtime && bun test --timeout 60000`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/builder/types.ts packages/runtime/src/builder.ts packages/runtime/src/agent-config.ts packages/runtime/tests/builder/grounding.test.ts
git commit -m "feat(runtime): .withGrounding() opt-in builder API + declarative schema"
```

> **End of Phase C (main-thread).** Gate: wither + schema round-trip green; builds green.

---

## Task D1: block-mode retry/degrade integration

**Files:**
- Modify: `packages/reasoning/src/kernel/loop/runner.ts` (terminal grounding-reject handling)
- Test: `packages/reasoning/tests/kernel/loop/grounding-block-mode.test.ts` (new)

- [ ] **Step 1: Write the failing integration test**

Drive a terminal verification where `grounding: { mode: "block", maxRetries: 1 }` and the answer contains a fabricated figure absent from tool data. Assert: first verdict `reject` → kernel retries once; if the retry still ungrounded, the run SURFACES the answer with a `verifierWarning` and status is NOT `failed` (degrade-to-warn). Model the harness on an existing `runner.ts` terminal-verify test (`rg -l "verifyAndEmit\|terminal" packages/reasoning/tests`).

```ts
// Skeleton — fill the runner fixture from the nearest existing terminal-verify test.
it("block mode: ungrounded figure → one retry → degrade-to-warn, run not failed", async () => {
  // ... build state with a fabricated figure + tool obs lacking it, grounding block, maxRetries 1
  // assert: retried once; final result.status !== "failed"; verifierWarning present
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/reasoning && bun test tests/kernel/loop/grounding-block-mode.test.ts --timeout 30000`
Expected: FAIL — no retry/degrade wiring yet (or run hard-fails).

- [ ] **Step 3: Implement retry + degrade in runner.ts**

At the terminal-verify consumption site (`if (!verdict.verified)` path in `runner.ts`), when the failing check is `evidence-grounded` with severity `reject` (block mode):
- Increment the existing grounding-retry counter in kernel state (the `groundingRetry`/synthesis-grounding counter — grep `groundingRetry` / `Scaffold 3` in `runner.ts`/`kernel-state.ts` for the exact field; reuse it, do not add a parallel counter).
- If `retries < (grounding.maxRetries ?? 1)`: inject the ungrounded figures as corrective guidance and continue the loop (one more synthesis attempt).
- If retries exhausted: **degrade** — accept the answer, attach `verifierWarning: <violations>` to the result metadata, do NOT set status `failed`. (Mirror the existing `softFail` warn-surface path so the answer ships with a warning.)

```ts
// Pseudocode at the terminal !verdict.verified branch:
const groundingReject = verdict.checks.find(
  (c) => c.name === "evidence-grounded" && checkSeverity(c) === "reject" && !c.passed,
);
if (groundingReject) {
  const max = input.grounding?.maxRetries ?? 1;
  if (state.meta.groundingRetry < max) {
    // bump counter, inject groundingReject.reason as guidance, continue loop
  } else {
    // degrade: surface answer + verifierWarning, status stays non-failed
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/reasoning && bun test tests/kernel/loop/grounding-block-mode.test.ts --timeout 30000`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `cd packages/reasoning && bun test --timeout 60000`
Expected: baseline green.

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/kernel/loop/runner.ts packages/reasoning/tests/kernel/loop/grounding-block-mode.test.ts
git commit -m "feat(reasoning): block-mode grounding retry → degrade-to-warn (never hard-fails)"
```

---

## Task D2: Live re-bench + CHANGELOG + docs

**Files:**
- Modify: `CHANGELOG.md`
- (probe is scratch — not committed)

- [ ] **Step 1: Live re-bench — confirm grounding off by default isolates the success-floor**

Write a scratch probe (reactive, ollama gemma4:12b + anthropic, crypto-price, NO `.withGrounding()`): run and capture `metadata.success` + whether any `evidence-grounded` check fired. Compare to a run WITH `.withGrounding({ mode: "warn" })`. Record: (a) default run no longer carries an `evidence-grounded` violation; (b) whether `success` is now true on correct frontier answers (if still false, the floor was a DIFFERENT terminal check — document which, do not attribute to grounding). Delete the scratch file after.

- [ ] **Step 2: CHANGELOG entry**

Add under the unreleased section:
```markdown
### Changed
- **Evidence-grounding is now opt-in (off by default).** The always-on numeric grounding check false-flagged correctly-formatted figures (e.g. `$62,578`) when the tool observation was compressed/reformatted, impeding progress. Enable per-agent via `.withGrounding({ mode: "block" | "warn" })`; when on it grounds against the full tool data with rounding tolerance. The scaffold-leak guard (model echoing `[STORED:]`/`_tool_result_N` as the answer) remains always-on. Prose claim-grounding was removed.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: opt-in grounding redesign — CHANGELOG + bench findings"
```

> **End of Phase D (main-thread).** The impediment is gone by default; grounding is opt-in and accurate when on.

---

## Self-Review

**Spec coverage:**
- Two concerns split (spec §2): scaffold-leak always-on (A1/A2) + grounding opt-in (B). ✓
- Scaffold-leak `reject`, separate module (spec §2) → A1/A2. ✓
- `GroundingConfig` + cross-cutting thread (spec §3) → B1. ✓
- Full-data corpus via storedKey (spec §4.1) → B2 `buildEvidenceCorpusFromSteps(steps, scratchpad)`. ✓
- Tolerant value-match, magnitude suffixes (spec §4.3-4.4) → B2 `validateNumericGrounding`. ✓
- warn vs block action (spec §5) → B3 (severity from mode) + B4 (mid-loop block-only) + D1 (retry/degrade). ✓
- Remove prose claim-grounding (spec §2, §1 non-goal) → A2 step 3. ✓
- Builder `.withGrounding` + schema (spec §3) → C1. ✓
- Edge cases: thin corpus / no claims / evicted key (spec §6) → B2 tests + matcher guards. ✓
- Never hard-fails (spec §1, §5) → D1 degrade-to-warn. ✓
- Testing gates (spec §7): scaffold-leak A1; off-by-default RED→GREEN B3 gate note + D2 bench; tolerant/full-corpus B2; block integration D1; suite floor each phase. ✓
- Phasing (spec §8) A/B kernel-warden, C/D main-thread. ✓

**Placeholder scan:** The two spots that defer to "grep the nearest existing test" (C1 config-introspection assertion, D1 runner fixture) are pointer-to-pattern, not unspecified logic — the surrounding code + assertions are concrete. The runner retry-counter reuse (D1) names the exact field to grep (`groundingRetry`/Scaffold 3) rather than inventing one — deliberate, to avoid a parallel counter. No "TBD"/"add error handling" placeholders.

**Type consistency:** `GroundingConfig {mode, tolerance?, maxRetries?}` identical across kernel-state.ts (B1), VerificationContext (B3), think-guards param (B4), runtime `GroundingOptions` (C1), `GroundingConfigSchema` (C1). `validateNumericGrounding(output, evidence, tolerance)` signature consistent B2/B3/B4. `buildEvidenceCorpusFromSteps(steps, scratchpad?)` consistent B2/B3/B4. `detectScaffoldLeak(output) → {leaked, reason}` consistent A1/A2.

**Open items flagged for execution (not placeholders):** exact `runner.ts` terminal-context line (B4 step 3) + grounding-retry field name (D1) — both have a grep recipe and a named target; resolved by reading at execution time, not guessed.

---

**Plan complete and saved to `wiki/Planning/Implementation-Plans/2026-06-11-opt-in-grounding-redesign.md`.**
