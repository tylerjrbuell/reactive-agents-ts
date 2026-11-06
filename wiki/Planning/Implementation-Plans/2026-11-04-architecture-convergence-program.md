---
type: plan
status: active
created: 2026-11-04
updated: 2026-11-05
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
| Run scope (added 2026-11-05) | ~15 per-run FiberRefs (controller, budget, tool stores, file root, document store, model override, resume/approval state, streaming callback, run context) bound one at a time at ~8 sites (`reactive-agent.ts:1146-1157`, `execute-stream.ts:153,710`, `run-facade-effect.ts:44`, `pipeline.ts:339`, `reasoning-service.ts:246-249`, `durable-facade.ts:306,321`, `sub-agent-executor.ts:655-659`, `run-budget-arm.ts:72`) | every new piece of run state must be bound at every entry; a missed entry falls back to shared state (the 2026-11-05 leak and sandbox-escape class) |
| Per-tier behavior | one hidden default for a 4B local model and a frontier model | 09 §7 Step 4 not started |

## Principles

1. **One concept, one home, one script.** Each phase ends with a drift contract or check script that fails if a second copy appears.
2. **The only behavior, not a mode.** Accumulating ledger, worst-of envelope and status cap are what the substrate always does, never per-strategy options.
3. **Structure and behavior never share a commit.** Structural moves are gated by **zero-token equivalence** (scripted model or replay over the golden corpus). H3 is smoke for structural phases; it is the gate only for named behavior changes (no claim under a 26pp gap at n=5).
4. **Conformance over the registry.** Tests parameterized over the strategy registry (later the kernel operation list) cover a new member on registration.
5. **Defaults obey the lift rule.** Any default-on behavior change goes to ablation-warden (≥3pp, ≤15% billed tokens, 2 tiers).
6. **Ownership.** `strategies/**` + substrate: main thread. `kernel/**`: kernel-warden. `packages/tools/**`: tools-warden. `packages/runtime/**`: runtime-warden. One kernel warden at a time.
7. **Advisor gates.** Fable advisor pre-review before a phase starts, post-review after it ships; findings recorded here; a blocking finding stops the next phase.
8. **Modality-neutral core (owner direction, 2026-11-05).** The framework must build coding, voice and multimodal agents, not only general text agents. No new kernel, substrate or ledger type may assume a turn is a string. Today it does: kernel messages and tool results are `content: string` (`core/src/services/harness-types.ts:63`, `reasoning/src/kernel/state/kernel-message.ts`), while the provider layer already carries image blocks (`llm-provider/src/types.ts` `ImageContentBlock`). What each phase owes:
   - **Phase 4 (kernel operation list + guidance channel):** message and tool-result content become typed parts (text, image, audio, file/artifact reference), with text as one part kind; guidance renders as parts, not prompt-string surgery.
   - **Phase 2 lifecycle:** run control supports streaming turns and interruption (a voice barge-in is a run-controller event, like stop), and a latency budget sits beside the token budget.
   - **Ledger/evidence:** artifacts are typed references (file, diff, image, audio clip, test run), so coding agents get workspace diffs and test results as first-class evidence, and multimodal outputs can be delivered and verified.
   - **Tool boundary (Phase 3, done):** stays typed intents; tool results gain typed parts in Phase 4.
   Ratified into 09 §2 (program invariants) by the owner on 2026-11-05.

## Phases

Order (amended 2026-11-04, owner priority on long horizons): **0 → (1 ∥ 2 ∥ 3) → 4 → 5 → 6.** Phases 1, 2 and 3 have different owners and run in parallel; their kernel commits are serialized (one kernel warden at a time).

