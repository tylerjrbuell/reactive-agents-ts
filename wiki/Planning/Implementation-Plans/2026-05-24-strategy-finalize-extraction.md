# Strategy Finalize Extraction — Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the three-way duplication of `enforceOutputQualityGate` and `collectToolData` across the reasoning package. Lift the canonical implementation (built and verified in reflexion fix commit `0af217c8`) into a shared module at `packages/reasoning/src/kernel/loop/finalize.ts`. Migrate reflexion + plan-execute in the same PR.

**Scope discipline:** Phase 0 ONLY. Does NOT introduce `Trajectory`, `StrategyState`, `makeMachine`, or `runStrategy`. Does NOT touch ToT, reactive, direct, code-action, or adaptive. Those are candidate-Phase-1+ items and are gated on this phase's outcomes per [[2026-05-24-strategy-composability-design]].

**Lift hypothesis (honest):** The 2026-05-24 probe of plan-execute showed it does NOT have the same placeholder-survival bug reflexion did — its `[EXEC` observation harvest already feeds raw data to the synthesis gate. Therefore the expected lift from this phase is **code-dedup + invariant centralization + future-proofing**, NOT a measurable token/accuracy improvement on plan-execute. If a stricter lift gate is required, this plan does not satisfy it. Decision: ship for code health, accept the §9-softening of "2 immediate consumers" as the justification.

**Tech Stack:** TypeScript strict, Effect-TS, Bun test runner. No `as any` introduced. Conventional commits per unit.

---

## Pre-flight checks (before Task 1)

- [ ] **Clean tree off main**
  ```bash
  rtk git status --short
  rtk git fetch origin main
  rtk git checkout -B bundle/strategy-finalize-extraction origin/main
  ```
  Expected: clean except for known untracked wiki + memory docs.

- [ ] **Pin baseline metrics** (record into `## Baseline` heading below before Task 1)
  ```bash
  rtk bun test packages/reasoning/ 2>&1 | tail -5
  rtk wc -l packages/reasoning/src/strategies/reflexion.ts
  rtk wc -l packages/reasoning/src/strategies/plan-execute.ts
  bun apps/examples/spot-test.ts > /tmp/baseline-spot.log 2>&1   # control for spot-test parity
  rtk bun run build 2>&1 | tail -3
  ```

  **Baseline (filled at kickoff):**
  - reasoning tests: `<TBD> pass / <TBD> fail`
  - reflexion.ts LOC: `<TBD>` (current main: 947)
  - plan-execute.ts LOC: `<TBD>` (current main: 1642)
  - spot-test tokens / status: `<TBD>`
  - build: `<TBD>/<TBD> successful`

- [ ] **Run architecture-audit and effect-abstraction-audit skills**
  Per advisor note 2026-05-24: both skills cover this scope and were not run before the design spec was written. Run them now and capture findings. If either skill flags a structural issue this plan does not address, pause the plan and revise the design first.

  ```
  # invoke the skills against packages/reasoning/src/strategies/
  ```

  **Audit findings (filled at kickoff):** `<paste summary or N/A if both audits clear>`

---

## File Structure

**New files:**
- `packages/reasoning/src/kernel/loop/finalize.ts` — canonical synthesis gate + tool-data collection + harvest decision
- `packages/reasoning/tests/kernel/loop/finalize.test.ts` — invariant suite (6-8 unit tests asserting decideSynthesisInput rules, toolData collection, harvest fallback)

**Modified files:**
- `packages/reasoning/src/strategies/reflexion.ts` — replace private `enforceOutputQualityGate` + `decideSynthesisInput` + `collectToolData` with imports from finalize.ts
- `packages/reasoning/src/strategies/plan-execute.ts` — replace private `enforceOutputQualityGate` with import; thread raw `[EXEC` harvest unchanged
- `packages/reasoning/tests/strategies/reflexion.test.ts` — update import path; 6 decideSynthesisInput tests stay (or move to finalize.test.ts)

**Untouched:** reactive.ts, direct.ts, tree-of-thought.ts, code-action.ts, adaptive.ts.

---

## Tasks

### Task 1 — Extract shared module

- [ ] Create `packages/reasoning/src/kernel/loop/finalize.ts` containing:
  - `decideSynthesisInput(output, taskDescription, toolData)` — exact copy of the function added in commit `0af217c8` (currently in reflexion.ts:547-561 on `main`). Pure decision.
  - `collectToolData(messages)` — exact copy of reflexion.ts:939-948 on `main`. Pure.
  - `enforceQualityGate(input: { llm, taskDescription, output, toolData? })` — exact copy of reflexion.ts:565-625 on `main`. The Effect-returning gate.
  - Re-export `validateOutputFormat`, `validateContentCompleteness`, `buildSynthesisPrompt`, `extractOutputFormat` from their current homes (for one-stop import in strategies). Pure re-export, no logic change.

