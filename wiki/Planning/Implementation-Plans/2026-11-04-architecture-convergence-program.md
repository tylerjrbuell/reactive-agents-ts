---
type: plan
status: active
created: 2026-11-04
updated: 2026-11-04
tags: [architecture, convergence, substrate, kernel, harness, plan-8, north-star]
related:
  - "[[../../Architecture/Design-Specs/2026-11-04-strategy-run-substrate]]"
  - "[[2026-11-02-harness-convergence]]"
  - "[[../../Architecture/Specs/09-UNIFIED-PROGRAM]]"
---

# Architecture convergence program (Plan 9)

Groups Plan 8's open queue items (D10, B3 P2, B5, B6, T1-T4) and the strategy run substrate into architecture classes. Plan 8's measurement rules, ablation table and ownership stay binding. Advisor pre-review (Fable, 2026-11-04): **GO-WITH-CHANGES**; all five required changes are folded in below (see "Advisor record").

## Why

09 §1's goal is a kernel "governed by a typed contract, evidenced in one ledger, assessed continuously, controlled through one plane." The pieces exist, but each concept still lives in several places, so every fix is wired N times and coverage drifts (09 §6, boundary multiplicity). Measured 2026-11-04:

| Class | Multiplicity today | Cost it causes |
|---|---|---|
| Run ledger | four sources for one run: each kernel pass mints its own from `[]` (`kernel-state.ts:609`), plan-execute/blueprint keep a `Ref<RunLedger>` (`plan-execute.ts:232`, `blueprint.ts:189`), `growRunLedger` re-projects from steps (`ledger-sink.ts:86`), the substrate's last-pass `ledger()` | earlier-pass deliverables invisible to the receipt (`reflexion.ts:849-859`); double-announce risk; violates 09 C1 |
| Strategy trajectory | spend, pause, terminal relay copied into 3-8 strategy files; reflexion 838 to 1198 LOC since May | D9 = 5 files for one rule; pause honored in 3 of 6 multi-pass strategies |
| Spend / budget | kernel budget guard counts from its own start; strategies keep cumulative meters (`plan-execute.ts:269-275`, `strategies/budget/`, ToT `maxCost`) | cap terminals fire at the wrong point in multi-pass runs |
| Terminal input | `FinalizeExtras` carries 5 optional side channels (`finalize-result.ts:252-296`) | each strategy picks a different subset |
| Tool-call boundary | native-FC and text-dialect parsers separate (`tools/src/tool-calling/*`) | `harness:tool-call-corrupted` is the top H3 harness reason (9 runs) |
| Progress counter | `consecutiveStalled` written in 5 files while `RunAssessment.evidenceDelta` already exists (`assess.ts:148-152`) | solved H3 runs vetoed after the work was done (cogito exact-value x2) |
| Kernel turn | `iterate-pass.ts` 1297 LOC + `runner.ts` 927 + 22 `runner-helpers`; 20 `terminate(` sites | every guard is a hand-placed block; reads/writes implicit |
| Guidance | `PendingGuidance` has 34 members, each with its own producer and render rule | rendered/opened accounting 1/43 (Plan 8 T3) |
| Recovery | context overflow and provider faults handled per call site | Plan 8 B6 open |
| Per-tier behavior | one hidden default for a 4B local model and a frontier model | 09 §7 Step 4 not started |

## Principles

1. **One concept, one home, one script.** Each phase ends with a drift contract or check script that fails if a second copy appears.
2. **The only behavior, not a mode.** Accumulating ledger, worst-of envelope and status cap are what the substrate always does, never per-strategy options.
3. **Structure and behavior never share a commit.** Structural moves are gated by **zero-token equivalence** (scripted model or replay over the golden corpus). H3 is smoke for structural phases; it is the gate only for named behavior changes (no claim under a 26pp gap at n=5).
4. **Conformance over the registry.** Tests parameterized over the strategy registry (later the kernel operation list) cover a new member on registration.
5. **Defaults obey the lift rule.** Any default-on behavior change goes to ablation-warden (≥3pp, ≤15% billed tokens, 2 tiers).
6. **Ownership.** `strategies/**` + substrate: main thread. `kernel/**`: kernel-warden. `packages/tools/**`: tools-warden. `packages/runtime/**`: runtime-warden. One kernel warden at a time.
7. **Advisor gates.** Fable advisor pre-review before a phase starts, post-review after it ships; findings recorded here; a blocking finding stops the next phase.

## Phases

Order: **0 → (1 ∥ 3) → 2 → 4 → 5 → 6.**

### Phase 0: safety net

- **0a. Advisor pre-review.** Done 2026-11-04 (record below).
- **0b. Strategy conformance suite** over the registry: a durable pause ends the run with the paused result; a harness-authored or budget-terminal output is never `completed`; spend and `llmCalls` equal the sum of passes, calls and accounted work; the terminal carries a delivery verdict; `runLedger` contains every pass's tool evidence. Unmigrated strategies are listed as known-red cells; the list only shrinks.
- **0c. Baseline.** Full H3 at `2a73d337e`, both tiers, committed.
- **0d. Golden corpus + equivalence harness.** Grow the golden traces (Plan 8 S1/L2) to cover each strategy and each guard exit, and add a zero-token replay/equivalence runner that Phases 1, 2 and 4 use as their primary gate.

### Phase 1: strategy run substrate (spec: 2026-11-04-strategy-run-substrate)

