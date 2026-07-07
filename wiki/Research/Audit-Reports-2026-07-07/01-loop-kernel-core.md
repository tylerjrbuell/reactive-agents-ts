# Architecture Sweep 2026-07-07 — 01-loop-kernel-core

Advisor unavailable. I have thorough evidence across all scope files. Delivering the audit.

## Findings (ranked by leverage)

- **[H] Two parallel termination oracles that can disagree** — the verdict-driven `arbitrate()` (`arbitrator.ts:965`) and the imperative `terminate()` gateway (`terminate.ts:166`) each own a *different* post-condition gate: `applyPostConditionGate` **steers/continues** on unmet conditions (`arbitrator.ts:858-882`) while `applyTerminalPostConditionGate` **demotes to failed** (`terminate.ts:107-153`). Same unmet condition → "retry once more" on the arbitrator path but "hard failure" on the ~5 imperative `terminate()` paths (stall/loop/oracle_forced/low_delta). Cost: outcome depends on *which* actor terminated, not on the run's actual state.

- **[H] The controller-signal veto is implemented twice with divergent trigger conditions** — `controllerSignalVetoEvaluator` (`arbitrator.ts:373-416`, in the legacy evaluator chain) requires NO failed-tool evidence; `shouldVetoSuccess` (`arbitrator.ts:696-745`) requires `hasFailedToolObservation`. Both use the identical thresholds (stall≥2, inject≥3, entropy>0.55). The legacy one fires via `think.ts:1512` → `oracle-decision` intent; the intent one fires on `agent-final-answer`/`controller-early-stop`/`loop-detected`. A run can be vetoed on one path that the other would clear. Cost: false-fail regressions are un-diagnosable because "the veto" is two things.

- **[H] Budget + grounded-terminal + veto guards ONLY fire on arbitrator-terminated exits; imperative `terminate()` paths bypass all three** — `arbitrateInner`'s budget pre-guard (`arbitrator.ts:989`) and `applyGroundedTerminalGate` (`arbitrator.ts:907`) are unreachable from the stall-deliverable (`stall-deliverable.ts:185,327`), loop-resolution (`loop-resolution.ts:154,190,226`), oracle_forced (`iterate-pass.ts:954`), and low_delta (`iterate-pass.ts:646`) terminations. A stall-deliverable can ship a "success" over an exceeded budget. This is the exact "8 of 9 paths bypass the oracle" problem the terminate.ts header (lines 3-15) claims to have *fixed* — it only unified `status:"done"` writing, not the *gating*.

- **[H] Required-tools "missing" has two answers depending on caller** — `getMissingRequiredToolsFromSteps` (raw, `requirement-state.ts:78`) vs `getEffectiveMissingRequiredTools` (excludes permanently-failed, `:136`). Think-phase guards/pressure use the RAW form (`think.ts:341,1286`, `think-guards.ts:119,189`, `context-utils.ts:174`); the loop redirect/lane/abstention use the EFFECTIVE form via `missingRequiredToolsForInput` (`state-queries.ts:20`, consumed `iterate-pass.ts:625,1116`). So the think phase can see a tool as "still required" and keep nudging while the loop's own guard considers it satisfied-because-failed. Cost: nudge/redirect thrash on permanently-broken tools.

- **[M] Serialization silently drops live control counters** — `serializeKernelState` (`kernel-state.ts:1023-1047`) omits `readyToAnswerNudgeCount`, `maxOutputTokensOverride`, `maxOutputTokensRecoveryCount`, `environmentContext`, `lastMetaToolCall`, `consecutiveMetaToolCount`. A durable resume (`runner.ts:274`) loses oracle-nudge state and meta-tool dedup, so a resumed run can re-nudge from zero or re-fire dedup'd meta-tools. Cost: resume is not state-faithful despite the "used VERBATIM" contract.

- **[M] Post-loop output ownership is three overlapping fallback blocks** — §8.5 (`runner.ts:833`), §8.7 (`:862`), §8.8 (`:893`) each assemble/fill `state.output` from candidates with overlapping guards; §8.8 exists specifically because §8.5's `terminatedBy` whitelist drifts (comment `runner.ts:881-892`). Plus `finalize.ts:enforceQualityGate` duplicates the §9 synthesis gate (`runner.ts:1154`) and the Phase-D1 corrective synthesis (`runner.ts:995-1052`) is a third synthesis-invocation site. Cost: output can be re-synthesized up to 3× post-loop; provenance logic is scattered.

