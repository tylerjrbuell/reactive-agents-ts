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

Order (amended 2026-11-04, owner priority on long horizons): **0 → (1 ∥ 2 ∥ 3) → 4 → 5 → 6.** Phases 1, 2 and 3 have different owners and run in parallel; their kernel commits are serialized (one kernel warden at a time).

### Long-horizon alignment (why Phase 2 moved up)

The long-horizon audit (`wiki/Research/Audit-Reports-2026-11-02/long-horizon-and-termination-authority.md`) found the harness **mis-wired by a gate, not rigid by design**. `assess()` computes evidence delta, requirement states and phase every pass, but every consumer that would make guards progress-aware is behind `horizonActive` (`guard-adapters.ts:55-139`). The default path still measures progress in new artifact files, token delta and iteration count. Pace is a function of the iteration cap (`assess.ts:390-395`). The cap ends success-in-progress as `max_iterations`. Boundaries leave no handoff. The goal supervisor (`pursueGoal`) uses a third "done" vocabulary. The OSS landscape audit (`Audit-Reports-2026-11-03/oss-harness-landscape.md`) shows where leading harnesses converge:

| Leading-harness pattern | Who | Our gap | Phase 2 item |
|---|---|---|---|
| Model proposes done, a deterministic party disposes | Codex Stop hook, OpenHands critic, Goose SuccessCheck, smolagents checks, Anthropic pass-list | mostly landed (B4 exit gate); "model said done" is not yet a proposal on contract-poor tasks | 2b |
| Cap never bare-fails: forced summary / handoff | OpenCode, smolagents, LangGraph, Goose | `max_iterations` failure on the default path | 2c |
| Stall is advisory first, never counts meta churn | OpenHands, Goose | stall counts turns; meta churn accrues | 2a |
| Reactive context-overflow compact-and-retry | OpenCode, Codex, Hermes | no verified reactive retry | 2d |
| Harness-protected plan state, model may only flip status | Anthropic long-running-agent guidance | model-owned todo feeds guards | 2a + Phase 1 plan rows |
| Progress file / handoff artifact at boundaries | Anthropic, Codex/OpenCode sessions, LangGraph checkpointer | checkpoints are crash/HITL-oriented, no handoff note | 2c |
| Per-turn budget awareness to the model | Goose, smolagents | unverified | 2c (inside its arm) |
| Byte-stable prefix, guidance outside the system prompt | Hermes, OpenCode | guidance renders into the system prompt each turn | Phase 4 guidance channel (measured) |

### Phase 0: safety net

- **0a. Advisor pre-review.** Done 2026-11-04 (record below).
- **0b. Strategy conformance suite** over the registry: a durable pause ends the run with the paused result; a harness-authored or budget-terminal output is never `completed`; spend and `llmCalls` equal the sum of passes, calls and accounted work; the terminal carries a delivery verdict; `runLedger` contains every pass's tool evidence. Unmigrated strategies are listed as known-red cells; the list only shrinks.
- **0c. Baseline.** The program's H3 before is the full run at `a305822ea` (both tiers, 56/120, report `2026-11-04-d9-full-h3`), taken one commit before S1; S1's own change was checked by equivalence (all goldens reproduce) plus an H3 subset. Zero-token baseline: `replay-ablate.ts --baseline`, 5/5 goldens reproduce after S1-fix.
- **0d. Golden corpus + equivalence harness.** Grow the golden traces (Plan 8 S1/L2) to cover each strategy and each guard exit, and add a zero-token replay/equivalence runner that Phases 1, 2 and 4 use as their primary gate.
- **0e. Long-horizon eval (Plan 8 L1, moved up).** The trace corpus contains no run past 9 iterations, so no long-horizon claim is measurable today. Add rw-4, rw-7, lh-1 plus debug-to-green, enumerated-research and pipeline tasks with deterministic graders to the H3 runner; arms A0 HEAD and A1 evidence-delta reset; local mid + local small, frontier arm cost-checked or marked deferred. Pre-registered metrics: cap-cutoff-with-progress rate, stall misfire rate, pass^k, billed tokens.

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

### Phase 2: long-horizon run lifecycle (one progress authority, one completion authority)