Queue (re-prioritized by the owner, 2026-11-05; advisor GO-WITH-CHANGES): fresh full H3 baseline → loose ends → Phase 1 close (one tool-evidence projection on `KernelState`, one ledger source, `FinalizeExtras` collapse) → **1R one run scope** → Phase 2 correctness items **2b (with one gate-owned terminal synthesis), 2e, 2d** → one failure taxonomy → 0e long-horizon eval → lift-gated 2c, 2f, 2g → Phase 4 → Phases 5-6 → plugin API. The correctness items no longer wait for 0e; only lift-gated items need it. Design decisions: see "Advisor record".

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
- **S2 design (read 2026-11-04, blocked on the kernel pass seed).** plan-execute today keeps four private copies of substrate concerns: a `ledgerRef` for direct dispatch, composite sub-kernel ledgers rebuilt from steps (`recordSubKernelSteps`, a second ledger path), `pendingPause` threaded through `applyWaveResults`, and hand-summed `totalTokens` / `llmCallsTotal` / `contributingEnvelopes`. Migration:
  1. The substrate owns the run ledger as a `Ref` and exposes it as `run.ledgerSink` for `executeToolAndObserve`; `run.ledger()` becomes an Effect (no external callers today). The plan checklist takes the same sink.
  2. Composite and analysis steps run through `run.pass(..., { deferPause: true, contributes: accepted })`, seeded with the run contract and ledger (kernel-warden item 3), so their ledgers are absorbed once and `recordSubKernelSteps` leaves plan-execute. After each wave, `run.checkpoint()` ends on a pause; `pendingPause` and `finalizePausedStrategyResult` go.
  3. Planner, reflect, refine, synthesis and quality-gate calls use `run.account` (or `run.call` where they are gateway calls); `totalTokens` / `llmCallsTotal` / `totalCost` go. Step results stop carrying spend for passes the substrate already counted (double-count trap).
  4. The end is `Result` with `verdict` (the delivery decision) and `basedOn` unset; `deriveTerminalOutcome` keeps only the abstention and budget-stop fields, the cap moves to the substrate.
  5. C5: an unparseable plan falls back to a single reactive pass (`run.pass`) instead of failing the run; conformance `plan-execute-reflect:C5` and `blueprint:C5` leave `KNOWN_GAPS`.
  Blueprint follows the same shape; its worker is 0-LLM (`run.account`). Gate: replay goldens (`blueprint-two-step` included) reproduce, conformance green, red-on-cut drift test lists both files.
- **S4 close.** Drift contract over every strategy file; conformance suite green; honest-partial files deleted; `FinalizeExtras` side channels collapsed into the `StrategyEnd` variants.
- **Exit (mechanical):** conformance suite green with zero known-red cells; one ledger source per run (check script); equivalence runner green; ≥30% LOC across the six multi-pass files (secondary); advisor post-review.

### 1R: one run scope (added 2026-11-05, closes the run-isolation work)

Per-run state is one value, built once and bound once at one run entry. Today each run-scoped FiberRef is bound separately at each entry (see the Why table), so isolation depends on every entry remembering every ref.
- One `RunScope` holds the run's controller, spend meter, tool stores, file root, document store, trace dir, model override, resume/approval state and stream callback. Reasoning and tools read only their slice; neither depends on runtime.
- Sub-agents derive a child scope from the parent (this settles document-store inheritance).
- Run control stays modality-neutral: interruption and a latency budget belong here beside the spend meter.
- Owner: runtime-warden (entry), tools-warden (tool slices), kernel-warden only if a kernel read changes.
- Gate: zero-token equivalence (goldens reproduce, conformance green) plus a drift check that no file outside the run entry binds a run-scoped ref.
- Design (advisor-required, item 5 of the 2026-11-05 pre-review): one record in core, one FiberRef, bound only by `withRunScope`/`childRunScope`; separate from `RunEnvelope` and `StrategyRun`; the two core run-context refs collapse into it.

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
- **2g (lift-gated, owner decision 2026-11-05).** Strategy switching redesign. Switching is opt-in after two ablations found no lift at +28% billed tokens (0 rescues in 20 switches; most switched runs never called a tool again: the new strategy repeats the stuck behavior). A switch may return as default only if it carries a concrete reason the target strategy can act on (the stuck requirement, the failing call, the evidence so far) instead of restarting the same task under a new loop, and passes ablation-warden on the switch-heavy cells (cogito rw-7, h3-todo-heavy) on ≥2 tiers. Until then a loop the detector cannot resolve ends through the exit gate's handoff.

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