- **[M] Per-iteration bookkeeping is heavy and recomputed** — every pass: 2× `emitKernelStateSnapshot` (`iterate-pass.ts:423,1153`) + terminal (`runner.ts:932`); `missingRequiredToolsForInput`/`countDeliverableCandidates`/`buildEffectiveToolsUsed` recomputed 3-4× (`iterate-pass.ts:625,834,851,898,1116`); `detectLoop` Levenshtein scan (`arbitrator.ts:191`) every iter; `runReactiveObserver` entropy scoring every iter (`iterate-pass.ts:679`). Two independent serialization thunks at pass boundary + post-phase (`iterate-pass.ts:391,525`) are not co-memoized.

- **[L] Dead/placeholder evaluators still in the default chain** — `finalAnswerToolEvaluator` (`arbitrator.ts:239`) and `completionGapEvaluator` (`arbitrator.ts:335`) always return null; they cost a chain slot on every `evaluateTermination` call.

- **[L] `iterate-pass.ts` carrier/sync is self-declared scaffolding** — the file header (`iterate-pass.ts:35-38,66-69`) admits the carrier is LOC-relocation, not decomposition; 18 locals are destructured and `sync()`'d before every one of ~10 returns (`:336-352`).

## Control actor census

Distinct actors that can mutate control flow **outside** `arbitrate()`, in execution order:

In-loop (`iterate-pass.ts`):
1. RunController pause/stop → `terminate(stop_requested)` (`:366`)
2. before-think killswitch hooks → done/failed (`:485`)
3. `kernel()` think/act (act.ts routes final-answer *through* arbitrator via `arbitrateAndApply` — so act is NOT a bypass; `act.ts:480`)
4. F1 grounded-terminal redirect short-circuit → continue (`:587`)
5. Token-delta low-delta guard → `terminate(low_delta_guard)` (`:646`)
6. reactive-observer (sets dispatcher-early-stop / dispatchedStrategySwitch / dispatchedTemperature) (`:679`)
7. dispatcher-early-stop → arbitrator (`:694`, through)
8. dispatcher-strategy-switch → `applyStrategySwitch` / `terminate(switching_exhausted)` (`:716`)
9. F3 repeated-failure recovery redirect → continue (`:785`)
10. Lane controller `decideExecutionLane` → sets meta (`:834`)
11. Stall/deliverable step → `terminate` or nudge (`:868`)
12. ICS coordinator → pendingGuidance nudge (`:899`)
13. Oracle hard gate (readyToAnswer 2-stage) → `terminate(oracle_forced)` or nudge (`:920`)
14. `checkAllToolsCalled` early-exit (`:998`)
15. Loop detector + strategy-switch + `resolveDetectedLoop` → break/continue (`:1003`)
16. In-loop required-tools guard → fail/redirect (`:1110`)

Post-loop (`runner.ts`):
17. §7.5 forced abstention → `terminate(abstained)` (`:729`)
18. §8 post-loop required-tools → failed (`:801`)
19. §8.5/8.7/8.8 output-fill (`:833/862/893`)
20. Phase-D1 grounding-block corrective loop (`:995`)
21. §9.0 verifier gate → failed/warn (`:1064`)
22. §9 output quality/synthesis gate (`:1154`)

Plus two oracle sub-systems: the **legacy `evaluateTermination` chain** (9 evaluators, `arbitrator.ts:423`) invoked from `think.ts:1512` and fed back as an `oracle-decision` intent, and the **`arbitrate()` intent resolver** itself. **≈22 imperative control actors + 2 oracle layers.**

## Duplicated invariants table

| Invariant | Impl A | Impl B (+C) | Divergence |
|---|---|---|---|
| Required-tools missing | `getMissingRequiredToolsFromSteps` (raw) `requirement-state.ts:78` | `getEffectiveMissingRequiredTools` `:136` → wrapped `missingRequiredToolsForInput` `state-queries.ts:20` | A includes permanently-failed, B excludes; think vs loop see different sets |
| Controller-signal veto | `controllerSignalVetoEvaluator` `arbitrator.ts:373` | `shouldVetoSuccess` `arbitrator.ts:696` | B requires failed-tool evidence, A doesn't; different intent paths |
| Post-condition gate | `applyPostConditionGate` (steer) `arbitrator.ts:858` | `applyTerminalPostConditionGate` (fail) `terminate.ts:107` | steer-and-continue vs hard-fail for same unmet set |
| Substantive-grounding check | `hasSuccessfulSubstantiveToolCall` `grounded-terminal.ts:63` | reused in `arbitrator.ts:930`, `runner.ts:702`, `think-guards.ts:212` | single impl but re-derived corpus per site |
| Scaffold-leak grounding | `synthesisQualityRetry` `arbitrator.ts:761` | `decideSynthesisInput` `finalize.ts:69` | both call `detectScaffoldLeak`, different remediation |
| Output synthesis invocation | §9 inline `runner.ts:1154` | Phase-D1 `runner.ts:995` + `enforceQualityGate` `finalize.ts:118` | 3 sites, same `buildSynthesisPrompt` |
| Counter resets (5 per-loop) | `SWITCH_RESET_COUNTERS` `strategy-switch.ts:54` applied at 2 switch sites `iterate-pass.ts:741,1062` | `initialKernelState` `kernel-state.ts:968` | nudge/dedup counters reset in oracle gate `iterate-pass.ts:991` separately |