S1 shipped (direct, reactive, tree-of-thought). Before any further migration:

- **S1-fix (substrate hardening).**
  1. One accumulating ledger sink owned by the run: shared by kernel passes (seeded through `KernelInput`, seq continued), direct tool dispatch and the plan checklist; announced once. `ledger()`-as-last-pass is deleted.
  2. `StrategyEnd` gains `Delegated` (relay an already-minted child result: one terminal decision) and `basedOn?: PassResult` on `Result` (the kernel relay applies to strategy-computed answers too).
  3. The substrate joins every pass's completion envelope and caps `Result.status` (worst-of rule, `capStatusToEnvelope` moves here).
  4. Relay keys (`terminatedBy`, `runLedger`, `abstention`, honesty markers) are reserved at the type level; strategy extras cannot overwrite them.
  5. Pause in waves: `run.passes(...)` collect mode records every sibling's steps and spend before ending on a pause; a drift check forbids `catchAll` / `retry` / `orElse` around `run.pass`.
  6. `run.account(...)` for 0-LLM and non-gateway work (blueprint worker, code-action sandbox), whitelisted in the drift test.
  7. One spend meter: `run.spend()` seeds `KernelRunOptions` so kernel budget caps count run-cumulative spend.
  8. Paused terminal carries `taskId`; recovery stays in `gatewayComplete` (Phase 5), never in `run.call`.
- **S1b reflexion**, **S2 plan-execute + blueprint**, **S3 code-action + adaptive** (adaptive ends `Delegated`).
- **S4 close.** Drift contract over every strategy file; conformance suite green; honest-partial files deleted; `FinalizeExtras` side channels collapsed into the `StrategyEnd` variants.
- **Exit (mechanical):** conformance suite green with zero known-red cells; one ledger source per run (check script); equivalence runner green; ≥30% LOC across the six multi-pass files (secondary); advisor post-review.

### Phase 3 (parallel with Phase 1): one tool-call boundary

One parser and one argument grammar for native-FC and text dialects, with the healer behind it (tool-call extraction P2; spec `2026-11-03-canonical-tool-call-extraction`). The kernel sees only typed tool-call intents; corruption becomes a typed rejection the model can repair.
- Owner: tools-warden (parser) + kernel-warden (assistant-turn boundary; serialized with other kernel work).
- Exit: one parse entry point (check script); `harness:tool-call-corrupted` 9 to ≤2 on cogito with no qwen regression (H3 is the gate here: behavior change).

### Phase 2: one progress authority

- **2a (correctness).** Delete the `consecutiveStalled` counter (`iterate-pass.ts:950-971` and its four other writers); stall/cap proposals read `RunAssessment` (`evidenceDelta`, requirement transitions, artifacts, meta-only turns). No second assessment type. Gate: equivalence on goldens except the named cases (meta churn, stall after delivered artifacts), which are pinned; H3 targets `harness:false-veto` and `stall-after-work`.
- **2b (lift-gated).** Evidence-delta reset as the default (Plan 8 L3) goes to ablation-warden; it is not shipped under a no-regression gate.

### Phase 4: the kernel turn as an operation list (Plan 8 D10)

`iterate-pass.ts` becomes an ordered list of named operations, each declaring the state slices it reads and writes; guards emit proposals; the exit gate is the only operation that ends a run. Lands behind one call site (`run.pass`).
- Folded in: **one guidance channel.** The 34 `PendingGuidance` members become typed guidance signals with one producer interface, one renderer, a per-turn token budget and ledger accounting (T3). Guidance reduction (T4) stays lift-gated.
- Owner: kernel-warden, one operation group per commit, equivalence-gated.
- Exit: `iterate-pass.ts` under 1000 LOC; check script that only the exit gate calls `terminate()`.

### Phase 5: tier profiles and recovery policy

- **Profiles (09 §7 Step 4):** tool-surface policy, iteration budget, strategy cost ceiling, context allocation and optional operations become named per-tier profiles. Per-tier default changes go through ablation-warden.
- **Recovery policy (B6):** one typed policy at the gateway for context overflow (compact and retry), transient provider faults and malformed responses.

### Phase 6: breadth of truth

L1 long-horizon tasks and the frontier arm on the H3 runner; per-kind trace schema validation at load (09 §6.9); 09 amendment, debrief, DEBT-REGISTER and memory sync.

## Not in this program

Config convergence (09 §7 Step 6) stays last by 09's ruling. Teams (Arc 3) wait on C5. No new public API in Phases 1-4.

## Advisor record

**Pre-review, 2026-11-04 (Fable): GO-WITH-CHANGES.** Required changes, all adopted: (1) one accumulating announced-once ledger sink before S1b; (2) `Delegated` and `basedOn` ends, envelope join and status cap in the substrate, reserved relay keys; (3) pause-safe wave mode plus a drift check against error-swallowing combinators around `run.pass`; (4) resequence to 0 → (1 ∥ 3) → 2 → 4, narrow Phase 2 to deleting the counter and send the evidence-reset default to ablation-warden; (5) Phase 0d golden corpus and zero-token equivalence as the primary gate for structural phases. Also adopted: one spend meter and one terminal input (missing classes 2 and 3); `PendingGuidance` count corrected to 34. Claims spot-checked against code before adoption (`kernel-state.ts:62-140`, `stall-deliverable.ts:252`, `reflexion.ts:849-859`, `plan-execute.ts:608`).

**Post-review:** pending, after each phase.