- [ ] Add file-level docblock documenting:
  - Pattern: synthesis is DATA → FORMAT, not draft-patcher
  - Why `collectToolData` reads from `KernelMessage[]` not `ReasoningStep[]` (canonical source of truth is the kernel conversation thread)
  - Reference to spec [[2026-05-24-strategy-composability-design]]

- [ ] Commit: `refactor(reasoning): extract synthesis quality gate to kernel/loop/finalize.ts`

**Verify:**
```bash
rtk bun test packages/reasoning/ 2>&1 | tail -3   # MUST equal baseline (1328 pass)
bunx tsc --noEmit 2>&1 | rtk grep -v wiki/Research/Prototypes | tail -5
```

### Task 2 — Migrate reflexion to shared module

- [ ] Edit `packages/reasoning/src/strategies/reflexion.ts`:
  - Delete the private `enforceOutputQualityGate`, `decideSynthesisInput`, `collectToolData` functions
  - Add `import { enforceQualityGate, collectToolData, decideSynthesisInput } from "../kernel/loop/finalize.js"`
  - Update the 3 call sites on `main` (reflexion.ts:323, :345, :491) to use `enforceQualityGate` (note name change: `enforceOutputQualityGate` → `enforceQualityGate`)

- [ ] Confirm `decideSynthesisInput` remains exported from reflexion.ts as a re-export OR move the unit tests to the new location.
  - Recommended: move tests to `packages/reasoning/tests/kernel/loop/finalize.test.ts`. Delete the export from reflexion.ts. Tests still pass via the new import path.

- [ ] Commit: `refactor(reflexion): consume shared finalize module`

**Verify:**
```bash
rtk bun test packages/reasoning/ 2>&1 | tail -3                # MUST equal baseline
rtk bun run build 2>&1 | tail -3                                # MUST be green
bun apps/examples/spot-test.ts > /tmp/post-task2.log 2>&1     # control: same output shape
diff <(grep "Tokens:" /tmp/baseline-spot.log) <(grep "Tokens:" /tmp/post-task2.log)
```

Token count may drift slightly (different LLM run). Status MUST be "completed" with real-value output (not placeholders). If placeholders return → REVERT and investigate.

### Task 3 — Migrate plan-execute to shared module

- [ ] Edit `packages/reasoning/src/strategies/plan-execute.ts`:
  - Delete private `enforceOutputQualityGate` on `main` (plan-execute.ts:1086-1140)
  - Add same import from `kernel/loop/finalize.js`
  - Update single call site on `main` (plan-execute.ts:1031) to `enforceQualityGate`
  - Plan-execute already passes `finalOutput` (raw `[EXEC` harvest) — no `toolData` parameter needed (gate falls back to draft when no toolData, which IS the raw data here). Document this asymmetry in a one-line comment at the call site.

- [ ] Commit: `refactor(plan-execute): consume shared finalize module`

**Verify:**
```bash
rtk bun test packages/reasoning/ 2>&1 | tail -3                # MUST equal baseline
rtk bun run build 2>&1 | tail -3                                # MUST be green

# Plan-execute parity probe — run the same task that produced /tmp/pe-probe.log on 2026-05-24
cp apps/examples/spot-test.ts /tmp/spot-pe-post.ts
sed -i "s/'adaptive'/'plan-execute-reflect'/" /tmp/spot-pe-post.ts
bun /tmp/spot-pe-post.ts > /tmp/pe-post.log 2>&1
diff <(grep -E "Status:|Tokens:" /tmp/pe-probe.log) <(grep -E "Status:|Tokens:" /tmp/pe-post.log)
```

Status and tool-error message MUST be identical (or token-count within ±10% variation for nondeterministic LLM). Plan-execute's existing behavior is preserved.

### Task 4 — Invariant test suite

- [ ] Create `packages/reasoning/tests/kernel/loop/finalize.test.ts` with at minimum:
  - The 6 `decideSynthesisInput` tests from reflexion.test.ts (moved, not duplicated)
  - `collectToolData` filters `tool_result` role only, skips errors, preserves order
  - `enforceQualityGate` returns input unchanged when no format detected (no-op invariant)
  - `enforceQualityGate` returns input unchanged when format valid AND content complete
  - `enforceQualityGate` invokes synthesis when toolData present + draft has placeholders (uses TestLLMServiceLayer)
  - Synthesis revalidation: returns synthesized when format-valid, original draft otherwise