First composite plugin to prove the surface (owner direction, 2026-11-06): a **coding-agent profile**. It bundles the workspace (the run's working directory: `.withTools({ workspace })` / `run(task, { workspace })`, binding the run-scoped file root that file tools and the shell confine to), terminal, file and git tools, a code-oriented strategy (code-action or a reactive variant), and acceptance checks (tests pass, build succeeds) disposed by the exit gate. The workspace is its core control; Cortex exposes it per chat alongside provider/model. Build after the acceptance-check point exists; it is the conformance test for "a plugin composes extension points without new kernel code".

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
| 1 S1-fix pass seed | done: `PassOptions.continues` adopts the run contract and ledger; seeded passes count the seed's tool evidence and keep the run's postconditions; reflexion golden failed to success | `de759a2b5`, `78b18234e`, `1e6f5ad8c` |
| 1 S2 | done: substrate owns the ledger Ref; `prepareReActPass` split; `Result.outcome` (Abstained / BudgetStopped); plan-execute 950 to 875 and blueprint on the substrate; replay 7/7 with no re-record | `e570025a8`, `83a07425c`, `ce800a826`, `2347c8b31`, `30b02a3bc` |
| 1 S3 | done: `Delegated` end (adaptive relays its child, adaptive:C2 closed), `Unverified` outcome, code-action on the substrate; every strategy file in the drift contract | `1316d3cb1`, `99dac48f9` |
| 1 S4a | done: dead plumbing deleted; per-strategy overhead ratchet (shrink-only) in the conformance suite | `5c3bb09aa` |
| 1 S4b | partial: plan-execute reflect skipped when delivery is verified (4→2 calls); inline patch reruns nothing and runs its steps in the same round; dependents of a failed step are skipped. Open candidates: adaptive classifier when upstream decided; ToT per-node scoring batched | `d32ba3980`, `25a22afe8`, `56e058d01` |
| Run isolation (2026-11-05) | done: per-run meta-tool stores, run-scoped result keys, per-agent document store (opt-in sharing), file root bound per run, one trace-dir resolver, switch keeps run spend | `a15064946`, `7cc667103`, `9535ba7f2`, `782b876a9`, `08f94bd3a`, `b0f7f3f8a` |
| Strategy switching | opt-in (gate OPT-IN, ledger 20-21); redesign is 2g | ablation `6b29ba3a7` |
| 1R one run scope | done: core run-scope module (one FiberRef, `withRunScope`/`childRunScope`/`ensureRunScope`); tools stores/file root/document store as slots; one `startRun` for run/runStream/resume/fork/gateway entries, sub-agents nest with `childRunScope` (stage 1). Core refs (stream sink, controller, resume/approval/interaction state, model override, recovered tool effects, both run-context refs) become core slots bound through `startRun`'s `RunStateSpec`; nine core FiberRefs and twelve scattered binds deleted (stage 2). `check-run-scope.sh` bans new FiberRefs/binds outside an allowlist; golden replay asserts zero run-scope misses (stage 3). Deferred: the run budget meter/limits (`CurrentRunBudget`, `CurrentRunBudgetLimits`, `RunBudgetDeclared`) stay engine-armed refs until the budget config reaches `startRun` (needs the debrief exemption decided: Fable item B); `CurrentModelRouting` is per-call gateway config, not run state (allowlisted) | `fc99e0de9`, `d0a3b6503`, stage 3 commit |
| H3 baseline defects | done: plan step scoped tools + abstained step fails (`301617e9f`), staleness reads post-act progress (`1b08d6958`), thinking runaway not escalated (`3385baf59`), guard warning not progress (`61843730d`), guard-blocked call never counts as called (`54bfad4f6`) | — |
| Phase 1 post-review | CLOSE-WITH-ITEMS (3 blocking items, record 1-3) | — |
| Phase 1 close items | done: one ledger source (substrate projects recorded tool evidence, dedupe by call id, conformance C3d) `a99fb5b06`; honest-partial files folded into conformance C6-C9 `c681c47a9`; one run-wide ToolEvidence on KernelState (13 callers, drift test, maxCallsPerTool run-wide and enforced on native FC; reflexion 6/2305 -> 5/1830) `0f9a7efff`; blueprint budget gate `e5959c41c`. `FinalizeExtras` collapsed into one required `StrategyTerminalInput` built only by the substrate, steps-only evidence fallback deleted (this commit). Phase 1 blocking items 1-3 are closed. Open: the `getMissingRequiredTools*` family still reads steps + optional ledger (next evidence path to converge) | — |
| Run spend | crashed child folds full meter + `llmCalls` on public type `4ad49a13a`; debrief call attributed to the run, spend readable via `debriefRich()` (option B, kept forked) `9e1c39fde` | — |
| 2a meta churn never stalls | done | `281f5e737` |
| 2b model "done" is a proposal | done: `ExitProposal{proposedBy:"model"}` disposed by the exit gate; final-answer tool and oracle exits too; `deny` decision. Deviation kept: budget-exceeded and F1 go straight to the Arbitrator | `6a2b76c47`, `ed892bad4` |
| 2d context-overflow recovery | done: compact to 0.7x the reported overflow, retry once, latched per run, trace fact `context-overflow-recovered` | `3864c1bd5`, `ed892bad4` |
| 2f progress-aware loop resolution | opt-in (`.withHarness({ loopProgressAware })`, default OFF); ablation open | `502b848a1` |
| Tool gate | every refusal answered, refusal is not failure, `maxCallsPerTool` on the run envelope for all strategies + sub-agents, builder `.withTools({ maxCallsPerTool })` | `dce77b195`, `94f0c9ea5`, `2e4cfe86d`, `26647f27b` |
| Workspace (coding-agent base) | `.withTools({ workspace })` + per-run `{ workspace }`; file tools + shell share one root | `15d7b261c` |
| 3 one parser | done; cogito tool-call-corrupted 9 to 0, qwen no regression | `a854ebb06`, `9cf4d5cd3` |
| 3 follow-up | done: batch observations paired by call id; hints carry requiredParams + riskLevel (runtime forwards it); several positionals bind in order; embedded refusal names the exact call | `de759a2b5`, `c98609a2f`, `30a3ab31c`, `94442d65b` |

## Findings log (from execution)

- 2026-11-04, Phase 3 live (cogito, rw-6/rw-7/h3-todo-heavy/rw-9, k=5, vs the `a305822ea` full run): `harness:tool-call-corrupted` 9 to 0 (FIXED), pass 3/20 to 5/20 (within noise). 6 runs now end honestly as `tool_call_unresolved` instead of executing mangled calls. Their shapes are `const x = fileRead("/abs", "utf-8")` (embedded, two positionals) and a bash fence `file-read /abs` (one positional, tool has an optional second param): both need the kernel's parser hints to carry `requiredParams` and `riskLevel` (`assistant-turn.ts:215-218`). Queued for kernel-warden.
- 2026-11-04, 2a diagnosis of the cogito exact-value false vetoes: not meta churn and not a missing done-proposal. A correct, evidence-grounded handoff synthesis is vetoed by the verifier's `output-is-model-authored` check plus the `answer` floor (authority defect, Phase 2b scope); `answer` was marked satisfied from pre-evidence text; and gather-dedup returned a.json's content for a deduped b.json call inside a parallel batch (cross-wiring correctness bug, run `01M6MBTSV7MQZS6QYHMFM2SYHH` seq 2452/2481/2510). Queued for kernel-warden, dedup bug first.

- 2026-11-04, S1b: merging pass ledgers in the substrate is not enough. Each kernel pass assesses only its own ledger and contract, and the run outcome reads the answering pass's assessment, so an earlier pass's file-write still reads as outstanding (reflexion golden outcome unchanged after S1b). Root fix is the kernel seed above; the substrate then absorbs only each pass's new entries.

- 2026-11-04, reflexion golden: each reflexion pass compiles its own RunContract from the harness-written pass prompt; the improve prompt's critique text ("these issues", "file") trips the `create-ticket` action rule and re-derives `artifact:.//tmp/...`. Fix: one contract per run (the first pass's contract is adopted by every later pass via `KernelInput.runContract`), queued for kernel-warden after 2a; substrate injects it.
- 2026-11-04, blueprint golden: `tool-call-end.args` is the healed absolute path on the blueprint worker path and the model's raw args on the kernel path; one trace field, two meanings. Fix candidate in Phase 3 (typed call record carries raw and healed args separately).
- 2026-11-05, seeded passes: two per-pass tool-evidence views remain step-scanned, so a continuing pass can still forget pass 1. `hasSuccessfulSubstantiveToolCall(steps)` feeds the grounded-terminal gate, the arbitrator (`arbitrator.ts:276/399`), three think guards and the abstention proposal: a seeded pass that ends on `end_turn` with no new call can hit a grounding redirect or abstention. `buildSuccessfulToolCallCounts(state.steps)` feeds the `maxCallsPerTool` budget, which resets each pass. Root fix: one tool-evidence projection over the ledger (seed included) that every gate reads; deferred to the "one ledger source" exit check of Phase 1 because it touches the pinned arbitrator.
- 2026-11-05, embedded text calls: `const x = fileRead(...)` is refused for any tool not `riskLevel: "low"` (D7c). Owner decision: keep the rule; users set risk levels per tool (`.withTools({ riskLevels })`, `31d37783b`). The same check found that resolved embedded calls never executed on `end_turn` (fast path ran first) and refused ones shipped as successful answers; fixed in `eabbf3a31`.
- 2026-11-05, process-global state was the root of several defects: meta-tool stores, `_tool_result_N` keys, the document store and the file root (ALS lost across Effect scheduling, which let a bench agent write outside its sandbox) were all shared or lost across runs. Each is now run- or agent-scoped through a FiberRef bound at the run entry. Rule for new code: run state lives in a FiberRef or the run envelope, never a module-level value.
- 2026-11-05, trace waste census (160 H3 runs): 32% of LLM calls came after a run's last tool call; most of the clear waste was strategy switching (see 2g). Raw token totals still trail billed tokens on non-switched runs: a separate instrument gap, open.
- 2026-11-05, H3 baseline defect 1 (evidence-staleness vetoed the pass that wrote the deliverables, 3 solved qwen runs): fixed narrowly; staleness at the turn boundary re-reads `assess()` after the act and only ever drops (`staleIterationsAtTurnBoundary`). Root fix is one assessment per pass, taken after the act, read by every guard: four readers in `iterate-pass.ts` (low-delta count, F3 arg-varying, stalled count, gathering phase) still read the pre-act assessment. Not neutral (iteration labels, staleness threshold, long-horizon guards), so it joins Phase 4's operation list with a golden re-baseline and goes to ablation-warden with 2f.
- 2026-11-05, progress-arbiter gap (seen while pinning the above, root unverified): the harness's repeat-call warning ("already called probe 2 times") returned as a tool result credits `evidenceDelta`, so it resets staleness. Violates design law 5 (only substantive results are progress). Queued for kernel-warden.
- 2026-11-04, conformance: adaptive loses `llmCalls` in its relay; direct's 1-turn cap ends before act on a gated call; an unparseable plan fails plan-execute and blueprint outright (no planless fallback).