- **2a (correctness).** Delete the `consecutiveStalled` counter (`iterate-pass.ts:950-971` and its four other writers); stall/cap proposals read `RunAssessment` (`evidenceDelta`, requirement transitions, artifacts, meta-only turns). Meta-only turns never accrue stall (K2). No second assessment type. Gate: equivalence on goldens except the named cases (meta churn, stall after delivered artifacts), which are pinned; H3 targets `harness:false-veto` and `stall-after-work`.
- **2b (correctness).** "Model said done" becomes a proposal the exit gate disposes against contract x ledger whenever any deterministic requirement exists; lexical terminators decide only contract-poor tasks (audit C2).
- **2c (lift-gated).** Cap and boundary lifecycle: at the soft cap, a run still producing evidence with requirements outstanding and budget left gets one more segment; otherwise the terminal-synthesis path runs instead of `max_iterations`. Every boundary (cap, checkpoint, abstain, handoff) writes a harness-authored handoff fact (done / remaining / next) to the ledger so a resumed or continued run starts from it. Bounded by the run budget meter. Opt-in first; default-on only on an ablation-warden PASS on the 0e eval (audit C4, OSS G1/G7/G9).
- **2d (correctness).** Reactive context-overflow recovery: a provider overflow error compacts history to a tighter budget and retries once, latched, with a trace fact (OSS G4). Moved here from Phase 5 because small local windows hit it first on long runs.
- **2e (behavior-preserving).** The goal supervisor's verdict reads RunContract requirements + the exit gate (tier 1), and `progressed` reads `assess()`; one "done" and one "progress" vocabulary across the kernel, the goal supervisor and Cortex (audit C6, Plan 8 L5).
- **2f (lift-gated).** Evidence-delta reset and the progress-aware guard profile as the default path (Plan 8 L3) go to ablation-warden on the 0e eval; not shipped under a no-regression gate.

### Phase 4: the kernel turn as an operation list (Plan 8 D10)

`iterate-pass.ts` becomes an ordered list of named operations, each declaring the state slices it reads and writes; guards emit proposals; the exit gate is the only operation that ends a run. Lands behind one call site (`run.pass`).
- Folded in: **one guidance channel.** The 34 `PendingGuidance` members become typed guidance signals with one producer interface, one renderer, a per-turn token budget and ledger accounting (T3). Guidance reduction (T4) stays lift-gated.
- Owner: kernel-warden, one operation group per commit, equivalence-gated.
- Exit: `iterate-pass.ts` under 1000 LOC; check script that only the exit gate calls `terminate()`.

### Phase 5: tier profiles and recovery policy

- **Profiles (09 §7 Step 4):** tool-surface policy, iteration budget, strategy cost ceiling, context allocation and optional operations become named per-tier profiles. Per-tier default changes go through ablation-warden.
- **Recovery policy (B6):** one typed policy at the gateway for transient provider faults and malformed responses (overflow moved to 2d). Verify transient errors never surface as `kernel_error` (OSS G10).

### Phase 6: breadth of truth

Long-horizon eval rerun after Phases 2 and 4 (before/after on 0e); per-kind trace schema validation at load (09 §6.9); 09 amendment, debrief, DEBT-REGISTER and memory sync.

## Extension points (plugins), the payoff of Phases 1-4

Owner direction (2026-11-04): plugins that extend or modify the framework. Sequencing rule: a public plugin API is built on the converged surfaces, never on today's multiplicity (otherwise the multiplicity becomes public contract). Each phase leaves one typed extension point, validated by the same conformance suite that covers built-ins:

| Extension point | Comes from | Plugin can |
|---|---|---|
| Strategy | Phase 1 substrate (`runStrategy`) + registry conformance | add a reasoning strategy as control flow only; spend, pause, ledger, terminal and stream come free and are conformance-checked on registration |
| Acceptance check | Phase 2b exit gate (OSS G2) | add a deterministic "done" check (tests pass, file matches) the gate disposes with |
| Kernel operation | Phase 4 operation list | insert/remove an operation with declared reads/writes; ablation becomes "remove entry" |
| Guidance producer | Phase 4 guidance channel | contribute typed guidance within the per-turn token budget |
| Tool-call dialect | Phase 3 parser tiers | add a parse tier for a model family |
| Tier profile | Phase 5 | ship a model-tier profile |

The existing `.withHarness(h => h.tap(...))` pipeline and `compose` killswitches stay the observation/killswitch surface. Plugin packaging (discovery, versioning, sandboxing of third-party code) is a separate design after Phase 4, with security review.

## Progress