- [ ] Commit: `test(finalize): invariant suite for shared synthesis gate`

**Verify:**
```bash
rtk bun test packages/reasoning/tests/kernel/loop/finalize.test.ts 2>&1 | tail -3
# Expected: ≥10 pass, 0 fail
```

### Task 5 — Final verification + lift report

- [ ] Run full reasoning suite:
  ```bash
  rtk bun test packages/reasoning/ 2>&1 | tail -3   # Expected ≥1328 pass (baseline + finalize.test additions)
  ```

- [ ] Rebuild + spot-test once more with reflexion forced (as in fix verification):
  ```bash
  cp apps/examples/spot-test.ts /tmp/spot-rfx-post.ts
  sed -i "s/'adaptive'/'reflexion'/" /tmp/spot-rfx-post.ts
  bun /tmp/spot-rfx-post.ts > /tmp/rfx-post.log 2>&1
  grep -E "Status:|Tokens:|completion" /tmp/rfx-post.log | head -5
  ```
  MUST contain real values (e.g. `$77,000`-range BTC price) and `completion: successfully` or `completion: max retries` with output containing prices.

- [ ] Measure deduplication:
  ```bash
  rtk wc -l packages/reasoning/src/strategies/reflexion.ts
  rtk wc -l packages/reasoning/src/strategies/plan-execute.ts
  rtk wc -l packages/reasoning/src/kernel/loop/finalize.ts
  ```
  Expected: reflexion ↓ ~85 LOC (947 → ~862), plan-execute ↓ ~55 LOC (1642 → ~1587), finalize.ts ~85-100 LOC. Net reduction ~40-60 LOC across reasoning package.

- [ ] Write lift report into the design spec under a new `## Phase 0 Outcomes` heading at [[2026-05-24-strategy-composability-design]]. Include:
  - LOC deltas
  - Test count delta
  - spot-test parity (reflexion + plan-execute)
  - Any unexpected findings (e.g. plan-execute showed a bug Phase 0 incidentally fixed/exposed)

- [ ] Commit: `docs(strategy-design): file Phase 0 outcomes`

---

## Stop Conditions

- Any task verification fails the baseline equality check → **revert** the failing commit, investigate, do NOT proceed.
- Reflexion spot-test produces placeholder output (regression of `0af217c8` fix) → **revert** Task 2, this plan has miscategorized the dedup.
- Plan-execute spot-test changes status from `Success` to `Failed` or vice versa → **revert** Task 3, gate signature mismatch.
- `bun run build` red after any task → **revert** that task, build is the authoritative typecheck per project memory.
- Either audit skill (architecture-audit / effect-abstraction-audit) flags a structural issue not covered by this plan → **pause**, revise design spec, do not continue.

---

## Out of Scope (deferred to candidate-Phase-1)

- `Trajectory` / `StrategyState` types
- `makeMachine` / `runStrategy` runtime
- Shared `generatePhase` / `critiquePhase` / `decomposePhase`
- `HarnessPipeline` tag additions for strategy lifecycle
- Strategy-machine pattern migration
- ToT, reactive, direct, code-action, adaptive — left untouched
- Composition operators (parallel/race/sub-strategy)
- Replay integration for strategy state

These are documented in [[2026-05-24-strategy-composability-design]] under "Candidate Roadmap" but require Phase 0 outcomes + fresh evidence per phase before any of them get plans written.

---

## Risk Register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Plan-execute call-site signature mismatch breaks synthesis | Medium | Task 3 explicit parity probe before commit |
| Reflexion test path coverage gap (moved tests) | Low | Task 4 re-runs all 6 decideSynthesisInput tests at new location |
| Re-export pattern creates circular import | Low | finalize.ts re-exports from peers, never imports from strategies/ |
| `enforceOutputQualityGate` → `enforceQualityGate` rename surprises consumers outside strategies/ | Low | Grep first: `rtk grep -rn enforceOutputQualityGate packages/` should show 0 hits outside the 2 strategies after Tasks 2-3 |
| Build red on TS6.0 baseUrl quirk after edits | Low | Project memory: trust build over `tsc --noEmit` for `ignoreDeprecations` |
| Architecture audit flags shared-module pattern as wrong | Medium | Pre-flight task explicitly runs audits; pause and revise if flagged |

---

## Estimated effort

5 tasks, each 15-30 min including verification. Total ~2-3 hours. Single PR with 4-5 commits.