## Not in this program

Config convergence (09 §7 Step 6) stays last by 09's ruling. Teams (Arc 3) wait on C5. No new public API in Phases 1-4.

## Advisor record

**Pre-review, 2026-11-04 (Fable): GO-WITH-CHANGES.** Required changes, all adopted: (1) one accumulating announced-once ledger sink before S1b; (2) `Delegated` and `basedOn` ends, envelope join and status cap in the substrate, reserved relay keys; (3) pause-safe wave mode plus a drift check against error-swallowing combinators around `run.pass`; (4) resequence to 0 → (1 ∥ 3) → 2 → 4, narrow Phase 2 to deleting the counter and send the evidence-reset default to ablation-warden; (5) Phase 0d golden corpus and zero-token equivalence as the primary gate for structural phases. Also adopted: one spend meter and one terminal input (missing classes 2 and 3); `PendingGuidance` count corrected to 34. Claims spot-checked against code before adoption (`kernel-state.ts:62-140`, `stall-deliverable.ts:252`, `reflexion.ts:849-859`, `plan-execute.ts:608`).

**Post-review, Phase 1 (Fable, 2026-11-05): CLOSE-WITH-ITEMS.** Exit criteria vs code: conformance has 3 known-red cells (`strategy-conformance.test.ts:44-48`); one ledger source is partial (code-action re-projects steps into the sink, `code-action.ts:609-615`, and the drift BANNED list omits `growRunLedger`/`ledgerSinkTarget`); `FinalizeExtras` not collapsed and still public; six `*-honest-partial.integration.test.ts` remain; multi-pass LOC -12.9% (bar 30%). Blocking before Phase 1 is marked closed:
1. Add `growRunLedger` and `ledgerSinkTarget` to the drift BANNED list, move code-action's step-to-ledger projection into the substrate, remove `growRunLedger` from the public index.
2. Collapse `FinalizeExtras` into the `StrategyEnd` variants and stop exporting it (`finalize-result.ts:252-273`, `index.ts:177`).
3. Delete the six honest-partial test files once the conformance suite covers each case.
Non-blocking: shrink `KNOWN_GAPS` (C5 planless fallback, direct:C1p); LOC bar stays open.