| Item | Status | Commit |
|---|---|---|
| 0a advisor pre-review | done (GO-WITH-CHANGES, adopted) | `d90281103` |
| 0b conformance suite | done; 4 known-red cells | `404618d4f` |
| 0c baseline | `a305822ea` full H3 + replay baseline | — |
| 0d goldens | 7/7 (reflexion, blueprint added) | `ceeeb4873` |
| 0e long-horizon eval | open | — |
| 1 S1 / S1-fix / S1b | done (direct, reactive, ToT, reflexion) | `2a73d337e`, `404618d4f`, `01bcc4638` |
| 1 S2-S4 | open | — |
| 2a meta churn never stalls | kernel-warden in flight | — |
| 3 one parser | done; live H3 pending | `a854ebb06` |
| Kernel follow-up | queued: seed each pass with the run ledger + run contract; assistant-turn hints carry requiredParams + riskLevel | — |

## Findings log (from execution)

- 2026-11-04, Phase 3 live (cogito, rw-6/rw-7/h3-todo-heavy/rw-9, k=5, vs the `a305822ea` full run): `harness:tool-call-corrupted` 9 to 0 (FIXED), pass 3/20 to 5/20 (within noise). 6 runs now end honestly as `tool_call_unresolved` instead of executing mangled calls. Their shapes are `const x = fileRead("/abs", "utf-8")` (embedded, two positionals) and a bash fence `file-read /abs` (one positional, tool has an optional second param): both need the kernel's parser hints to carry `requiredParams` and `riskLevel` (`assistant-turn.ts:215-218`). Queued for kernel-warden.
- 2026-11-04, 2a diagnosis of the cogito exact-value false vetoes: not meta churn and not a missing done-proposal. A correct, evidence-grounded handoff synthesis is vetoed by the verifier's `output-is-model-authored` check plus the `answer` floor (authority defect, Phase 2b scope); `answer` was marked satisfied from pre-evidence text; and gather-dedup returned a.json's content for a deduped b.json call inside a parallel batch (cross-wiring correctness bug, run `01M6MBTSV7MQZS6QYHMFM2SYHH` seq 2452/2481/2510). Queued for kernel-warden, dedup bug first.

- 2026-11-04, S1b: merging pass ledgers in the substrate is not enough. Each kernel pass assesses only its own ledger and contract, and the run outcome reads the answering pass's assessment, so an earlier pass's file-write still reads as outstanding (reflexion golden outcome unchanged after S1b). Root fix is the kernel seed above; the substrate then absorbs only each pass's new entries.

- 2026-11-04, reflexion golden: each reflexion pass compiles its own RunContract from the harness-written pass prompt; the improve prompt's critique text ("these issues", "file") trips the `create-ticket` action rule and re-derives `artifact:.//tmp/...`. Fix: one contract per run (the first pass's contract is adopted by every later pass via `KernelInput.runContract`), queued for kernel-warden after 2a; substrate injects it.
- 2026-11-04, blueprint golden: `tool-call-end.args` is the healed absolute path on the blueprint worker path and the model's raw args on the kernel path; one trace field, two meanings. Fix candidate in Phase 3 (typed call record carries raw and healed args separately).
- 2026-11-04, conformance: adaptive loses `llmCalls` in its relay; direct's 1-turn cap ends before act on a gated call; an unparseable plan fails plan-execute and blueprint outright (no planless fallback).

## Not in this program

Config convergence (09 §7 Step 6) stays last by 09's ruling. Teams (Arc 3) wait on C5. No new public API in Phases 1-4.

## Advisor record

**Pre-review, 2026-11-04 (Fable): GO-WITH-CHANGES.** Required changes, all adopted: (1) one accumulating announced-once ledger sink before S1b; (2) `Delegated` and `basedOn` ends, envelope join and status cap in the substrate, reserved relay keys; (3) pause-safe wave mode plus a drift check against error-swallowing combinators around `run.pass`; (4) resequence to 0 → (1 ∥ 3) → 2 → 4, narrow Phase 2 to deleting the counter and send the evidence-reset default to ablation-warden; (5) Phase 0d golden corpus and zero-token equivalence as the primary gate for structural phases. Also adopted: one spend meter and one terminal input (missing classes 2 and 3); `PendingGuidance` count corrected to 34. Claims spot-checked against code before adoption (`kernel-state.ts:62-140`, `stall-deliverable.ts:252`, `reflexion.ts:849-859`, `plan-execute.ts:608`).

**Post-review:** pending, after each phase.