## Better shape (concrete keep/merge/delete)

**KEEP intact:**
- `kernel-state.ts` — `transitionState` invariant, `KernelState`/`KernelInput` types (the substrate is sound)
- `terminate()` as the *single terminal writer* (`terminate.ts:166`) — but strip its embedded post-condition gate
- `arbitrate()`'s pure `TerminationIntent → Verdict` core (`arbitrator.ts:1003-1180`) and the `Verdict` type
- `requirement-state.ts` primitives, `grounded-terminal.ts` vocabulary, `recovery-steering.ts` builders, `deliverable.ts` assembly, `tier-guards.ts` tables, `auto-checkpoint.ts`, `finalize.ts` synthesis primitives (as the *only* synthesis path)

**MERGE:**
- The ~16 in-loop imperative actors (census 1-16) → **one control-plane resolver** that returns a typed `ControlSignal` (continue | redirect(guidance) | switch(strategy) | terminate(intent)), modeled exactly on the existing `evaluateTermination` evaluator-chain pattern (`arbitrator.ts:109`) which is *already* the right shape but is used for only one guard. iterate-pass's if-ladder becomes a ranked evaluator list. This dissolves the carrier/sync scaffold.
- Both veto impls → `shouldVetoSuccess` (the evidence-gated one)
- Both post-condition gates → one gate returning an explicit `steer | fail` based on remaining iteration/budget, called from the single terminal gate
- The 3 required-tools functions → one, parameterized `{ excludeFailed }`
- §8.5/8.7/8.8 → one `assembleFinalDeliverable(state)`; §9 + Phase-D1 + `enforceQualityGate` → single finalize
- Route ALL terminations (imperative + arbitrator) through `arbitrate()` so budget/grounded/veto gates apply uniformly — this is the actual close of the "8 of 9 bypass" gap

**DELETE / dies:**
- Legacy `evaluateTermination` chain + 9 evaluators (`arbitrator.ts:109-433`) once `think.ts:1512`'s oracle path emits typed intents directly — `finalAnswerToolEvaluator`/`completionGapEvaluator` are already no-ops, `controllerSignalVetoEvaluator` duplicates `shouldVetoSuccess`
- `IterationCarrier`/`sync()` mechanism (`iterate-pass.ts:170-352`)
- `applyTerminalPostConditionGate` (folds into the merged gate)
- Two of three post-loop output-fill blocks

## Signals worth exploiting (existing mechanisms underused)

- **The evaluator-chain + short-circuit resolver already exists** (`evaluateTermination`, `arbitrator.ts:109-186`) with confidence-ranked precedence — the loop's 16 hand-coded guards should *be* entries in this structure. The architecture already contains its own better shape; it's applied to one decision instead of all of them.
- **`Verdict`/`TerminationIntent` typed contract** (`arbitrator.ts:464-511`) is the right abstraction for control flow too — extend to a `ControlSignal` union and the imperative redirect/switch/nudge sites become data, not branches.
- **`terminatedBy` string family + `TERMINAL_ANSWER_REASONS` set** (`grounded-terminal.ts:44`) already centralizes reason semantics — the scattered `nonFinalAnswerTerminations` whitelist (`runner.ts:827`) and the §8.8 "immune to string drift" fallback are symptoms of not routing every exit through the typed set.
- **`emitKernelStateSnapshot` + `noteCheckpoint` lazy serialization** (`iterate-pass.ts:391`) is the right memoization idea but isn't shared across the pass-boundary and post-phase thunks — one memoized serializer per pass would halve serialization cost on durable runs.
- **`pendingGuidance` typed channel** (`kernel-state.ts:54-71`) already unifies harness signals for the next think turn — every redirect actor writes it, so a single resolver emitting `pendingGuidance` is a drop-in with no prompt-assembly changes.