**Pre-review, reordered queue (Fable, 2026-11-05): GO-WITH-CHANGES.** Claims spot-checked against code before adoption (`strategy-conformance.test.ts:44-48`, `code-action.ts:607-615`, `finalize-result.ts:252-273`, `adapter.ts:70,128`; no `LLMContextOverflowError` handler in reasoning or runtime). Required, all adopted:
4. Tool-evidence projection: one `ToolEvidence` value computed in `transitionState` (the ledger chokepoint) and stored on `KernelState`; the 13 step-scanned callers read it; `hasSuccessfulSubstantiveToolCall(steps)` deleted; a drift test bans step-scanned callers. Named behavior change: `maxCallsPerTool` becomes per run, not per pass.
5. 1R: `RunScope` is one record in `@reactive-agents/core`, carried by one FiberRef, bound only by `withRunScope` and `childRunScope`. Not a per-run Layer (tool handlers and `arbitrationContextFromState` read ambient state synchronously). Not merged with `RunEnvelope` (per kernel pass) or `StrategyRun` (per strategy call): three lifetimes; `run.spend()` reads the RunScope meter so spend has one home. The two core run-context refs (`streaming.ts:49`, `run-context.ts:60`) collapse into it. Bind on the fiber that runs the kernel (`execute-stream.ts:710-712`). Check script: run-scoped `FiberRef.unsafeMake` only in the run-scope module. Doc-store inheritance: the child inherits the parent store unless it declared `.withDocuments`.
6. 2b: model "done" becomes an `ExitProposal{proposer:"model"}` the exit gate disposes (today the fast accept at `dispatch-think-response.ts:607-616` checks required tools and lexical `looksLikeFinalAnswer` only); lexical checks decide only contract-poor tasks. The six post-loop LLM authorities (`finalize.ts:152`, `handoff-synthesis.ts:125`, `pace-terminal.ts:88`, `runner-output-quality-gate.ts:118`, `runner-terminal-verify-gate.ts:242,325`, provider `qualityCheck` at `adapter.ts:128`) collapse to one gate-owned terminal synthesis; the provider-layer quality prompt is deleted. Evidence: 28.6% of LLM calls fall after a run's last tool call (176 non-test runs; 301 extra post-tool calls).
7. Unify the failure taxonomy of `rax-diagnose attribute` (2905 runs, 99% of failures unattributed) and `h3/verdict.ts` before 0e, since 0e's metrics depend on it.
**1R design follow-up (Fable, 2026-11-05): GO-WITH-CHANGES, adopted.** A closed record in core cannot type the tools-owned slices, so the run scope is an open map of typed slots: each package declares `runSlot(name, policy)` as a module-level const; one FiberRef carries the map (`core/src/internal/run-scope.ts`, `@reactive-agents/core/internal/run-scope`, outside the public index). Alternatives rejected: Effect `Context` with Tags (its bind op `provide` is the general DI op, so a drift check cannot tell a run bind from a service provide, and it has no reset-on-child); a generic extensions bag (a slot map without types). Required changes: (A) a `reset` slot takes a `fresh()` factory, never a shared default object (today's leak shape); (B) `withRunScope` replaces the scope and dies if a run scope is already active; `childRunScope` is the only nesting; debrief's budget unbind is not a scope op (count its spend, exempt it from the cap by purpose if needed); (C) the API stays internal, and `withRunScope` takes a `RunContext`, so every scope has a run id by type and the two core run-context refs collapse into it; (D) a read outside any run records a miss, and golden replay asserts zero misses (proves every entry binds a scope). Migration: stage 1 tools slots + one `startRun` in runtime; stage 2 core refs; stage 3 reasoning refs, drift script, zero-miss assertion.

**Post-review, Phase 1 close (Fable, 2026-11-05, HEAD `2a2d184f9`): CLOSED.** Blocking items 1-3 of the earlier post-review are done. Carried, not blocking: `KNOWN_GAPS` (5 cells: C5 planless fallback x2, `direct:C1p`, `direct:C9`, `adaptive:C9`), the LOC bar, and two multiplicities in disguise. (a) One ledger home but two growth paths: the substrate re-projects code-action's recorded steps at the terminal (deduped by call id) while every other dispatch writes `ledgerSink` at execution time. (b) Two definitions of "called": `requirement-state.ts` still unions steps with the ledger in `getMissingRequiredToolsFromSteps` (16 sites, incl. the model-done fast path `dispatch-think-response.ts:549`), `buildAttemptedToolCallCounts(steps)`, `getPermanentlyFailedRequiredTools(steps)`. Also: the H1 fix made a pass assess twice (pre-act for four readers, post-act for staleness). Required before 2b ships:
8. Replace the steps-union required-tool family with derivations over `state.evidence` (add `attemptedCounts`, `permanentlyFailed`, `missingRequired(evidence, contract)`); drift test bans `FromSteps` callers. This is 2b step 0.
9. One assessment per pass, taken after the act; the pre-act assessment and its four readers go. Before 2e (its `progressed` reads `assess()`).
10. 2b deletes the model-done fast path (`dispatch-think-response.ts:549-616`) and routes the model's claim through `ExitProposal{proposer:"model"}`; outstanding = `missingRequired(state.evidence, contract)` + unmet delivery conditions + no draft; lexical final-answer checks only mark "has draft", never accept; the gate's handoff is the only post-loop synthesis (`finalize.ts:152`, `pace-terminal.ts:88`, `runner-output-quality-gate.ts:118`, `runner-terminal-verify-gate.ts:242,325`, provider `qualityCheck` fold in or go).
Recommended: code-action's sandbox writes `run.ledgerSink` at execution time and the terminal projection goes; replay asserts zero run-scope misses (1R stage 3); shrink `KNOWN_GAPS`, C5 fallback first; mark `finalizeStrategyResult` `@internal` (a custom strategy should reach `runStrategy` through the plugin API, not the mint). 2d is independent and gateway-level and can run in parallel. Order: 8 → 9 → 10 (2b) → 2e; 2d in parallel.

Recommended: express the builder's acceptance withers (`withVerification`, `withBehavioralContracts`, `withOutputValidator`, `withCustomTermination`, contract postconditions) as one internal `AcceptanceCheck[]` the exit gate disposes, alongside 2b (public deprecation waits for Phases 5-6; this becomes the plugin acceptance-check point). Check whether debrief spend (`debrief-synthesis.ts:331` binds the run budget to null) explains the open raw-vs-billed token gap. 2d design: one handler where history is assembled, compact to 0.7x the reported overflow, retry once, latched on the RunScope, trace fact `context-overflow-recovered`, no LLM summary. 2e design: `GoalSegmentResult` carries the run verdict and `evidenceDelta`; `progressed` = evidence delta or a requirement transition.
