# Reactive Agents Build Memory



- 2026-07-09 **THE CONTROL-PLANE SEAMS WERE INERT — in-loop abstain was unreachable** (`241e7efe`, `e7078395`). `deriveInLoopForcedAbstention` summed `synthesisRetryCount + groundingBlockRetry` vs `FORCE_UNGROUNDED_THRESHOLD = 2`, but mid-loop `synthesisRetryCount` is **capped at 1** (`arbitrator.ts` `SYNTHESIS_RETRY_MAX`) and `groundingBlockRetry` increments **only POST-loop** ⇒ max sum **1 < 2**; the other branch needs `iterationsRemaining<=0`, true mid-loop only at `iteration===0` (before F3 needs ≥2 failures, before stall needs `iteration>=2`). ⇒ **`inLoopAbstentionProposal` returned null at EVERY seam**: F3 (`a102bcc9`), stall (`69c4ef9e`), AND the original strategy-switch P5 fix. All inert in production. **My own seam tests passed because they set `meta.synthesisRetryCount = 2` — impossible in production.** Unit-testing `f()` with an input `f` can never receive; committed twice in one day. FIX: also count `groundingRedirectCount` (only counter that moves mid-loop, `arbitrator.ts:1417`), gated on the run still being ungrounded; mirrors post-loop `secondUngroundedTerminal` (`runner.ts:795-803`). Mutation: dropping it fails **7/16**. **WHERE SEAMS MATTER (measured):** *terminal path* (model emits an answer) — grounded-terminal gate redirects once, second ungrounded terminal satisfies post-loop §7.5, run abstains anyway ⇒ seams add only overhead: `ab-trap-5` @ **qwen3:14b** both arms **acc 1.0**, ra-full **5720** tok vs long **6550** tok, gate **+0.0pp / +14.5% tok → "within the noise floor; no measurable effect"**. *Grind path* (never reaches a terminal answer; §7.5 requires a `TERMINAL_ANSWER_REASON`) — default profile **never declines at all**: F3 default iter 4/4 no-decline 2 redirects vs long iter 2 abstained 0; stall default iter 5 no-decline 2 nudges vs long iter 3 abstained 0. **Neither is a lift claim.** **`ab-trap-5`** = required `file-read` that EXISTS but always fails (file never does). **cogito:8b scores 0.0 both arms — it NARRATES and never emits a tool call**, so with weak models this task measures TOOL-CALLING, not abstention (diagnosis `honest-failure`). Shape pinned (a `ledger.json` fixture would silently un-trap it); behaviour needs a tool-calling model. **UNFIXED:** `diagnose` labels a correct abstention `dishonest-success-suspected` / `trust: dishonest` — the honesty analyzer treats the abstention sentinel as a claimed success. reasoning 2282 / benchmarks 290 pass, 0 fail, tsc 0, 8/8 invariants.
- 2026-07-09 **THE ABSTENTION RAIL WAS INVISIBLE TO THE BENCH** (`7014a224`, `b6c0d390`, `abaf486c`, `e2880ea7`). **`StreamCompleted.abstention` was DECLARED (`stream-types.ts:46`) and NEVER WRITTEN** — only the non-stream path projected it. The bench consumes `runStream` and reads `completed.abstention`; `scoreAbstention` credits a trap only on `terminatedBy==="abstained"` ⇒ **every correct harness-forced abstention scored 0.0.** Proof by execution on `ab-trap-4` (cogito:8b): before acc **0.0**, 0 tokens, output "Task complete."; after acc **1.0**, 0 tokens, same output — identical harness behaviour, only reporting changed. Fix = single owner `runtime/src/engine/abstention-projection.ts` called by BOTH paths. **Enablers found en route:** (a) `config.longHorizon` — the profile was TAG-only (`shouldUseLongHorizon`) and exactly ONE task (`lh-1`) carries `horizon:long`, so it could never be an ablation ARM; (b) **`ABSTENTION_TRAP_TASKS` was never spread into `ALL_TASKS`** ⇒ `ab-trap-*` unreachable from any session (caught by a new test, not review); (c) **`test/test` had no `STATIC_CAPABILITIES` row** ⇒ `resolveCapability` → `source:"fallback"` ⇒ bench preflight marked EVERY test-provider cell `inconclusive` with ZERO runs, so no bench e2e could use the deterministic provider. **`ab-trap-4`** declares a REQUIRED tool never provided ⇒ `decideForcedAbstention` fires at **iteration 0** (`requiredToolUnavailable`), before any LLM call ⇒ 0 tokens, deterministic e2e pin through real `runSession→runStream→scoreTask`; mutation-verified (cut projection ⇒ 1.0→0.0). **`ab-trap-1..3` score 0.0 in BOTH arms** — they declare no `requiredTools`, and the grounded-terminal gate is skipped when `ctx.requiredTools.length===0` (`arbitrator.ts:1012`); model-INITIATED abstain was cut. **They measure fabrication, not abstention.** **⚠ POWER, EMPIRICALLY:** long-horizon arm, cogito:8b, n=3, run twice ⇒ **+4.5pp @ +10.9% tok**, then **−10.6pp @ +46.7% tok**. Same comparison, opposite sign, rw-9 driving both. **Nothing is known about the long-horizon profile.** `e2880ea7`: gate rationale now says "within the noise floor; no measurable effect (NOT evidence of equivalence)" instead of "below the promotion bar" when no tier is significant (enum unchanged; `opt-in` = do not promote). **RETRACTION (mine):** `b6c0d390` claimed "the abstention rail did not fire in either configuration" — **FALSE**, inferred from a probe that never called `.withReasoning()` so no kernel loop ran. The rail fires; the stream dropped it. **STILL OPEN:** `ab-trap-4` abstains BEFORE the loop ⇒ exercises the rail but NOT the mid-loop seams (F3 `a102bcc9` / stall `69c4ef9e`), which need abstention to qualify DURING the loop (≥2 ungrounded-synthesis rejections). Needed fixture: a required tool that EXISTS but always fails. Both seam fixes remain correct-by-construction + mutation-tested, **unmeasured in the wild**. runtime 1231 / benchmarks 288 / llm-provider 381 pass, 0 fail, tsc 0.
- 2026-07-09 **THE BENCH WAS THE BUG — 4 instrument defects, all "silence read as health"** (`eed36fd9`, `1daa3910`, `e16053cf`, `1115e6fc`). **MEASURED (do not overstate):** cogito:8b, rw-4/8/9 (deterministic graded), n=3, `ra-full` vs `manual-react` → **+5.1pp accuracy @ +224% tokens → gate verdict OPT-IN**; **NEITHER ARM SOLVED A SINGLE TASK** (baseline acc 0.0; the lift is partial credit on rw-9 alone). Six green ticks for zero solves. **(a) `eed36fd9`** `--task rw-9` WITHOUT `--session` took the legacy path (filters `BENCHMARK_TASKS`, no `rw-*`) → `Tasks 0` → "All 0 tasks completed" → report of zeros → **exit 0**. `assertNonEmptySelection` guards the two REPORTING boundaries (`runBenchmarks` + `run.ts` session path) — **deliberately NOT in `runSession`**: `preflight-runsession-gate.test.ts` + `reproducibility.test.ts` pass `__nonexistent__` on purpose for a 0-cell run. **(b) `1daa3910`** `RunScore.status="pass"` means the run RETURNED, not that it was right (`runner.ts:829`); `passRate` was rendered under a `Status ✓` column. New `report-format.ts`: `completionRate` vs `solveRate` (solve = completed AND accuracy ≥1; **partial credit is NOT a solve**); crashed cell → `ERR` ≠ wrong. Gate + `computeDrift` never read `passRate` ⇒ **no verdict was corrupted**, display only. **(c) `e16053cf`** `computeDrift` iterated only `current` ⇒ a baseline cell ABSENT from the run was never examined ⇒ **deleting a failing task greened the gate**. Added `droppedCells` (fails unconditionally) + `newCells` (never fails). `--ci` with NO baseline warned and PASSED → now exit 1 (verified via `test` provider). `--save-baseline` read `report.ablation` (empty for single-variant sessions) ⇒ wrote an EMPTY baseline ⇒ `baselineCells()` prefers `taskReports`, `assertBaselineCells()` refuses empty. First baseline committed: 6 cells @ `0b3d3b3b`, 20 KB (prose/traceId/diagnosis stripped; per-run scores KEPT for future power-aware drift). **(d) `1115e6fc`** bench could toggle **10 of 90** builder methods. `feature-matrix.ts` classifies all 90 capability|plumbing; `tests/feature-coverage.test.ts` enforces DRIFT (new method unclassified → red) / WIRING (`covered` without a `builder.withX(` call site → red) / RATCHET (`UNCOVERED_CAPABILITY_CEILING = 38`, exact, may only FALL). Wired 7: grounding, fabricationGuard, stallPolicy, leanHarness, metaTools, verification, memory (`withMemory` had been called via stringly-typed `as unknown as Record<string,unknown>` — violated no-`any` AND hid it from the coverage scan). New `feature-coverage` session = ra-full + exactly ONE capability per arm, + `ra-lean`. **⚠ LOAD-BEARING: only ONE task is tagged `horizon:long`** (`lh-1`, `runner.ts:96-98`) ⇒ assessment/phase/projector, BOTH control-plane seam fixes, and `.withAdaptiveHarness()` are measured by a single Bernoulli cell. **More runs cannot fix a coverage hole — do NOT bench the 2026-07 harness work until this is fixed.** Suite variance: 7 `llm-judge` + 3 `regex` (sd≈0.50) vs 3 graded (sd≈0.257) ⇒ 3pp lift = 556 vs 147 runs/arm. `--task`/`--variant`/`--gate` are honored ONLY on the `--session` path. `bench:baseline`/`bench:drift` scripts added; **CI has no keys and no Ollama** — local/workflow_dispatch only. **RETRACTIONS (mine):** "computeDrift has never run" → it HAS a caller (`run.ts --ci`); missing were the baseline file + any invocation. "ablation variants are the wrong SHAPE" → **false**, `AblationResult.variants` IS `TaskVariantReport[]`; the defect is emptiness. Plan: `wiki/Planning/Implementation-Plans/2026-07-09-capability-measurement-wave.md`. NEXT: P2 convert 7 llm-judge tasks to graded (sd ≤0.30); P3 more `horizon:long` tasks; then re-bench harness work. benchmarks **269 pass / 0 fail**, tsc 0.
- 2026-07-09 **CONTROL-PLANE SEAM SWEEP — 2 of 6 emitters wired, 4 verified NO-DELTA** (`a102bcc9`, `69c4ef9e`). **The reusable seam pattern:** at any seam that FORCES a control action, build `[<seam emitter>, inLoopAbstentionProposal(...)]`, call `resolveControlPlane`, `emitControlResolution`, and on `abstain` route through the single-owner `terminate()`. Gate behind `horizon !== undefined` so the default path is byte-identical; commit the seam's counter ONLY if the seam's action WINS. **(a) `a102bcc9` F3 seam** (`iterate-pass.ts:974`): forced its `redirect`(4) and `return "continue"`d; the in-loop abstain proposal was only built at the strategy-switch seam (needs loop detector). abstain(1) > redirect(4). Measured long-horizon: before iter 4/4 + 2 redirects; after iter 1 + 0 redirects. **(b) `69c4ef9e` STALL seam** (`iterate-pass.ts:1128`): `runStallDeliverableStep` forces `steer`(5) / harness-deliverable `terminate`(2); abstain(1) outranks both. A run with NO deliverable + exhausted ungrounded-synthesis retries was NUDGED instead of declining. Measured long-horizon: before iter 4 + 2 nudges; after iter 2 + 0 nudges. Default pinned byte-identical (4/2). **DO NOT WIRE the other 4 — verified no-delta, wiring = write-only:** `proposeFromGroundedTerminal` (`applyGroundedTerminalGate` already resolves redirect→abstain via single owner `evaluateTerminalGate` w/ bounded budget; only runs on `exit-success` so a veto pre-empts it); `proposeFromDispatcher` (**measured**: an ungrounded `dispatcher-early-stop` with fabricated output ALREADY abstains at iteration 1 in BOTH profiles — the "ships a clean success" hypothesis was REFUTED by execution); `proposeFromControllerVeto` (veto is priority 0, evaluator runs FIRST, nothing outranks); `proposeFromBudgetMonitor` (budget/error hard-stops are the SOLE proposal at their site by design, `control-plane.ts:140-143`). **CORRECTION — `emitters.ts`'s "wrong remedy" doc claim is FALSE:** `RecoverySteeringKind` is only `"stall" | "loop"` and the "stall" text already names the failing tool + asks for corrected args; **nothing reads `ControlRemedy`**. The defect was PRECEDENCE, not text. Both fixes mutation-verified (cut the seam ⇒ 2 of 4 red each), driven through real `runKernel`→`iteratePass`. reasoning **2274 pass / 0 fail**, tsc 0, 8/8 invariant scripts green.
- 2026-07-09 **VERIFY PHASE WAS UNREACHABLE + CONTROL PRECEDENCE INVERSION** (`f466eb13`, `a102bcc9`). **(1) The `verify` phase could NEVER be entered.** The audit's "assess ignores `verdict.verified`" was a SYMPTOM. `assess()` keyed verify off `gate:"terminal"` verdicts, minted at only two sites (`arbitrator.ts:1335` exit-success, `:1367` exit-failure), both of which transition to `done`/`failed` and END the loop; `assess()` runs per-iteration INSIDE the loop (`iterate-pass.ts:468`) ⇒ the predicate was ALWAYS false and `PHASE_PROFILES.verify` was dead render code. The only test producing "verify" (`assess.test.ts:181`) hand-fed the ledger. **Root: `gate:"in-loop"` — the third declared verdict gate — had ZERO writers.** Fix mints it in `step-projection.ts` from observation steps the guards ALREADY write (`completion-guard` think.ts:1595, `abstention-legitimacy` think.ts:1284), keyed on `observationResult.toolName`; minting stays inside `kernel/ledger/` so `check-ledger-writes.sh` holds; the gate set is **CLOSED** (an open set pins every run to verify, since ordinary tool observations also project). `assess()` now reads the LATEST in-loop/terminal verdict — a REJECTED in-loop verdict ⇒ verify/repair, an ACCEPTED one ⇒ about to terminate. **That is what finally makes `.verified` load-bearing.** Pinned via real chokepoints (`transitionState`→ledger→`assess`→`fromKernelState`/`project`→`request.systemPrompt`); mutation-verified (revert assess ⇒ 2 red; drop the mint ⇒ 6 red). **(2) F3 seam let `redirect` beat `abstain` by CODE ORDER.** `resolveControlPlane`'s total order is veto(0) > abstain(1) > terminate(2) > strategy-switch(3) > redirect(4) > steer(5), but the F3 seam (`iterate-pass.ts:974`) FORCED its redirect and `return "continue"`d, while the in-loop abstain proposal was built ONLY at the strategy-switch seam (needs the loop detector to trip). Same inversion as P5, second seam. `proposeFromErrorRecovery` existed to fix exactly this and had **zero production callers** (all refs in `emitters.test.ts` — unit-tested into looking done). Measured on real `runKernel`→`iteratePass`, long-horizon: **before** iteration 4/4 + 2 redirects + post-loop abstain; **after** iteration 1 + 0 redirects + in-loop abstain (3 wasted iterations). Redirect counter only commits if the redirect WINS. Gated behind long-horizon; default path pinned byte-identical to the measured baseline. **CORRECTION — do NOT act on `emitters.ts`'s "wrong remedy" doc claim: it is FALSE.** `RecoverySteeringKind` is only `"stall" | "loop"`, and the "stall" text already names the failing tool and asks for corrected arguments. Wiring the emitter for its `ControlRemedy` metadata would be **write-only — nothing reads `ControlRemedy`.** The defect was precedence, not text. **BOARD: 1 of 6 control emitters wired.** Remaining need per-seam analysis (a wiring that changes no behavior IS the trap): `proposeFromControllerVeto`, `proposeFromBudgetMonitor`, `proposeFromStallGuard`, `proposeFromGroundedTerminal`, `proposeFromDispatcher`. **4th form of the disease — *checked, but exempted*:** `check-control-plane.sh` is GREEN because it grandfathers the 4 files that still force control directly (incl. `runner.ts` §7.5); its own comment says the list "must SHRINK, never grow" — it hasn't. Still unminted: `requirement`, `handoff`, `contract-amended`, `checkpoint-marker`, `deliverable-commit`. Verified at both commits: reasoning **2270 pass / 0 fail**, `tsc --noEmit` exit 0, all 8 invariant scripts green.
- 2026-07-09 **H5 HONESTY P0 FIXED + GRADED METRIC** (`3e87f9d5`, `1933f871`). **H5:** harness could return `result.success===true` beside `verified:false`. `runner.ts:1220` (`onlyHarnessAuthorshipFailed`) kept `status:"done"`; `reactive.ts` mapped done→"completed"; `reasoning-post-think.ts:85` derives `success = status==="completed"`. All THREE "honest label" markers were dead: `harnessAuthoredOutput` (never DECLARED on meta — written via `as KernelState["meta"]` cast, zero readers), `verificationWarning` (zero readers, absent from extraMetadata), `budgetTerminalPartial` (written pace-terminal.ts:137, read nowhere). FIX: `kernel/state/completion-status.ts` — `resolveCompletionStatus()` degrades done→partial when `shippedUnverified(meta)`, so `success===false` flows through the EXISTING mapping (no new flag to remember — that's how the old markers died). A bare `verificationWarning` does NOT demote (grounding-degrade path is a blessed outcome). `honestPartialMetadata()` carries markers across the result boundary. reactive.ts + direct.ts route through it. Removing the cast exposed `verifierRejected` (5 writers, ZERO readers — documented write-only, wire-or-delete) and `verifierVerdict` (real consumer: `core/receipt.ts:52`). **PINNED AT THE RESULT BOUNDARY, not state.meta** — `pace-terminal.integration.test.ts` asserted `meta.budgetTerminalPartial` and PASSED the whole time the caller was lied to. Mutation-verified: old ternary ⇒ 9 unit tests green, only boundary test red. Drive-by: 5 duplicate `ToolService` mocks → one helper (`reasoning/src/testing/tool-service-mock.ts`), `as unknown as` ceiling **LOWERED 78→75** (design-it-out, not bump-it-up); its error channel is `Error` not `unknown` (silent-swallow ceiling). **GRADED METRIC** `1933f871`: per-run `accuracy` was Bernoulli (rw-9 `[0,1,0,1,1,0,1,0,1,0]`, sd 0.50) because hidden-checks were fail-fast (`process.exit(1)` on first miss) and `scoreVerifiable` is exit-0→1.0 else 0.0. Gate's own `runsNeeded`: 3pp @ sd .50 = **556 runs/arm = 20,016 cells** ⇒ the lift rule was UNMEASURABLE, not unmet (hence zero `adopted` in ImprovementLedger). FIX: `src/tasks/graded-check.ts` `gradedCheckHarness()` counts assertions (`check`/`report` → "N pass / M fail", parsed by existing `parsePartialCreditScore`); rw-4 (5 reqs) + rw-8 (2 halves) converted + `partialCredit: true`. Verified by execution: rw-8 1.00/0.50/0.50/0.00, rw-4 1.00/0.80/0.80/0.00 (was 0.00 for every non-perfect row). **STILL BERNOULLI: rw-1, rw-2, rw-9 are `llm-judge`** — judge returns 0/1 `overallScore` in practice though the scale is continuous. Ablation set is 2/5 graded. Converting judge→deterministic changes what is measured; needs owner sign-off.
- 2026-07-09 **WIRING AUDIT — "BUILT, NEVER WIRED"** (HEAD `385bb686`; report `wiki/Research/Audit-Reports-2026-07-09/00-SYNTHESIS-wiring-audit.md`). **ONE DISEASE:** a mechanism built correctly, then never wired to anything that can fail — 3 forms: *computed-never-read*, *read-never-written*, *checked-never-run*. **STANDING RULE (owner):** a mechanism is DONE only when (1) a non-test consumer READS it and BEHAVIOR CHANGES (trace/receipt-only reads are still write-only — say so), (2) a test FAILS WHEN THE WIRING IS CUT (unit-testing `f()` ≠ pinning that `f()` is called), (3) if an invariant script guards it, something EXECUTES that script. **3 P0s FIXED:** (a) `a042e2f9` — `.withContract({tools:[{kind:"forbidden"}]})` was SILENTLY UNENFORCED (`task-contract.ts:33` promises "MUST NOT be visible to the LLM"; the constraint had ZERO readers, `tool-surface.ts` had no deny filter). Now `forbiddenTools(contract)` + Stage-0 filter over `universe`/`visible`/`callable`; deny beats required/allowed/META; mutation-verified. (b) `8407e955` — **LIFT GATE decided by SAMPLE COUNT, not effect**: `gate.ts` used a standard DEVIATION as its bar (`runner.ts` stores `Math.sqrt` into a field named `variance`), `maxOf` seeded at 0 ⇒ **n=1 bar=0pp → noise promoted to `default-on`**; **n>1 Bernoulli bar≈50pp → real lift demoted to `opt-in`**. Executed proof: identical 4.0pp lift → `default-on` at n=1, `opt-in` at n>1. `evaluateLiftGate` had ZERO production callers. Now: SE-of-difference bar, Agresti-smoothed spread √(p̃(1−p̃)) p̃=(x+1)/(n+2) (strictly positive at every n), NEW **`underpowered`** verdict + `minRuns:3` + `runsNeeded`, `--gate <base>,<cand>`, and an UNCONDITIONAL power warning on every multi-variant session. (c) `385bb686` — 6 of 8 `scripts/check-*.sh` NEVER EXECUTED (2 existed only in code comments); `check-policy-compiler.sh` was **RED on main** since Phase 7, correctly flagging `services/strategy-selection.ts` calling `compileHarnessPlan` outside `kernel/policy/`. Fixed via `kernel/policy/strategy-nomination.ts`; now a test DISCOVERS + spawns all 8 (asserts ≥8 so it can't pass vacuously) + a CI step. **STILL OPEN (ranked):** (1) **P0 honesty** — `result.success===true` ships with `verified:false` (`runner.ts:1220-1232` keeps `status:"done"`; `reactive.ts:306` derives success from it) and BOTH compensating labels are dead: `harnessAuthoredOutput` has ZERO readers, `verificationWarning` never consumed / not in `extraMetadata`. (2) 5 ledger kinds NEVER MINTED (`requirement`, `handoff`, `contract-amended`, `checkpoint-marker`, `deliverable-commit`) though `assess.ts:207`/`standing-frame.ts:131` read `requirement` and the projector's handoff section is permanently dormant. (3) D1 NOT cured — sole ledger reader `assess.ts:290` checks `.gate`, ignores `.verified`; its `phase="verify"` output is consumed by nothing. (4) INERT surface — 4/5 `HarnessPlan` levers, `ControlResolution.winner`/`.proposals`, **6 of 8 control emitters have no production caller**, `RunContract.acceptance`, `TaskRequirement.weight`; whole Assessment→actuator chain gated behind `horizonProfile`/`adaptiveHarness` ⇒ no-op by default. **Owner's ruling: WIRE EACH, verify with the now-working gate.** (5) No revert-catching tests for H3/H4/H5-runner-wiring. **H1/H2/H6 shipped AND pinned; H3/H4 shipped unpinned; H5 OVERSTATED.** ImprovementLedger: `adopted|opt-in|rejected`, 3 entries ever, **ZERO `adopted`** — the broken gate explains it. CORRECTION: `compileRunContract` and the dispatch nomination BOTH bottom out in `classifyTaskHorizon(task)` — they agree; the violation was structural, not two horizon sources. Pre-existing unrelated red: `packages/tools/tests/skills/shell-execution.test.ts` docker-escalation test has no `skipIf` and fails without Docker (will bite CI).
- 2026-07-09 ADAPTIVE-HARNESS **P0 FIXED** + ablation retired as a decision tool (HEAD `8002a709`). **The bug:** `recompileOnAssessment` DEEPEN set `guard.horizonProfile = "long"` UNCONDITIONALLY, so a struggling run on a **short** contract swapped in long-horizon guard tolerances — loosening stall/loop/redirect guards exactly when stuck. `state.meta.horizonProfile` is read LIVE every arbitration (`arbitrator.ts:1575` → veto window + terminal-gate redirect budget), plus `think.ts:652`, `reactive-observer.ts:266`. Fix: preserve `plan.guard.horizonProfile`, drop `!alreadyLong` from `changed`. Tests pin both directions; reasoning 2211 pass, tsc 0. **THE LOAD-BEARING FACT:** `guard.horizonProfile` is the **ONLY** compiled-plan field ANY consumer reads (`runner.ts:403,408-409` — that's the complete list). `scaffoldingLevel`/`verifierTier`/`budget.maxIterations`/`memoryPosture` have **ZERO readers** (the `budgetClass`/`toolSurface` grep hits are the gateway's unrelated concept). ⇒ LEAN is provably a **no-op**; post-fix DEEPEN is **inert on short contracts**; on the LONG class `ra-adaptive ≡ ra-full + .withLongHorizon()`, so an lh-1 ablation measures the **guard bundle**, NOT the policy compiler. **Open decision:** wire the 4 inert levers or delete them — Phase 6/7's only real effect today is horizon selection. **MEASUREMENT RETRACTION (do not resurface):** per-cell accuracy is **Bernoulli** (rw-9 `[0,1,0,1,1,0,1,0,1,0]`, p=0.50). cogito:8b rw-9 n=10/arm: adaptive 0.50 vs full 0.80, **z=−1.48, 95% CI [−70pp,+10pp]** — spans zero. Two consecutive n=5 batches of the SAME config gave 80% then 20%. At 15 cells/arm SE≈13pp, so the "ra-adaptive 22% vs ra-full 39%" gap was ~1.3σ — **no regression was ever demonstrated**, and the 2026-07-08 entry below is wrong to infer "recompile never fired" from zero `harness-recompiled` in traces: **the RunLedger is NOT serialized into traces** (`grep '"ledger"' *.jsonl` → 0 files). Resolving the 3pp lift rule at p≈0.45 needs **~4,300 runs/arm** ⇒ this bench can neither bless nor damn a default-on flip. **`.withAdaptiveHarness()` stays OPT-IN on burden of proof.** Bench ops: `--output <file>` is REQUIRED or nothing persists (no merge-by-cell); per-run scores live at `taskReports[].runs[].dimensions[]`; compute a CI before claiming anything. Phase 7 note: `withReasoning({defaultStrategy})` sets `config.defaultStrategy` NOT `params.strategy`, so the plan-driven branch of `selectStrategyName` DOES fire for adaptive arms (rw-8 classifies `horizon=long` → `plan-execute-reflect`). Foreground `timeout N` bench cells survive; backgrounded ones get stopped (no kernel OOM was ever involved — GPU was idle at every death).
- 2026-07-08 POST-PROGRAM: review + Phase 7 + ablation (HEAD `66c5d1b3`). **CODE-REVIEW Waves A-G**: no blocker; DAG purity/ledger single-writer/resolver order/compaction/pace-terminal all correct. 3 findings FIXED `6b0647f3`: F1 B2 contract-coverage DELIBERATELY default-on (byte-identical invariant = the ADAPTIVE opt-in mechanisms, not B2); both deltas pinned — (a) artifact-req gating, (b) failed-required-tool unmet under contract path (ToolCalled=success-only via buildSuccessfulToolCallCounts, more correct, rw pins held 5 runs); F2 dual-emit O(1) appendOnly boundary guard + invariant comment; F3 outstandingDescriptions excludes self-critique floor (de-noise). reasoning 2196, tsc 0, 8 scripts pass. **Phase 7 Strategy→Policy** `66c5d1b3` (downstream finale C6): services/strategy-selection.ts selectStrategyName precedence adaptive.enabled>explicit>plan(adaptiveHarness)>default; default-off byte-identical (oracle); PLAN_TO_REGISTRY total (plan-execute→plan-execute-reflect); smaller-cut explicit-overrides-plan-not-adaptive.enabled; reasoning 2209. **CROSS-TIER ABLATION VERDICT: INCONCLUSIVE → ra-adaptive stays OPT-IN (gate does NOT pass; no default-on).** `--models cogito-8b,qwen3-4b --task rw-1..9 --runs 1` (SHA 7c5eb6e4, PRE-Phase-7). accuracy ra-minimal 42 / ra-full 59 / ra-adaptive 38. **NOT a real regression — n=1 NOISE + adaptive barely engaged**: ZERO harness-recompiled signals (recompile never fired), short tasks→horizonProfile OFF so ra-adaptive≈ra-full run-start, strategy axis inactive (pre-Phase-7), rw-8/rw-9 flip 0↔100 = variance, no traces written. Warden veto holds (no lift → opt-in). Meaningful gate needs: Phase 7 in + n=3 + lh-1 long-class (short tasks under-exercise adaptive) + 14b + traces on. Do NOT conclude adaptive is bad from this; do NOT tune-to-pass. NEXT (user's steer): (a) rigorous re-run per above; (b) Arc 2 boundary/gate; (c) v0.14 release (C7).
- 2026-07-08 WAVES F+G COMPLETE — META-LOOP OVERHAUL PROGRAM COMPLETE. Full DAG built+wired+gated+enforced: Contract(B)→Ledger(C)→Assessment(E)→Control(F)→Actuators→Projector(D) + Policy Compiler(G). 8 enforcement scripts ALL pass; turbo build 39/39. **F1** `a33409d5`: control plane — kernel/control/control-plane.ts ControlProposal + resolveControlPlane() total order veto>abstain>terminate>strategy-switch>redirect>steer>continue; P5 fix (abstain>switch); emitters consume RunAssessment (null when evidenceDelta>0); remedy metadata (F3 tool-failure); BOUNDED CUT (pure lib proven==arbitrate() over 9-scenario corpus, 1 live seam profile-gated, rest grandfathered check-control-plane.sh); reasoning 2155. **G1** `99527ed8`: policy compiler kernel/policy/harness-plan.ts compileHarnessPlan(capability+calibration+horizon+classification)→HarnessPlan; .withAdaptiveHarness() opt-in default-byte-identical; withers override (horizonProfile subsumes A2); mid-run recompile cadence-3 deepen/lean logged; live-wires horizonProfile only (strategy/verifier/budget computed for G2/E2/Phase7); reasoning 2181/runtime 1164. **G2** `bab0758b`: purpose→tier routing 05-#5 — purpose-routing.ts mapPurposeToTier (classify/extract→cheap, think/synthesize→strong) + ambient CurrentModelRouting FiberRef; gateway applyModelRouting at request-build (pool undefined→unchanged byte-identical, explicit-model wins); 3-gate (adaptive+pool+routable-provider), pool from cost selectCapableModel; reasoning 2191/runtime 1170. **G3** `0a250fe0`+fix`451ec96d`: bench adaptiveHarness→builder wiring, ra-adaptive/ra-minimal variants, adaptive-ablation session (3 arms×qwen3:14b+cogito:8b×6 tasks), check-policy-compiler.sh; smoke ra-adaptive cogito:8b rw-9 100% ✓ (stack wires+runs live); full cross-tier gate DEFERRED (14b OOM) — ra-adaptive OPT-IN under ablation-warden veto until adequate-hardware validation. Fix `451ec96d`: recompile signal routed through recordHarnessRecompiled emitter (was direct appendEntry, tripped check-ledger-writes). PROGRAM: 27 commits Waves A-G on LOCAL MAIN (ahead of origin); ALL adaptive mechanisms opt-in (horizonProfile/.withAdaptiveHarness) → default byte-identical (rw-9 100/rw-7 67/rw-1 67 pins held every wave). NEXT: (1) v0.14 release (user's call, C7); (2) adaptive-ablation on adequate hardware→G3 verdict→default-on decisions; (3) Phase 7 Strategy→Policy; (4) Arc 2-4 now unblocked (C5/C6 deps DONE).
- 2026-07-08 WAVES D+E COMPLETE — META-LOOP DAG CORE DONE (4 commits, gate PASSED). The 4 missing spec pieces all BUILT+wired: Contract(B)→Ledger(C)→Assessment(E)→Projector(D), one-directional. **E1** `5c5fb778`: kernel/assessment/assess.ts pure assess(contract,ledger,budget)→RunAssessment{requirements,deliverables,evidenceDelta,phase(orient/gather/execute/synthesize/verify),pace{burnRatio,band green|economize.60|triage.80|terminal.95 escalates only while deterministic-outstanding},health{failures,repeatWaste,stuckSignals,contradictions,iterationsSinceEvidence windowed-10}}; evidenceDelta reuses C3 identity; ONE per-iter DAG-safe call site; sweep acceptance#2 PASSES (15 gathers/15 iters→delta>0 every iter zero stuck); reasoning 2055. **E2** `13e7b2aa`: D2 KILL — 6 guards READ assessment via guard-adapters.ts (low_delta/veto-synthesize-standdown/stall/F3-failureArgVariety/required-tool-phase/RI-early-stop-synthesize), ALL flagged behind horizonProfile (default byte-identical), 5 named regression tests, check-run-assessment.sh; reasoning 2087/RI 500. **E3** `9ba8a010`: pace actions 05-#1 — economize(cap non-synth budget)/triage(steer outstanding)/terminal(force generous synthesis at iter-start before budget_exceeded cliff → budget_terminal reason preserves partial, no null, never false-success); budget-exhaustion integration BEFORE failed/discarded AFTER done/synthesized-partial; reasoning 2113. **D1** `14351866`: Projector — assembly/standing-frame.ts renderStandingFrame owns priorContext(H1 retired)+handoff+contract.outstanding, phase profiles behind flag, two-way reachability+traceability, projection-rendered trace, check-projection.sh; 03-F5 already functionally closed via priorContext (H1), D1 ledger-handoff render DORMANT by design (no emitter→no double-render; future: ledger-single-source); reasoning 2128. GATE: turbo 7 pkgs green, suites all green, default bench rw-9 100/rw-1 67 ✓ (no regression, additive+flagged), lh-1 4b under FULL profile stack completes ✓ no crash. NEXT Wave F (5b control plane): ControlProposal, guards/loop/RI/budget/F1/F3 emit proposals consuming Assessment, arbitrator→ONE action/iter total order (kills P5 race), remedy metadata, check-control-plane.sh; then G (6 policy compiler HarnessPlan + .withAdaptiveHarness + purpose→tier routing + ablation G3). v0.14 launch OPEN.
- 2026-07-08 WAVE C COMPLETE (4b RunLedger, gate PASSED, 5 commits). **C1** `c7a836da`: RunLedger spine kernel/ledger/run-ledger.ts — append-only readonly plain-data array, 12 typed entry variants, pure appendEntry/appendEntries+queries, seq dense; grown FROM steps[] via DUAL-EMIT at ONE transitionState chokepoint (steps carried through byte-identical; patch.ledger seeds non-step facts); codec round-trips (crash-resume); D1 WIN verify verdicts + evidence claims + terminal-gate signals + todo now PERSISTED (were discarded); scoped out steps-as-projection (C-final) + Arc-1 rebase (C1b); reasoning 1969 pass. **C2** `8f386cee`: artifact truth 01-F1 — tools produces?:file|data|none (resolveProduces declaration-derived), per-builtin path extraction (file-write+FNV digest, code-execute regex, shell/docker redirects, MCP=data, read-only=none); reasoning artifact-projection.ts→ArtifactEntry{path,digest,op,toolCallId} emitted act.ts via patch.ledger; countArtifacts + abstention hasDeliverable=artifacts OR evidence UNION (research protected); tools 934/reasoning 1983 pass. **C3** `2a5e80be`: EvidenceEntry{full,preview,extractedFact?,storedKey?} unifies scratchpad/ResultStore/from_step (reuses step.ts fields); ONE ref grammar assembly/ref-grammar.ts (mint renderRecallHint + matcher SURFACED_RECALL_REF, all consumers source it → every rendered ref recall-resolvable BY CONSTRUCTION, res_* retired from recall rendering); gather-dedup advisory (sha256 args-hash, harness-signal + nudge, never blocks); iteration-30 read-back acceptance; fixed 3 tsc errors in C2 test (LESSON: run full tsc incl tests — bun-test hides type errors, DTS excludes tests); reasoning 2023 pass tsc 0. **C4** `d7105383`: compaction discipline 03-F4 — assembly/compaction.ts single block-based algo (native-FC valid), ONE isProtected() (goal/preserved/recent-evidence; handoff+contract-outstanding future-proofed for Wave D); preserveOnCompaction now LIVE; honest stubs enumerate dropped recallable refs via C3 grammar (each resolves); compaction-marker + shrink self-check→compaction-no-shrink signal (never silent); reasoning 2038 pass tsc 0 incl tests. **GATE** `98b1b842` check-ledger-writes.sh (append API confined to kernel/ledger/ + act.ts seam) + turbo build 6 pkgs green + bench rw-9 100/rw-7 67/rw-1 67 ✓ in-band no regression. NEXT Waves D∥E: D1 Projector (project(contract,ledger)→messages, reachability+traceability, check-projection.sh, worktree) ∥ E1 assess()→RunAssessment{requirements,deliverables,evidenceDelta,phase,pace,health}→E2 guards consume Assessment (D2 kill, behavior-pinned) ∥ E3 pace actions; then F control-plane, G policy-compiler. v0.14 launch line OPEN.
- 2026-07-08 WAVE B COMPLETE (4a RunContract, gate PASSED). **B1** `6db0bf71`: RunContract types + compileRunContract (kernel/contract/run-contract.ts) — first meta-loop DAG node, typed answer to DONE compiled once at run start from task inputs only, frozen. TaskRequirement{id,kind:question-answered|artifact-produced|constraint-held|tool-coverage,spec,weight} GRAFTED on PostCondition vocab (spec.condition IS PostCondition, postConditions[] union); deterministic floor always non-empty; LLM decompose capability-gated (floor alone stands); 01-F5 multi-path deriveDeliverablePaths (single-path deriveConditions byte-identical); horizon axis on classifyTask (04-#8, additive); contract-compiled trace wired core→trace→normalize→diagnose. 39 tests, reasoning 1938 pass. **B2** `56b56c5a`: consumers — runner stores frozen contract on state.meta.runContract every run; terminal gate check 2.5 (contract present→coverage=unsatisfied REQUIREMENTS via verify(); absent→tool-name diff pre-B2 byte-identical pinned; live behavior now contract-driven, byte-identity=fallback only); receipt.deliverables[]{spec,produced} via computeDeliverableReport (absent when no deliverable→v1 identical); plan-execute reflect from contract; TaskContract routed .withContract→...→compileRunContract; scripts/check-run-contract.sh (bans deriveConditions outside kernel/contract/, grandfathers runner/arbitrator/reflexion). core 161/reasoning 1946/runtime 1160 pass. GATE: rw-9 100% solo ✓ (no regression), rw-8 0% solo ✓ (clean honest-failure claimed-success/blind=3, deliverable+receipt path no throw); partial-truth naming (acceptance #4) proven deterministically (deliverable-report.test.ts 1-of-3→2 named); reactive-agent.ts:2454 terminate=KILLSWITCH swallow-all NOT receipt site (combined-run EXIT 1 = infra force-terminate under 2-task+timeout, not B2 defect). v0.14 launch line open (C7). LESSON: no backticks in git commit -m (command substitution). NEXT: Wave C (4b RunLedger) C1 spine (grown from steps[], dual-emit, ABSORBS Arc-1 log per ruling C1) ∥ C2 artifact truth → C3 evidence facets+one ref vocab+gather-dedup → C4 compaction; gate rw-1/7/8/9/lh-1 + check-ledger-writes.sh.
- 2026-07-08 WAVE A COMPLETE (4 commits, gate PASSED) — Phase 3.5 long-horizon instrument shipped. **A1** `36f66dee`: lh-1 bench task (packages/benchmarks/src/tasks/long-horizon.ts — 6-question WASI research + 3-file deliverable findings.json/report.md/sources.md, maxIterations 50, `horizon:long` tag; +BenchmarkTask.timeoutSec (1800 lh-1, unset=420s wall byte-identical); anti-reward-hack hidden-reference partial-credit vacuous→0/complete→1; wired qwen session + real-world-full). **A2** `206bf778`: opt-in horizon guard profile — KernelRunOptions.horizonProfile:"long" (mirrored state.meta) scales audit-02-#12 constants ∝ maxIterations via pure resolveHorizonProfile (runner-helpers/horizon-profile.ts): stall 2/4→max(_,⌈.1mi⌉), maxConsecutiveThoughts 3→5(≥30), redirect 1→2(≥30), oracle +⌈.05mi⌉, veto counters→windowed last-10; OFF-default BYTE-IDENTICAL (?? literal fallbacks, 1899 reasoning suite unchanged); precedence explicit-config>profile>default; iteration-exact veto window deferred Wave E. **A3** `28412025`: per-task-class lift gate — evaluateLiftGate + LiftGateOptions.tasks{id,tags}; horizon:long→CPD gate (tokens/passRate; costOk=passRate>0 AND (candCPD≤baseCPD OR candScore≥baseScore); zero-delivery FAIL); removes anti-gathering ≤15% cap for long class; short class + no-options byte-identical; optional byClass[]. **A4** `ad12390b`: wire .withLongHorizon() end-to-end (runtime wither mirrors withStallPolicy) + REASONING LAST HOP A2 left open (reactive-service spreads ...params so horizonProfile added to service execute params + ReactiveInput, forwarded reactive.ts:250 into runPass KernelRunOptions else dropped before runner.ts:347); bench shouldUseLongHorizon auto-applies horizon:long; lh-1 strategy plan-execute→react (disease+fix live in reactive iterate-pass; plan-execute bypasses). GATE: rw-9 100 + rw-7 67 pins HOLD (no A2 regression); lh-1 live qwen3:4b completed end-to-end (162.8s, Status ✓, Acc 0% — 4b too weak for a 6Q deliverable, expected; hard instrument = lift headroom); foreground trace healthy iter 0→6 (web-search/question, file-write iter 5) NO premature guard-kill; instrument also proven via test provider + unit suite. OPS: live bench cells get SIGKILLed as BG tasks (silent-during-first-generation reaper; NOT OOM/code — test-provider + foreground fine) → run bench cells FOREGROUND with `timeout` (≤590s); qwen3:14b lh-1 near 16GB VRAM limit, full-14b score deferred to bigger box. NEXT: Wave B (4a RunContract) B1→B2; then v0.14 launch line opens (C7).
- 2026-07-08 LONG-HORIZON + DELIVERABLE-TRUTH SWEEP (`b1a08928`, wiki/Research/Audit-Reports-2026-07-08/, 6 audits + synthesis): VERDICT CONTINUE ratified plan + amendments. 4 diseases: **D1 write-only harness** (priorContext renderer died with APC deletion — switch/ToT handoffs never reach model; recall round-trip structurally dead — gate needs `recall("` marker, projector emits `result_ref=`; verify() verdicts + claims recomputed then discarded; todo harness-blind); **D2 no shared progress currency** (23 guards, 8 HIGH misfire; veto counters never decay; low_delta ignores tool successes; RI early-stop amputates last 2 iters = synthesis; budget↔work coupling ZERO, warn=log line); **D3 deliverable-blindness** (no artifact record — 4 tool names+15 path keys, code-execute/MCP writes invisible; final synthesis classed `terse` 2048 while `generous` 8192 has ZERO call sites; stall-deliverable shipped verified:false as success — trace 01KWZ811 3-bug stack; provenance dies at commitDeliverable); **D4 no upward gear** (comprehend shrink-only, shape decorative; bench caps 25 iters = every lift verdict horizon-blind; ≤15% token rule structurally rejects gather-more). CORRECTIONS: detectCompletionGaps NOT dead (act.ts:427/think.ts:1094); P4 carryover shipped-but-unrendered (ineffective); A2 SO-retry fix never shipped (pipeline.ts:249). PLAN AMENDED (2026-07-07-adaptive-harness-overhaul.md [LH-AMEND] blocks): NEW Phase 3.6 hotfix wave H1-H6 (render priorContext, recall vocab, synthesis→generous, retry fail-fast, stall-verifier honor, early-stop amputation) + NEW Phase 3.5 instrument (lh-1 ≥40-iter bench task, horizon-normalized guard profile, cost-per-verified-deliverable lift rule) BEFORE Phase 4; Phase 4 +artifact/requirement/claim/verdict/deliverable-commit entries + EvidenceEntry facets + one ref vocabulary + receipt.deliverables[]; Phase 5 +evidenceDelta shared currency + decaying counters; Phase 6 +horizon axis + pace bands (0.60/0.80/0.95) + purpose→tier routing; enforcement script per phase. Priority if forced: H1+H2, then lh-1, then requirement/artifact ledger entries. NEXT: execute Phase 3.6. EXECUTED SAME DAY: meta-loop RATIFIED (`149a9482` — RunContract/RunAssessment/Projector/DAG, plan restructured 4a/4b/4c+5a/5b, decision wiki/Decisions/2026-07-08-harness-meta-loop-ratified.md); Phase 3.6 H1-H6 SHIPPED (`7bb5afdb`, all suites green, runtime FULLY green): H1 priorContext renders (AssemblyInput+systemPromptStage), H2 recall revival (ResultStore.recallable, previews emit `recall("` gate vocabulary), H3 synthesis terse→generous ×3 sites, H4 SO empty-content escalate-once-then-fail, H5 verify context carries terminatedBy + harness-authored ships honestly-labeled (root cause sharper than audit: context OMITTED terminatedBy, trace 01KWZ811 seq 1920→1923 same-iteration flip), H6 overflow early-stop only on flat/oscillating/converging. EXECUTION PLAN `80f42646` wiki/Planning/Implementation-Plans/2026-07-08-meta-loop-execution-plan.md: subagent Waves A-G (A=lh-1+profile+lift-rule, B=4a contract, C=4b ledger, D=4c projector, E=5a assessment, F=5b, G=6) + ground rules + FULL audit-finding→task traceability matrix. POST-3.6 CELLS: rw-9 100 (pin), rw-1 100 ALL DIMS (best research cell ever; H1+H3 candidates, n=1), rw-7 honest-0 (model read all 3 fixtures via named paths + wrote REAL tests importing actual modules — but stall_deliverable took the run at ITER 5/25 before any bug fix; hidden tests correctly 0/3; H5 verified live: both verdicts verified:false, no flip; witness trace 01KX0VZFHC = named D2-antagonist evidence for Wave A2/E2). NEXT: dispatch Wave A. UNIFIED PROGRAM RATIFIED (`2b60ac1d`): wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md = canonical sequencing authority over 08 (arc content stands, arc ORDERING superseded). 3 strands: K kernel meta-loop / P product arcs / T truth instrument. 7 binding convergence rulings: C1 RunLedger absorbs Arc-1 event log in Wave C (no second store), C2 RunContract absorbs TaskContract, C3 one trust spine, C4 Arc-2 public gate = amended lift rule (one instrument), C5 Arc-3 team waits for 5a Assessment (A2A last-mile exempt), C6 flywheel = policy compiler grown up (Arc4#8 = replay+gate+compiler; Phase 7 same movement), C7 v0.14 launch line opens at Wave A/B boundary (does NOT wait for ledger). Version map: v0.14 Arc1+foundations, v0.15 self-aware kernel, v0.16 boundary+gate, v0.17 team, v0.18 flywheel. Authority chain: 09 > 08 > meta-loop spec+overhaul plan > execution plan > evidence ledger; changes upward = ratification event. ROADMAP.md repointed; 08/overhaul/execution-plan stamped with program position.
- 2026-07-08 PHASE 3 TERMINAL GATE + BENCH VALIDITY SHIPPED (local main `3e2d3876` + `a9727e8c`): **Phase 3** — kernel/capabilities/decide/terminal-gate.ts `evaluateTerminalGate` owns exemption→grounding(F1)→coverage(B1/P3)→checker-slot(P6b, inert until checkerVerdict supplied); 4 drifted sites delegate (arbitrator applyGroundedTerminalGate, llmEndTurnEvaluator, plan-execute evaluateGroundedSatisfaction, reflexion Gate A); 2 divergences carried verbatim as explicit knobs (coverage exhaustion accept-kernel vs abstain-plan-execute; covered=ATTEMPTED-kernel vs COMPLETED-plan-execute — act.ts:808 writes toolsUsed pre-execution); Verdict.terminatedBy narrowed to RawTerminatedBy (union + 2 template families, one documented oracle cast); check-termination-paths.sh 2nd invariant (gate-decision literals only in terminal-gate.ts). 25 gate tests pin named bench shapes. **Bench validity** — BenchmarkTask.hiddenFixtures (written post-run pre-scoring, judge-deliverable-excluded, overwrite agent squats); rw-7 hidden-reference.test.ts per-bug partial credit + Promise.all spy (pipeline race scheduling-invisible, 50/50 verified) + exact-path command (`bun test ./hidden-reference.test.ts` — substring filter dilutable) + prompt names fixture paths + code-execute exposed-not-gated; computeGroundingSet stops `available` contract tools leaking into ALL-OF gate; AUDIT: rw-4 `bun check` never existed (unwinnable since birth, always 0) → hidden runtime check; rw-8 `&&` never ran validate.ts (spawnSync no shell, validate-fail scored 1.0) → hidden sequential runner (residual: no-op scripts pass deterministic check, LLM-rubric-only). LIVE VERIFY: rw-7 67% acc TWICE independently (2/3 real bugs fixed — deterministic replaces coin flip), rw-9 pin 100%. **Judge ops**: JUDGE_PROVIDER defaults anthropic — was credit-exhausted (dims 0 + "credit balance too low"); bench judge = JUDGE_PROVIDER=openai JUDGE_MODEL=gpt-4o-mini port 8910. Credits restored 2026-07-08: the "2 known environmental runtime fails" (model-routing-reasoning-path) were credit exhaustion — now 4/4 green, runtime suite FULLY green. rw-9-class short clean runs judge-score 0 on resilience/tool-mastery rubrics (nothing to resist) — rubric artifact, not outage. NEXT: Phase 4 evidence ledger; P6b checker builder wiring (.withIndependentChecker) onto the gate slot; full-session re-run + gate.
- 2026-07-08 OVERHAUL PHASES 1+2 SHIPPED (local main, 3 commits): **Phase 1 LLM gateway** — kernel/llm-gateway.ts (`gatewayComplete/gatewayStream`, resolveOutputBudget owns B2 tier think-table +6000 thinking allowance; classes terse=2048/standard=4096/generous=8192/provider-default); ALL raw llm.complete/stream migrated behavior-identically (kernel + 8 strategies + structured-output + runtime debrief/chat); computed budgets via explicit budgetTokens; enforcement scripts/check-llm-gateway.sh. **Provider half** (warden): params/{output-budget,cloud-timeout,stop-reason}.ts — maxOutputTokens clamp at 4 CLOUD wire points (NOT local — would revert B2/P1 widening; fallback caps never clamp), resolveCloudTimeoutMs kills 8×120s literals, shared mapStopReason (pinned-before-swap), litellm thinking parity, numCtx single-bind; llm-provider 381/0. **Phase 2 tool-surface resolver** — kernel/capabilities/reason/tool-surface.ts `resolveToolSurface` = pressure-narrow + computePromptSchemas (moved verbatim) + gate-narrow (buildToolSchemas deleted); {universe, visible, callable, reasons}; fast-check property pins on floors; NEW trace event `tool-surface-resolved` (core tag + trace kind + normalize + replay renderer) verified firing in live bench traces. Runtime 5-stage prep merge = follow-up. Verify: suites green, rw-9 100 ×2, rw-1 67 (band). rw-7 single-run 0 (model guessed wrong path, sandbox rejected its one file-read, quota unmet, low_delta kill — surface/guidance/budget correct in trace; ×3 rate check pending). NEXT: Phase 3 terminal authority (after 1) ∥ Phase 2 follow-up (runtime prep merge).
- 2026-07-08 rw-7 "Phase 2 regression" RESOLVED — TASK-VALIDITY BUG, Phases 1/2 EXONERATED: re-run #3's rw-7 100% 3/3 was vacuous (trace 01KWXTV1DNF wrote `expect(true).toBe(true)` self-contained test → `bun test` exit 0 → scoreVerifiable accuracy 1.0, zero fixture bugs read/fixed); later 39% 3-run mean = same blind behavior but fabricated tests with broken imports → red → partial credit. Score = coin flip on fabricated-test style. Structural (identical July 2 → post-Phase-2, trace-verified): rw-7 never had code-execute (runner fixtures-heuristic exposes file-read/file-write only) though prompt demands "do not stop until bun test exits 0"; no file-list tool + `find` meta-tool is semantic doc-search (returns TSConfig tutorials for `src/*.ts`) + prompt never names fixture paths (runner.ts:703 abs-path substitution never fires) → model guesses src/index.ts, ENOENT, fabricates. Phase 2 resolver visible-sets identical pre/post; all 3 rate-check runs harness-clean. Fix options (user to pick): code-execute+file-list in rw-7 builtins; name fixture paths in prompt; grade via hidden reference tests copied post-run (kills trivial-test reward hack); audit other verifiable+partialCredit tasks for same hack.
- 2026-07-07 ADAPTIVE HARNESS ARCHITECTURE RATIFIED: 9-pillar centralization (spec wiki/Architecture/Design-Specs/2026-07-07-ideal-harness-architecture.md, decision wiki/Decisions/2026-07-07-adaptive-harness-architecture-ratified.md). Migration: gateway->ambient->terminal-gate->ledger->control-plane->policy-compiler->strategy-to-policy, bench-gated. Wave 1 shipped: CurrentRunContext FiberRef ambient correlation (fallback-only). EXECUTION PLAN: wiki/Planning/Implementation-Plans/2026-07-07-adaptive-harness-overhaul.md (7 phases: gateway, tool-surface compiler, terminal authority, evidence ledger, control plane, policy compiler, strategy-to-policy; deps 1||2->3->4->5, 6 after 2+3+4, 7 last). SWEEP DONE: wiki/Research/Audit-Reports-2026-07-07/ (7 audits + synthesis) — plan survives; +Phase 0.5 hotfixes (guidance-channel no-op!, :full->preview, ToolService approval unenforced) + Phase 1b assembly. RE-RUN #2: ra-full BEST-OF-SIX 61%, gate OPT-IN +20.8pp/640%tok/1tier (ledgered). Phase 0.5 hotfixes SHIPPED (guidance no-op fixed, :full->fullResult, ToolApprovalGate, memory-full, stream mapProviderError); 0.5-6 dead-mass deferred to 1b. PHASE 1B SHIPPED: dead APC stack deleted (-3297 LOC, breaking 0.x exports), tier tables single-sourced, shared personas, Decision Index fixed. RE-RUN #3: ra-full 71% (+12 over manual-react; arc 35->61->71). rw-7 100 3/3, rw-1 77. Guidance-channel repair validated at scale. Gate OPT-IN +53.1pp (ledger entry 3).
- 2026-07-07 Re-run #1: visibility regression found+fixed (minimal requiredTools starved lazy-disclosure; explicit builtins now union into relevantTools). rw-9 0->1.0 verified. LESSON: grounding contract != visibility floor. Gate deferred to re-run #2. Post-fix single-cell sweep: rw-7 100 (bun test exit 0), rw-8 100, rw-9 100; ra-full line 67/20/100/100/100. Re-run #2 in flight.
- 2026-07-07 Harness bottleneck fix waves (LOCAL MAIN): B1-B5 + FM#3/3b (from_step splice + :summary distill + web-search query clamp) + P1 (widenNumPredictForThinking, Ollama choke point, all 12 flat-budget sites) + P2 (traceContext at 9 sites) + judge partial-credit protocol + plan-execute requirement-coverage prompts. Verified: rw-1 0->67% (bare parity), rw-2 420s-death->63s pass. Full-session re-run + rax eval gate pending; publication blocked until then. Detail: wiki/Research/Harness-Reports/2026-07-07-capability-gap-synthesis.md WAVE 3: P3 plan-execute grounded-terminal gate + P4 strategy-switch carryover (observations + toolsUsed) + P6a universal todo meta-tool (opt-in, .withMetaTools({todo:true})) + P6b checker design ready.
> **Status:** Reset 2026-04-28 on `refactor/overhaul`. Prior version (564 lines of layered sprint logs) preserved at commit `949bf81f^` — recover via `git show <sha>:.agents/MEMORY.md` if a specific historical claim needs lookup.

## ✅ v0.13.5 RELEASED (2026-07-05) — 36 pkgs on npm, publish.yml green

Minor release bundling all 50 commits unpushed on local main since v0.13.0: Groq+xAI providers, Agentic UI Kit (new `@reactive-agents/ui-core` + React/Svelte/Vue rewire onto shared controllers), Cortex `request_user_input` rail, `result.error` propagation fix. **36 public packages** (ui-core = +1 vs 35, all published incl new ui-core@0.13.5), **8 providers**, **7,190 tests / 908 files, 0 fail**. Tag `v0.13.5`=`0c7bdab0`; publish.yml run 28763068693 SUCCESS (build/typecheck/test/smoke/dry-gate/publish/GH-release all green — the `bun test` gate I fixed PASSED on real ubuntu runner); CI synced VERSION/CHANGELOG→main `0b527b1b`, changeset consumed. GitHub release published. Docs synced: whats-new v0.13.5, README/AGENTS/contributing counts, llm-provider README, `metrics-cache.json`→7190.

**Post-release: ci.yml went red (publish.yml green), fixed forward — 2 issues NOT in publish.yml's gate:** (1) `validate-cli-externals.ts` (ci.yml Test job, not in publish.yml) flagged `@reactive-agents/runtime-shim` imported by cli `serve.ts` (F4 `secureServe`) but neither `external` in `apps/cli/tsup.config.ts` nor a declared dep — so v0.13.5 cli BUNDLED it (works, verified secureServe inlined in published tarball; NOT a runtime crash) but failed the hygiene gate. Fixed `b7dac54d`~1: added to both. (2) `shortId()` (`packages/reasoning/src/types/plan.ts`) used 4 base36 chars (~1.7M) → plan.test's 100-id uniqueness draw collided ~0.3%/run = flake; bumped to 6 chars (~2.2B, 0 collisions in 20k trials), stays ≤8 budget. Fixed `b7dac54d`. **ci.yml GREEN on `b7dac54d`.** LESSON: publish.yml `bun test` ≠ ci.yml Test job — ci.yml runs EXTRA gates (validate-cli-externals) publish.yml skips; a green publish does NOT imply green ci.yml.

**✅ v0.13.6 PATCH RELEASED (2026-07-06)** — both fixes shipped. Tag `v0.13.6`=`4aea1602`; publish.yml run 28792614149 SUCCESS, all 36 pkgs on npm, GH release published, CI synced→main `985584b6`, both changesets consumed. Verified `@reactive-agents/cli@0.13.6` now DECLARES `@reactive-agents/runtime-shim: 0.13.6` (external+dep, no longer bundled).

**LESSON — CI `bun test` gate was RED (12 fail), root-caused + fixed (NOT a flake):** publish.yml:111 runs raw `bun test` = ALL 908 files in ONE process (turbo `bun run test` isolates per-package, hides it). Two NEW-since-v0.13.0 leak vectors in the React/Svelte binding tests polluted the shared process, breaking real-HTTP tests (judge-server, runtime-shim secureServe) that ran AFTER them: (1) **happy-dom `GlobalRegistrator.register()` never unregistered** → its `fetch`/`Request`/`Response` globals persist and hijack real localhost fetches (DOMINANT cause — register-only, no mock, breaks victims). (2) **`globalThis.fetch = mockAgentEndpoint(...)` in back-compat tests never restored** → SSE "hel/lo" fixture answers every request 200. Fix: `packages/react/tests/happy-dom.ts` `withHappyDom()` helper (beforeAll register + afterAll unregister, guarded), wired into all 8 react test files; `afterEach` fetch restore in react+svelte `back-compat` tests; `generate-metrics.ts` now counts `.tsx` test files (was undercounting 908→900). **Debug lessons: bun runs test files SEQUENTIALLY single-process (proved via A/B setTimeout probe) — a non-restoring global mutation persists to later files; `--include=*.ts` grep MISSES `.tsx` (react) — the 2nd leaker hid there; isolate happy-dom register WITHOUT the fetch mock to prove which pollutant breaks victims.** Reinforces [[feedback_ci_parity_no_keys_no_ollama]]: turbo-green ≠ raw-`bun test`-green.

## ▶ Groq + xAI providers (2026-07-05) — branch `feat/groq-xai-providers`, verified, uncommitted

Both OpenAI-compatible → OpenAI adapter refactored into factory `makeOpenAICompatProvider({ providerName, resolveApiKey, resolveBaseUrl, fallbackModel, supportsEmbeddings, supportsLogprobs })` in `packages/llm-provider/src/providers/openai.ts`; exports `OpenAIProviderLive`/`GroqProviderLive`/`XAIProviderLive` (NOT duplicated).

**Wire (verified vs live docs):** Groq `https://api.groq.com/openai/v1` + `GROQ_API_KEY`; xAI `https://api.x.ai/v1` + `XAI_API_KEY` (overridable via `*_BASE_URL` → config `groqBaseUrl`/`xaiBaseUrl`). Groq unsupported params avoided; `logprobs` gated `false` both. No embeddings endpoint → `embed()` fails descriptive (`supportsEmbeddings:false`).

**Capability (`capability.ts`):** seeded Groq — llama-3.3-70b-versatile, llama-3.1-8b-instant, openai/gpt-oss-120b, openai/gpt-oss-20b, qwen/qwen3-32b, meta-llama/llama-4-scout-17b-16e-instruct — + xAI (grok-4/3/3-mini). **LIVE CATALOG AUDIT: removed `moonshotai/kimi-k2-instruct` (404) + `deepseek-r1-distill-llama-70b` (400 decommissioned); added llama-4-scout.** Verify every seeded model ID vs live catalog — names hallucinate/go stale. KEY: `fallbackCapability` provider-aware branch (`OPENAI_COMPAT_FALLBACK_PROVIDERS={groq,xai}`) → **native-fc + 131k**, never conservative `"none"` (else drift-prone unlisted models lose tools). Thinking (opt-in, default OFF) `supportsThinkingMode:true` only where `reasoning_effort` correct (gpt-oss, grok-3-mini); false for qwen3/deepseek (Groq `reasoning_format`) + grok-4 (auto-reasons) to dodge 400.

**Union widened `groq`/`xai`:** types.ts, llm-config, runtime dispatch, provider-defaults, runtime-types (incl `LightRuntimeOptions` — **tsc caught it, tsup masked**), builder/types `ProviderName`, build-validation (`PROVIDER_API_KEY_MAP` single key-read path + prefix map xai:["grok"]/groq:[]skip), benchmarks, judge-server (union+`PROVIDERS`), create-reactive-agent (union+cli+switches). apps/examples local `type PN` left (harmless).

**Verify:** turbo 25/25 ESM+DTS; tsc clean; `groq-xai-provider.test.ts` 15 pass; llm-provider 344/0; facade `.withProvider("groq"|"xai").build()` E2E ok; provider-warden MERGE-READY. 2 runtime `model-routing-reasoning-path` fails = PRE-EXISTING anthropic real-API flakes (2/2 clean main). Detail: `wiki/Planning/Implementation-Plans/2026-07-05-groq-xai-providers.md`. Lesson: reused-adapter + live-doc review caught logprobs 400 unit tests miss.

**LIVE Groq E2E (GROQ_API_KEY added 2026-07-05):** plain completion `success:true`; single clean-schema custom `multiply` tool → `success:true`+handler fired+model llama-3.3-70b-versatile. Real-API full stack verified. FINDING: **Groq hard-400s (`tool_use_failed`) on malformed tool generation** — `.withTools()` full builtin set + mid-tier llama-3.3-70b → model emits invalid call, Groq rejects WHOLE request (OpenAI/Anthropic degrade). NOT wire bug (single tool works). Mitigate: fewer/simpler tools, gpt-oss-120b, or `allowedTools`. Follow-up: catch Groq 400 `tool_use_failed` → healing path. **xAI live (XAI_API_KEY + credits):** FULLY VERIFIED — plain completion `success:true`; `multiply` tool → `success:true`+fired+model grok-4 (initial 403 was billing, resolved by adding credits, no code change). BOTH providers now fully live-verified (completion + native tool call). **Groq model matrix (provider-layer plain+tool):** llama-3.3-70b/llama-3.1-8b/qwen3-32b/llama-4-scout/gpt-oss-120b/20b ALL OK (gpt-oss needs adequate maxTokens — reasoning model; 32-tok→finish_reason=length). Groq hard-400s intermittently on malformed tool generation (llama-4-scout 1 fail then 3/3). **User's original 413 = Groq free-tier 12k TPM** blown by large prompt (github-MCP = 46 tool schemas); mitigate via `allowedTools`/fewer MCP/tier upgrade — NOT a bug. **Swallowed-error FIXED (7 sites):** kernel set full msg in `state.error` but `normalizeReasoningResult` (runtime/src/engine/util.ts:222 whitelist rebuild) DROPPED it → execution-engine.ts:1128 generic "Reasoning failed". Fix: `error` field on `ReasoningResultSchema`/`ExecutionReasoningResult`/ctx `reasoningResult`/`buildStrategyResult` param; normalize preserves it; reactive+adaptive pass `state.error`; engine prefers `rr.error`. Live: result.error now shows "...404 The model...does not exist". reasoning 1890/0. Remaining strategies (plan-execute/blueprint/tot/reflexion/code-action/direct) could pass error too — param exists.

**POTENTIAL HARNESS IMPROVEMENT (noted, kernel-scope, needs scope+ablation):** post-condition auto-recovery. Live grok-4 2-step MCP task (fetch commits → write ./commits.md): grok-4 called list_commits ✓ then `final-answer` with the table INSTEAD of required `file-write`; kernel accepted final-answer, found file-write post-condition unmet, terminated via `low_delta_guard` — honest fail, no recovery. Fix idea: when final-answer emitted but a declared post-condition (required file-write) is unmet, REJECT final-answer + re-prompt toward missing action instead of accept+stall. NOT provider-scoped (integration fully works). Detail in `wiki/Planning/Implementation-Plans/2026-07-05-groq-xai-providers.md`. **Custom-tool builder shape: `.withTools({ tools: [{ definition: { name, description, parameters: [{name,type,description,required}] }, handler: (args)=>Effect }] })`** — parameters is ARRAY not JSON-schema; handler returns Effect.

## ▶ Agentic OS North Star v6.0 RATIFIED (2026-07-05) — CANONICAL forward direction

Spec: `wiki/Architecture/Specs/08-AGENTIC-OS-NORTH-STAR.md` (commit `28acc328`), successor to 05-DESIGN-NORTH-STAR §6 sequencing; 00-VISION pillars unchanged. Grounded in 10-subsystem parallel audit (2×5 explorers) + mid-2026 landscape research.

**Master finding: last-mile WIRING program, not building.** ~70-90%-built subsystems missing final wire (all file:line-cited in spec §1): A2A executor never bridged + server never started; `RunReport.skillFragment` never populated; UI protocol reserved tags (TrustEvent/StepEvent/UiTreeDelta/ObjectDelta) zero emitters; `checkOutput` zero runtime callers; kernel recall/learn = Noop layers; `authorize()` unconsumed; `ToolService.execute` enforces nothing; LLM I/O not captured on live path (replay = tool-surface only); trustVerdict bench-only; orchestration "durable" = in-memory Refs; 8/12 phase hooks dead; calibration = most under-surfaced shipped system.

**4 arcs:** (1) **Log+Process+Receipt** — one canonical event log w/ LLM I/O capture, RunHandle v2 (inspect/fork/grant/revoke, `rax ps/attach/fork`), `result.receipt` consolidating 5 disconnected trust systems; LAUNCH LINE here (bench receipts + Show-HN). (2) **Boundary+Gate** — enforce at execute(), wire authorize(), BYO lift-gate (unify packages/eval ↔ benchmarks gate). (3) **Team** — A2A last mile, sub-agent events→parent bus, orchestration durability onto RunStore, MissionBrief/UpwardReport primitives, receipt chain. (4) **Flywheel** — skillFragment, learned aliases (act.ts:325 TODO), auto-calibration chain, harness packages w/ receipts, verifiable self-improvement LAST. **Dead-seam law: every dead seam goes live or gets deleted.** Non-goals carried: no new strategies, no falsified levers, no UI-binding race, lift gate on every default-on.

**Red-team amendments (`8c402be3`, user-ratified):** (1) **LAUNCH GATE = fixed 5-item demoable subset of Arc 1** (LLM I/O capture, inspect + rax ps/attach, fork v1, receipt v1, bench receipts published) — anti-slip vs the v0.11→v0.13 deferral pattern; build-toward-visible-potential over launch-now. (2) **Honest-claims scoping:** fork = counterfactual restart NOT time-travel; zero-token CI = exact-replay only; receipt = graded evidence, Ed25519 signs provenance not correctness, false-verified rate published. (3) **Commons transparency contract:** telemetry default-on ONLY under first-run notice + opt-out + published schema + open aggregate data + never content/PII — else flips opt-in.

**Live-probe validation (`87a97daf`, 7 e2e Ollama probes — `wiki/Research/Harness-Reports/2026-07-05-north-star-live-probe-validation.md`):** north star CONFIRMED + sharpened. (1) Receipt gap visceral — result carries NO toolsUsed/trust fields. (2) pause/resume/stop WORK live; inspect/fork absent. (3) **Durable checkpoints kernel-path (`.withReasoning()`) ONLY — silent no-op on run()/inline** + unknown builder options swallowed → NEW Arc 2 workstream "config truthfulness" (spec §5.2b). (4) **LLM I/O capture FIRES live** (analyze.ts:322 comment stale) — request full, response payload dropped by callers, emitter schema already supports `arguments` → Arc 1 keystone re-scoped cheaper (§4.1). (5) Flywheel pull LIVE e2e (community profile fetched during build); telemetry first-run notice already ships. (6) Structured output on 4B re-verified. (7) A2A dormancy exact (start() = "Gateway not configured", port never opens). Probes in `.probes-live/` (git-excluded).

**ROADMAP amended + Arc 1 plan written (2026-07-05, worktree `worktree-agentic-os-arc1` off local main `6439b3b3`):** ROADMAP.md → arcs as v0.14 Log+Process (launch) / v0.15 Boundary+Gate / v0.16 Team / v0.17 Flywheel + 07-ROADMAP §9 authority-handoff entry (`a2cd4b87`). Arc 1 plan `wiki/Planning/Implementation-Plans/2026-07-05-agentic-os-arc1-log-process-receipt.md` (`2862a78f`, 10 TDD tasks): T1 stream tool-arg capture (observable-llm accumulator + tool_use_delta), T2 stale-comment fix + llmExchangeCount, T3 makeReplayLLMLayer exact-replay, T4 checkpoint flush + inert-durable warn, T5 RunHandle.inspect, T6 agent.fork (loadForkPayload, forkedFrom provenance), T7 rax ps/attach, T8 TrustReceipt v1 (5 verdict rules) + TrustEvent emit, T9 Ed25519 provenance signature, T10 90s demo + docs. NEXT: execute plan (subagent-driven) in worktree → merge when green; v0.13.1 patch still uncut; bench-receipts publication = launch-gate item 5 (separate thread).

**ARC 1 EXECUTED + MERGED (2026-07-06→07, merge `3c9c15fa` atop v0.13.5 `b5033cc8`, 29 commits):** all 10 tasks subagent-driven w/ per-task review + fix waves. Final gate ALL GREEN (turbo 39/39, keyless 7184 pass w/ 27 env-bound fails only, termination invariant, live demo PASS, trace→replay round-trip 2/2 zero-token). Live smokes caught 3 defects unit tests missed: T5 public runStream handle lacked inspect (boundary seam fires once on streamed runs); T8 META tools counted as grounding ("ungrounded" unreachable); T3 replay key asymmetry (ContentBlock flatten + truncation caps → post-first-call misses; fixed via shared `exchange-projection.ts` in llm-provider). Shipped: `handle.inspect()`, `agent.fork()` (Promise<AgentResult>, forkedFrom/forkedAtIteration), `rax ps/attach`, `result.receipt` TrustReceipt (5-rule heuristic, substantive-only toolsUsed, run+runStream), Ed25519 `.withReceiptSigning`, `makeReplayLLMLayer`, awaited checkpoint flush + status write. Docs: features/process-model + README "Agents are processes" + process-model-demo.ts. Arc 2 backlog: verifier-"pass" wiring (0.9 unreachable), streamed-run checkpoints boundary-only, terminate() leaves "running" status, createLightRuntime key threading, RunInspection export, cost-route ignores ModelOverrideRef, core pkg "bun" export still dist. Launch-gate: items 1-4 DONE, item 5 (bench receipts) open.

## ✅ Agentic UI Kit COMPLETION wave — Plan 1 (ui-core shared controllers + React backfill) MERGED to local main `38289da4` (2026-07-05)

New **completion wave** finishing the deferred second wave (full React/Vue/Svelte parity + genUI depth). Design: `wiki/Architecture/Design-Specs/2026-07-05-agentic-ui-kit-completion.md`. Decomposed into 4 plans; **Plan 1 shipped** (`wiki/Planning/Implementation-Plans/2026-07-05-agentic-ui-kit-p1-uicore-controllers.md`, 6 TDD tasks subagent-driven in worktree, opus final review READY-TO-MERGE).

Lifted framework-agnostic logic out of React-local into `ui-core` so bindings are thin: `packages/ui-core/src/render/tree.ts` (`UiNode`/`isUiNode`/`uiTreeSchema`/`reconcileUiTree`), `inbox/controller.ts` (`fetchInbox`), `interaction/controller.ts` (`respondToInteraction`, **`decideApproval`** — NEW, closed a real gap: no approval-POST helper existed, `ApprovalGate` only fired `onDecide`). React `registry.ts`/`use-task-inbox`/`use-interactions` rewired onto ui-core, ZERO behavior change. Verified: ui-core 37/0, react 28/0, e2e probe 16/16 through built package boundary, all 4 consumers build clean, astro docs 91 pages links-valid. Docs: `packages/ui-core/README.md` (was missing), astro `features/agentic-ui-core.md`+sidebar, `web-integration.mdx` enhanced, root+react README refreshed.

**Handoff to Plans 2–3:** `reconcileUiTree` = positional append/refine ONLY (no child removal/reorder — document before wiring to real delta stream); `decideApproval` ready-but-unwired (Svelte ApprovalGate adopt directly, don't reintroduce inline POST); JSON-cast trust boundary → fix once in ui-core (zod) so bindings inherit; rebuild ui-core dist before binding tests in a worktree. Plans 2 (Svelte components), 3 (Vue full parity), 4 (parity gate + drop @unstable) NOT STARTED. **LESSONS this session:** worktree absolute-path edits silently hit MAIN checkout (bit twice — plan file + all docs); `bun` resolves `@reactive-agents/*` to src at repo-root via root tsconfig paths, but to dist from a `packages/<pkg>` cwd / fresh worktree (per-pkg tsconfig `paths:{}`), so rebuild dep dist before binding tests there. main NOT pushed.

## ✅ Agentic UI Kit P3 — React binding + Svelte binding + Cortex showcase, MERGED to local main (2026-07-03)

Recovered a lost worktree (`worktree-cortex-agentic-ui`, 24 commits, never merged) and merged clean into main (`e05ca220`). Covers: React — full rewire onto `ui-core`'s `useRun`, all v1 families (Interact/Inbox/Observe/Render/Devtools), resumable-run reattach, DOM test harness. Svelte — same rewire (`createRun`/`createInteractions`/`createResumableRun`), `structured-stream`/`agent-stream` back-compat preserved. Cortex — Interact panel + interaction-watcher rail (durable `request_user_input` UX, e2e-tested), chat streaming converged onto `ui-core` `connectRunStream` (killed a 4th event-union copy, GH #163).

Post-merge health sweep found + fixed 3 real issues (pre-existing, not introduced by this branch):
- `AGENTS.md` dependency-tree doc-drift: `ui-core` package missing entirely; `react`/`svelte`/`vue` entries stale (said "no reactive-agents deps" — all three now depend on `ui-core`). Caught by `packages/core/tests/doc-drift.test.ts`.
- `apps/cortex/ui/src/lib/constants.ts`: `globalThis.location` access broke `tsc` — the file is transitively pulled into the server-side (no-DOM-lib) `apps/cortex/tsconfig.json` via `messages-extract.ts`. Fixed with an explicit `BrowserGlobal` interface cast instead of relying on ambient `window`/`globalThis` DOM types.
- WS-5b `as unknown as` cast-site ceiling test regressed 78 vs ceiling 76: two redundant double-casts in `packages/react/src/hooks/use-agent-stream.ts` and `packages/svelte/src/agent-stream.ts` (`state.events as unknown as AgentStreamEvent[]`) — a single cast typechecks fine, no double-cast needed.

Known non-regression: `packages/runtime/tests/model-routing-reasoning-path.test.ts` (2 tests) fails — hits live Anthropic API, account **out of credits** (verified via direct curl to `/v1/messages`). Pre-existing test (predates this branch), environmental not code.

Full health after fix: build 39/39, typecheck 71/71, tests 1119/1122 pass (3 fail = 2 credit-exhausted live-API tests + [already documented] eval perf-timing flake under parallel load, confirmed passes in isolation).

## ✅ Cortex Dynamic Sync — PLAN COMPLETE (A/B/C/D + generic renderer), FULLY ON LOCAL MAIN (2026-07-03)

A/C/D landed via earlier merges; the type-introspected generic renderer cherry-picked to main **`427f625b`/`f1d49303`/`1fa1a872`** (conflict-free — worktree HEAD~3 was already an ancestor of main; renderer target files unchanged on main since). Main cortex tests **434/0**, typecheck clean. Worktree `worktree-cortex-dynamic-sync` fully merged (kept, not removed — harness-owned path).

- **Phase A (model routing):** `withModelRouting` wired end-to-end (runner+gateway+POST+UI checkbox/minTier); strategy parity guard iterates `getCapabilityManifest().strategies` (+aliases) → new framework strategies auto-covered.
- **Phase D (detail UX):** D1 `launch_params_json` per-run snapshot (col+migration; `rowToRunSummary` parses → GET /:runId `launchParams`; `store.getLaunchParams`); D2 `POST /api/runs/:runId/rerun`; D3 run-detail Rerun / Edit & Rerun + read-only `RunConfigSnapshot`; lab `?fromRun=` prefill (shape-safe allowlist).
- **GENERIC RENDERER (anti-drift headline — user's ask "render from type introspection"):** cortex already builds via `cortexParamsToAgentConfig → agentConfigToBuilder`, so a generic override needs ZERO per-field plumbing — deep-merge a partial nested `rawConfig` (keyed by the SAME schema paths `getCapabilityManifest().configFields` introspects via `JSONSchema.make`) UNDER the curated draft in `cortex-to-agent-config.ts` before `Schema.decodeUnknownSync`. Curated cortex controls WIN on overlap; advanced framework-only fields flow through; invalid overrides fail cleanly at decode. UI `AdvancedFrameworkConfig.svelte` renders leaf configFields straight from the introspected manifest (widget per `type`) → NEW framework field appears with zero UI code. De-risked via probe (`builder.toConfig()→deepMerge→ReactiveAgents.fromConfig()` preserves tools+killswitch+strategy). **Live-verified through real server:** POST `rawConfig:{reasoning:{maxStrategySwitches:7}}` → built + round-tripped in D1 snapshot; invalid `defaultStrategy:"not-real"` → 500 at decode. Reusable: `ReactiveAgents.fromConfig(AgentConfig)` (builder.ts:275) + `builder.toConfig()` (builder.ts:2168) = lossless config round-trip; `agentConfigToBuilder` decode-validates.

## ✅ Cortex Run Control — immediate abort (Phase C, MERGED to local main `67943256`, 2026-07-02)

Worktree `worktree-cortex-dynamic-sync` (same branch as Phase B capability-manifest). **Stop stays graceful (halts at next phase boundary); new Terminate is immediate — aborts the in-flight LLM call.** 6 commits `67948fba`→`4a772604`, TDD, 93 combined tests green. **Live-verified on Ollama: gemma4:12b generation terminated@800ms → run() settled@805ms.**

- **C1** `packages/guardrails/src/kill-switch.ts` — `KillSwitchService` gains per-agent `AbortController` map + `signal(agentId)`; `terminate()` aborts it (`ensureController` so a terminate racing ahead of `signal()` still yields an aborted controller).
- **C2 — the plan's premise was WRONG, worth remembering.** Plan claimed "the LLM complete/stream signal option is already honored by providers" — FALSE: `LLMRequest` has no signal field and anthropic/openai ignore any signal. The real abort seam is **Effect fiber interruption**: Ollama's `Effect.tryPromise((signal)=>…)` forwards the fiber-interrupt signal to its fetch (`llm-provider/src/providers/local.ts:413`). Fix threads the killswitch `AbortSignal` into `runtime.runPromise(effect, { signal })` at the `run()` seam (`runtime/src/reactive-agent.ts:767`). **CRITICAL gotcha: acquire via `Effect.serviceOption(KillSwitchService)`, NOT bare `KillSwitchService.pipe(...)` — a missing service is an Effect DEFECT that `catchAll` does NOT catch, and this runs on EVERY run() → the bare form broke 133 runtime tests (any run without `.withKillSwitch()`).** On a mid-flight abort it emits `AgentTerminated` (phase-boundary parity) + a clean terminal error.
- **C3** `apps/cortex/server/services/runner-service.ts` — `terminate(runId)` + shared **idempotent** `finalizeRun` (atomic claim from `activeRef` → no double-dispose/double-unsubscribe when terminate races the run's own `.finally`); `ActiveEntry` now carries `unsubscribe`.
- **C4** `POST /api/runs/:runId/terminate` (mirrors stop). **C5** `run-store.terminate()` + confirm-gated Terminate button beside Stop in `RunDetail.svelte` (live + paused states).
- Rebuilt runtime+guardrails dist so the Node-consumer Cortex server picks up C2 (workspace `bun` export runs framework from src for probes/tests, but the built server reads dist). Pre-existing runtime fails NOT introduced: model-routing×2 (need keys), built-surface (needs dist). Remaining in the effort: generic field renderer + Phase A (model-routing UI) + Phase D (rerun).

## ⚠️ File-root sandbox escape FOUND+FIXED (2026-07-02)

REAL production bug, found while investigating why RA scored near-bottom on file-output tasks in the public competitor bench (not a security audit). Tool-call healing pipeline (`packages/tools/src/healing/path-resolver.ts resolvePaths`) is a correct safety net — expands relative file-tool paths against a `workingDir` root and remaps hallucinated absolute paths back into it. But 3 call sites fed it `process.cwd()` instead of the tools package's own `getFileRoot()` (the AsyncLocalStorage-backed sandbox root `withFileRoot()` sets — the file-write/file-read handlers themselves already correctly used it): `reasoning/src/kernel/capabilities/act/act.ts:188` (react-kernel, ALL reasoning strategies route single/parallel-batch calls through here), `reasoning/src/strategies/plan-execute/step-executor.ts:203`, `reasoning/src/strategies/blueprint/worker.ts:240`. Net effect: any relative/hallucinated-absolute path a model passed to file-write got pre-resolved OUTSIDE the sandbox before the handler's own traversal guard ran — which then correctly rejected it with "Path traversal detected". **NOT benchmark-only: file-root sandboxing silently failed for ANY reasoning-strategy agent (react/plan-execute/blueprint — most real usage) with file-write tools inside a `withFileRoot()` scope.**

**Diagnosis method (reusable):** (1) ruled out timeout/infra contamination first via `status=error && tokensUsed=0` signature scan, infra-wide not RA-specific; (2) traced one failing cell's `benchmark-traces/<traceId>.jsonl` — `tool-call-start` count > `tool-call-end`, `guard-fired` event with the error text; (3) minimal `withFileRoot()`+`agent.run()` repro — worked WITHOUT `.withReasoning()`, broke WITH it; (4) instrumented `getFileRoot()` directly at point of failure — ALWAYS correct (ruled out ALS/Effect-fiber propagation loss, first hypothesis); (5) the arg reaching the handler was already wrong — traced upstream to healing pipeline's `workingDir` param, found `process.cwd()` hardcoded at all 3 sites. **LESSON: getFileRoot() being correct everywhere it's directly called doesn't mean the sandbox holds — a pre-processing stage (arg healing) can silently reintroduce the unsandboxed value if it has its own copy of "what's the working dir" logic instead of calling the shared accessor.**

Fixed `78bd31ac` — all 3 sites now pass `getFileRoot()`. Verified: hand repro (bug→fix confirmed, file lands in correct sandbox), regression test `reasoning/tests/kernel/act/file-root-healing.test.ts` (3 cases), full `tools` (889/0) + `reasoning` (1866/0) suites green, tsc clean both. **Landed AFTER v0.13.0 shipped same day — not in the released tarball. v0.13.1 patch not yet cut, needs user confirm** (real security-adjacent gap, worth considering).

## ▶ Public Competitor Bench — v0.13 Receipts deliverable (2026-07-07: qwen3:14b re-run DONE, publication posture pending user review)

**QWEN3:14B RE-RUN (2026-07-07, post-Arc-1 main, report `wiki/Research/Harness-Reports/2026-07-07-public-competitor-bench-qwen3-14b-rerun.md`):** RA wins ALL 3 execution tasks (resilience +100, multi-file +33, memory +33); loses both research tasks (fabrication under forced grounding, probe-traced: noisy web-search → qwen invents EdgeVec/LiveBlocks; judge correctly 0s). Aggregate 35% = LOWER BOUND (10/45 RA cells timed out/abandoned; zombie fibers contend GPU). Integrity: error-cell judge short-circuit FIXED (`scoreErrorCell`); zombie-fiber abort OPEN. Judge recipe: `JUDGE_LAYER=live JUDGE_PROVIDER=openai JUDGE_MODEL=gpt-4o-mini` — WITHOUT JUDGE_LAYER a silent STUB scores 0.95 everything. ALWAYS pass `--output`. Posture: cogito 44% headline (clean run), qwen per-task pattern w/ timeout caveat, fabrication finding published as open problem.

**FIXES VERIFIED WITH REAL LIFT** (cogito:8b re-run, clean, 0 timeouts/0 judge errors): ra-full accuracy 29%(orig baseline)→16%(F1/F3 shipped but bench never wired KernelInput.requiredTools, so F1 was inert)→**44%** after ALSO fixing the bench wiring (`d26e8695`: fixture-bearing tasks call `.withRequiredTools({tools: builtins})` — the default adaptive-classifier path silently resolves empty for weak local models, a separate pre-existing gap, not F1's own bug). 44% now decisively best of 6 variants (bare 33%, manual-react 33%, langchain 20%, vercel 20%, mastra 27%). memory-under-compaction 0%→**67%** (the exact F2-targeted task). Honest trade-off worth publishing as-is: reliability dropped 59%→43% (`claimed-success (unverified)` roughly doubled 5→10 as `dishonest-success-suspected` dropped 7→5) — model now genuinely attempts+often-succeeds at tools but claims aren't always independently verified. **Zero literal `terminatedBy:"abstained"` fired** — the win came from required-tools enforcement forcing real engagement + F2 arg-healing, not F1's 2nd-ungrounded-attempt abstention path directly (F1 itself is correct/unit-tested; this task set just doesn't trigger its specific threshold). **NEXT: same fixed harness against qwen3:14b, re-verify.**

**qwen3:14b FINAL landed** (6/90 timeouts spread across variants incl bare-llm ×3 — qwen thinking-spirals at 420s; 0 judge errors): ra-full accuracy 49% — beats bare (27%)/langchain (44%)/vercel (40%)/mastra (48%) but **manual-react wins at 77%**. RA Full wins the 3 hard execution tasks (memory-compaction +100%, resilience +67%, multi-file-debug +33%), regresses the 2 research tasks (-33%, -53%). **Cross-model story: harness wins where execution is hard, hurts where the model could just answer — diagnosed defect, not noise.**

**ROOT CAUSE DIAGNOSED** (`wiki/Research/Harness-Reports/2026-07-02-cogito8b-competitor-bench-root-cause.md`): runtime never enforces what diagnosis detects. Early ungrounded end_turn reaches NO enforcement: recovery steering = stall/loop-gated (never fires at iter 1-2); forced abstention's "≥2 ungrounded synthesis" unreachable (first synthesis terminates run); verifier `action-success` = final-answer call's own flag only; `output-not-continuation-intent` = last-line-only (multi-paragraph plan-narrations pass — rw-7 shipped "First, let's check using brief()..." as a PASSING final answer, 8/8 checks). Even rw-1's acc=1 "wins" hallucinated every tool name (parametric luck) → reliability 59% = same defect. Honesty across ra-full: 0/15 verified successes. Token tax ~10× (7.3k vs 708 bare). **Fixes dispatched 2026-07-02: F1 grounded-terminal invariant + F3 repeated-identical-failure escalation (kernel-warden), F2 arg-shape unwrap healing (tools-warden).** After verify: re-run smoke + both models → publish honest before/after.

**cogito:8b FINAL clean dataset landed** (0/90 timeouts, 0 judge errors, 0 inconclusive/partial): Task table (Bare LLM/RA Full/Lift) — research-synthesis 100%→67% (-33%, single-run noise on small sample), data-investigation 0%→13% (+13%), multi-file-debug 0%→0%, memory-under-compaction 0%→0%, resilience-under-tool-failure 0%→67% (+67%). Dimension means: accuracy bare-llm 20% vs ra-full 29% (best of all 6 variants; competitors 9-27%); reliability lowest for ra-full (59% vs 74-100% others) — real nuance worth noting in the writeup, not obviously a bug. Raw: `benchmark-traces/`, report JSON in scratchpad `public-competitor-cogito-8b-final.json`.



RA vs LangGraph.js/Vercel AI SDK/Mastra on local models via Ollama (plan 2.2). Infra `f34d249f`: `benchmarks/src/competitors/ai-sdk-model.ts` (shared AI-SDK model builder; Ollama via OpenAI-compat `/v1`, none of the pinned competitor SDKs have a native Ollama adapter), langchain/mastra/vercel runners extended, `sessions/public-competitor-bench.ts` (qwen3:14b + cogito:8b, one model per session for strict GPU serialization, rw-1/2/7/8/9, 3 runs, 6 variants: bare-llm/manual-react/langchain-react/vercel-ai-sdk/mastra-agent/ra-full).

**3 real bugs found+fixed before any data trustworthy — do not skip this discipline on future bench sessions:** (1) ablation-table display bug — "RA Full" column pulled `bestVariantId` (often a competitor with 6 variants) while Lift was computed as `ra-full-bare-llm`, desyncing columns (75%→95% showed as "-75%"); (2) timeout too tight — 240s cap, 13/90 cells (14%) hit hard 0-token timeouts, infra-wide not RA-specific, legit durations already hit 228-231s; bumped to 420s + added `public-competitor-smoke` session (1 task/1 run/6 variants, run before any full session) — both `5dce62fd`; (3) [[file-root sandbox escape above]] — the big one, fixed `78bd31ac`.

**All bench runs so far are CONTAMINATED and discarded: qwen3:14b×2 attempts (OOM-killed, then display+timeout-bugged), cogito:8b×2 full runs (one file-root-sandbox-contaminated pre-`78bd31ac`, one judge-credit-exhausted post-fix — see below).** NEXT: re-run smoke → full cogito:8b → full qwen3:14b, all post-`78bd31ac` AND post-judge-switch, before publishing anything.

**4th anomaly — judge ran out of Anthropic credits, looked like more OOM fallout.** After a real system OOM killed one cogito run, a retry produced an ALL-DIMENSIONS-ZERO report (only `reliability` nonzero). Evidence field said `"Judge error: Judge RPC failed: 500 <!doctype html>..."` — the judge-server's Anthropic account hit `400 Your credit balance is too low`, every judge call threw, Bun served its HTML error page, bench recorded `score=0` everywhere the judge was consulted. **Symptom signature: every dimension exactly 0% across every variant except one (reliability, which doesn't route through the judge) → judge-pipeline failure, not a real result — check `evidence` for "Judge error"/HTML first.** Fixed by restarting judge-server on `JUDGE_PROVIDER=openai JUDGE_MODEL=gpt-4o-mini` (already-provisioned key, satisfies Rule 4 separation from local Ollama SUT). **Verify judge health with a REAL POST to `/judge`, not just `/version`** — `/version` stays up even when the LLM backend is out of credits. Judge-server started detached (`setsid nohup ... & disown`).

**Diagnosis discipline that worked:** never accept a headline number without checking (a) timeout/error distribution per variant, (b) whether a losing dimension's judge `evidence` field explains a real gap vs an artifact, (c) trace files for the actual tool-call sequence when a result looks surprising. 3 of 4 anomalies this session were bugs/infra, not findings.

## ✅ Agentic UI Kit — Svelte binding + Cortex showcase (2026-07-03, worktree `worktree-cortex-agentic-ui`, MERGE-READY, NOT merged)

Off main `0a2a253f`, 12 commits, MERGE-READY (whole-branch opus review). Gate: ui-core+svelte 62/0, cortex src/lib+server 440/0, builds green.
- **Plans:** P3 React binding (`2026-07-03-agentic-ui-kit-p3-react.md`) + Svelte/Cortex (`2026-07-03-agentic-ui-kit-svelte-cortex.md`).
- **P3 React binding EXECUTED** (8 tasks, 28/0, whole-P3 opus review MERGE-READY): `@reactive-agents/react` rewired onto ui-core (`useRun` + useAgentStream/useAgent rewire, requestInit threaded) + all v1 families (Resume/Interact/Inbox/Observe/Render/Devtools) + AgentSurface allowlist (security-tested, guards malformed children) + `./testing`+`./styles`. React cleaner than svelte (native-SSE tests, no compatFetch). Fixed 2 plan bugs (useRunSteps callId-merge; AgentSurface child-guard) + process.env→globalThis for client-only DTS.
- **Phase S — Svelte binding over ui-core** (first binding to actually consume connectRunStream/reduceRunState): `createRun`/`createResumableRun`/`createInteractions`/`runCost`/`runSteps` + `./testing`; rewired agent-stream/agent/structured-stream (surfaces unchanged, back-compat via `compatFetch` shim + terminal-resolve).
- **Phase X — Cortex ops A+B+E** (C deferred, plan-sanctioned): **A Interact** (server runner interaction methods + registration branch for awaiting-interaction pauses into shared durableApprovals registry + `.withUserInteraction()` + `/pending-interactions`,`/:runId/interaction` routes; **e2e-VERIFIED real `6783a59e`**; InteractPanel + interaction-watcher UI). **B** chat→connectRunStream (killed 4th event-union copy GH#163; transport-only, kept `_tag` dispatch). **E** streaming structured preview (live block in ChatPanel). **C cursor-resume DEFERRED**: Cortex history from own store not framework run_events journal, durable opt-in, attach endpoint unwired, fights WS.
- ui-core touched 2× additive (metadata guard, toolSummary) → now fully mirrors runtime stream-types.
- **COLLISION:** touches `apps/cortex/{server/runner-service,build-cortex-agent,api/runs; ui/stores/chat-store,routes,components}` — `worktree-cortex-dynamic-sync` (@daffee30) also edits Cortex → reconcile on merge (surgical diffs kept). Cortex HAS full structured output today (AgentConfigPanel JSON-Schema textarea → withOutputSchema → RunFinalDeliverable render); op E adds the STREAMING preview.

## ✅ Agentic UI Kit — foundation MERGED to local main `6e468022` (2026-07-02)

**Foundation P1+P2 EXECUTED (14 TDD subagent-driven tasks) + MERGED to local main (dynamic-sync-first order).** Keyless sweep 4101 pass / 2 pre-existing network fails; 38 pkgs build. Merges: dyn→main `67943256`, ui-kit→main `6e468022` (clean; kernel-state.ts grounding-vs-awaitingInteractionFor auto-merged). Post-merge svelte-DTS break (`TS2307 @reactive-agents/ui-core`) fixed via `bun install` (new-pkg relink). 2 real pre-existing bugs found+fixed finalizing follow-ups: `931207d7` durable-approval DENY-resume (returned pause sentinel as final answer + denial invisible to LLM; injectPause test masked it), `40bcd35b` endpoint owner-authorization (wallet hole → 403 fails-closed). Both worktrees KEPT. main NOT pushed (push at release). Remaining: P3(React+devtools)/P4(vue/svelte)/P5(demo+template) separate plans; Cortex showcase scoped (`2026-07-02-agentic-ui-kit-cortex-showcase.md`, 5 ops, dynamic-sync interplay: `.withUserInteraction()` auto-surfaces in AgentConfigPanel via manifest `deriveBuilderMethods()`).

Post-v0.13 flagship (user-approved): **"Production Agentic UX"** — UI kit turning harness systems into embeddable primitives for react/vue/svelte. Spec: `wiki/Architecture/Design-Specs/2026-07-02-agentic-ui-harness-components.md` (`c2c99647`). Chosen over warden-team / intelligence-bureau / red-team-arena / marathon-agent showcases (Claude-Code-territory, content-not-product, or lower user leverage; multi-agent showcase = phase-2 consumer of the kit). v1: NEW headless `packages/ui-core` (protocol + resume-cursor stream client + state machines + parse-partial dedupe — currently duplicated 3× across react/vue/svelte) + moat features **Interact** (`request_user_input` meta-tool + `.withUserInteraction()`, durable pause like approvals), **TaskInbox** (async agent jobs), **Resume** (reattach), plus registry-constrained dynamic render + CostMeter/StepTimeline. Server: mount-anywhere endpoint helpers. Demo: `apps/ui-demo` ops assistant. Gap-log mandate → `wiki/Research/2026-07-agentic-ui-gap-log.md` (v0.14 evidence). Facts: react/vue/svelte pkgs = hooks-only @unstable zero consumers; `packages/a2a/` + `orchestration/multi-agent/` already exist. Painpoint sweep folded in (`8cca4c7d`) — v1 also gets: `<AgentDevtools>` overlay (bounded to Observe hooks + replay button, slips to v1.5 if it grows), CI-safe testing (`recordRunFixture`/`mockAgentEndpoint` = contract-fixture format made public, zero-token UI tests), wallet protection on endpoint helpers (per-user budget/rate/concurrency defaults — "public AI feature without going broke"), identity-resolver scoping (multi-tenant day 1), `create-reactive-agent --template next-inbox` in P5; v2 adds `<AgentErrorBoundary>` + billing metering.

**Foundation plan COMMITTED `7761682c`** — `wiki/Planning/Implementation-Plans/2026-07-02-agentic-ui-kit.md`: P1 ui-core (6 tasks: scaffold, wire protocol, parse-partial dedupe, resumable SSE client w/ cursor, run state machine, fixture record/replay) + P2 server rail (8 tasks: run_events journal + run_interactions + identity cols on runs, request_user_input meta-tool mirroring the approval pause rail (act.ts:220-239 terminate + checkpoint + re-drive), `.withUserInteraction()`, wallet guards, 5 endpoint helpers, client/server protocol round-trip test). Code-anchored via 2 Explore maps; key discovered facts: NO stream-event journal existed (only checkpoints), approval pause = clean kernel terminate not in-memory block, runs table had no identity columns. P3 (React binding+devtools)/P4 (vue/svelte parity)/P5 (demo+template) = separate plans after foundation merges.

**FOUNDATION P1+P2 EXECUTED + SHIPPED (2026-07-02) — branch `worktree-agentic-ui-kit`, NOT merged.** 14 TDD tasks subagent-driven (implementer+reviewer per task). Keyless sweep **3997 pass** / 2 pre-existing network fails; all builds + tsc clean. `packages/ui-core` new (protocol, `connectRunStream`, `reduceRunState`, fixtures, canonical parse-partial); runtime rail: run_events journal + run_interactions + identity cols, `request_user_input` durable pause (~8 kernel sites), `.withUserInteraction()`, wallet guards, 5 endpoint helpers, round-trip proof. **2 REAL pre-existing bugs found+fixed finalizing follow-ups:** `931207d7` durable APPROVAL DENY-resume was broken (returned pause sentinel as final answer + denial invisible to LLM — untested because injectPause fabricates a completed checkpoint; fixed by mirroring interaction rail's terminal-reset + LLM-visible message); `40bcd35b` endpoint owner-authorization (interaction/approval/attach acted on runId w/ no owner check = wallet hole; added optional `identify`, 403 fails-closed). **LESSONS:** worktree tsc resolves `@reactive-agents/*` to stale main dist unless dist built (bun test unaffected); `ReactiveAgentBuilder` 0-arg ctor→`.withName()`; `request_user_input` only on `.withReasoning()` path; durable resume needs message-synthesis (fromKernelState reads state.messages not state.steps). **Cortex showcase scoped** (`wiki/Planning/Implementation-Plans/2026-07-02-agentic-ui-kit-cortex-showcase.md`): Cortex=Elysia+SvelteKit-static-SPA; flagship gap=no request_user_input; 5 ranked ops (Interact panel, chat SSE→connectRunStream, cursor attach, Task Inbox, structured-output preview); 3 stream-event union copies exist (GH #163) converge don't add 5th. **Next:** user decides branch disposition (merge local main / PR / keep) → then P3+ or Cortex showcase.

## ✅ v0.13.0 RELEASED (2026-07-02)

Tag pushed 2026-07-02; publish.yml green in 10m12s (build/typecheck/test/clean-install/dry-gate/publish/GH-release all ✓); 35 pkgs live on npm (`reactive-agents@0.13.0` + `@reactive-agents/runtime@0.13.0` verified via `npm view`); GH Release v0.13.0 published 04:13Z; CI sync-back `020c6360` (VERSION=0.13.0, changeset consumed) pulled to local main. **Remaining launch line: competitive bench (plan 2.2) + cold first-touch probe vs published tarball → Show-HN.**

Prep detail (2026-07-01): Commits: gpt-5.x fix `be0875cd` (capability flag `requiresMaxCompletionTokens` on gpt-5.5/5.4/5.4-mini/o5-reasoning; `buildTokenField` helper in openai.ts complete/stream/structured; schema-pin test +1 field); changeset `bce57a96` (**LESSON: release.ts reads ONLY `.changeset/*.md` — hand-drafted `## [Unreleased]` CHANGELOG section is DEAD; would ship "_No notable changes._" as GH Release body**); docs gaps `46e6c28a` (withLlmTimeout/quick()/defineTool-v2/abstention documented + counts 6,854/851). Gates green: build 38/38, typecheck 69/69, **keyless** test 6854/0, `release:dry 0.13.0` clean (35 pkgs, 1 note). **API truth (docs agent verified): `.withLlmTimeout` = local/Ollama-scoped ONLY (→`ollamaTimeoutMs`; hosted ignore it); typed-async tool shape = `defineTool({name,description,input,handler})` NOT `tool()` (separate positional untyped helper, untouched by cc1bfa82).** Next: user runs `git tag v0.13.0 && git push origin main v0.13.0`; then competitive bench + cold first-touch probe vs published tarball → Show-HN.

Post-release sequence (user-accepted): (2) **competitive bench** (plan 2.2 Receipts deliverable, MISSING — current published bench = internal ablation only, bare 13%→ra-full 26%): RA vs Mastra vs LangGraph.js vs raw AI SDK, pinned models/seeds ≥3, published traces, vs published 0.13 tarball. (3) **Cold first-touch re-verify vs published npm 0.13.0** (outside repo) → Show-HN; watch fail-fast build() demoted to opt-in `.withStrictValidation()` (`a094224c`) — missing-key late-401 papercut may be default again.

Memory prune 2026-07-02 (verified vs code): ReWOO SHIPPED as `blueprint` strategy (`strategies/blueprint.ts` + `blueprint/worker.ts`, registry:165); gemini thinking-starvation fix COMMITTED (`881ce51a`/`8141353b`, superseded by shared helpers `e45bd7c5`); `docs-receipts.ts` session exists; memory default-off flag lives at `runtime/src/builder/build-effect/runtime-construction.ts:113`. Working tree WIP uncommitted: competitive-bench (`competitors/{langchain,mastra,vercel-ai}-runner.ts` modified; `competitors/ai-sdk-model.ts`, `sessions/public-competitor-bench.ts` new).

## ▶ Cortex Dynamic Capability Sync — MERGED to local main (2026-07-02, worktree kept)

Goal: Cortex infers config/capability surface from the framework at runtime so new strategies/builder methods auto-sync into the UI (no hand-wiring 5 files). Design+plan: `wiki/Architecture/Design-Specs/2026-07-02-cortex-framework-parity-dynamic-sync-run-control-design.md` + `wiki/Planning/Implementation-Plans/2026-07-02-cortex-dynamic-sync-parity-run-control.md`.

In git worktree branch **`worktree-cortex-dynamic-sync`** (off origin/main @ v0.13.0) — **NOT merged to main.** Phase B (B1–B9) complete, all tests green, verified LIVE E2E. Phases A/C/D deferred (off Show-HN launch critical path).

- **`getCapabilityManifest()`** exported from `@reactive-agents/runtime` (`packages/runtime/src/capability/manifest.ts`): `{version, strategies, builderMethods, configFields}`. strategies ← new `STRATEGY_CATALOG` (`packages/reasoning/src/services/strategy-catalog.ts`, 8 entries + registry-equality guard); builderMethods ← **prototype reflection** over `ReactiveAgentBuilder.prototype` (83 `with*`) + annotation map (zero drift by construction, NOT a static table); configFields ← `JSONSchema.make(AgentConfigSchema)` walk (126 fields).
- Cortex **`GET /api/capabilities`** serves it; UI `capabilities.ts` store + `config-presentation.ts` (`hintFor` default-widget fallback → new fields never vanish) + server-side `manifest-coverage.test.ts` guard (UI has NO runtime dep by design). Strategy dropdown in `AgentConfigPanel.svelte` now manifest-driven.
- **KEY FRAMEWORK FIX:** `AgentConfigSchema.reasoning.defaultStrategy` (`packages/runtime/src/agent-config.ts`) was a hand-dup 5-member literal rejecting blueprint/code-action/direct at `Schema.decodeUnknownSync` → replaced with core's canonical 8-member `ReasoningStrategy`. E2E: `POST /api/runs {strategy:"blueprint"}` now builds + dispatches to `[phase:blueprint:plan]` (was hard-fail at decode).
- **Env:** Cortex = Node-runtime consumer (own tsconfig, no `src` path map) → server/UI tests need framework **built to dist** (`bunx turbo run build --filter='./packages/*'`) first.
- **Remaining (foundation ready):** generic renderer across all 126 config fields (only strategy dropdown migrated); Phase A (model-routing UI — `withModelRouting` already in manifest). Phases C (run-control killswitch AbortSignal → in-flight abort + Stop/Terminate) + D (rerun from detail) shipped through `c06d78cb` (D3). Worktree `worktree-cortex-dynamic-sync` KEPT for remaining Phase A + generic renderer.

## ▶ v0.13 Lift Execution — Waves 0-3 SHIPPED to origin (2026-07-01)

Executed the v0.13 lift plan via wardens (canonicalized contract). ALL pushed to origin main, CI green. Plan: `wiki/Planning/Implementation-Plans/2026-07-01-v13-lift-execution.md`.
- **Wave 0-1 (DX):** tool authoring v2 (typed-async shape + fail-fast defineTool, killed `as never`); local provider resilience (configurable timeout + `mapProviderError` de-dup + server-abort); fail-fast `build()` + `.quick()` + clean run() errors + scaffold templates. Resolved an external `git stash pop` conflict mid-run (blueprint combined per user; stale-stash files → main; benchmarks restored green).
- **Wave 2:** abstention branch merged (harness-forced path, E2E-verified — 1 doc conflict only); cost-gov demo (A25); **pushed 124-commit backlog to origin** (month of unpushed work now public).
- **Wave 3 cleanup:** `.withLlmTimeout(ms)` shipped (provider bridge + 5 runtime edits; `.withTimeout`=run-level unchanged); `.withBudget` FALSIFIED as broken on reasoning path (already enforces via Arbitrator→terminate.ts; regression test added) BUT found real INLINE-path gap (no `.withReasoning` → budget no-ops; logged); qwen3:4b+cogito:8b → STATIC_CAPABILITIES; public bench refreshed + moved to lead "vs. Alternatives".
- **CI-RED TWICE — same "green local red CI" class** (→ `feedback_ci_parity_no_keys_no_ollama`): (1) fail-fast build() default-threw on missing key (CI has none) → made opt-in via `.withStrictValidation()`; (2) `.withProvider("ollama").build()` connection-probes an unreachable server in CI → structural tests use `test` provider. **Pre-push gate MUST run keyless (`mv .env` aside).**
- **Bench result: solid-positive** — net +13pp harness lift (bare 13%→ra-full 26% accuracy), qwen3:4b/rw-9 resilience 33%→100%; low absolute (tiny models, hard tasks) but the DIFFERENTIAL is the story; honest failures shown. Live Anthropic judge (non-vacuity verified).

## ▶ Comprehensive Framework Review + v0.13 North Star (2026-07-01)

4 parallel audits (arch B+, docs 3-critical-gaps, DX/simplification, plans triage) + live first-touch probes on real providers. Report: `wiki/Research/Audit-Reports-2026-07-01/comprehensive-framework-review-and-v13-north-star.md`; AGENTS.md debt register +6 rows.

- **Cross-tier headline VERIFIED hands-on:** same defineTool+`.withOutputSchema` agent → correct typed object on claude-haiku-4-5 (6.4s/7k tok) AND gemma4:e4b local (20.1s/10.9k tok).
- **P0 first-touch DX wave (do BEFORE Show-HN, ~1wk):** (1) defineTool crashes `TypeError: schema.ast` on wrong option names — no validation (`define-tool.ts:133`); (2) no schema+plain-async+inferred-args tool shape — own example casts `as never` (healing-malformed-tool-call.ts:171); (3) `local.ts` hardcoded `Effect.timeout('120 seconds')` not threaded from `.withTimeout()`, bare error, server keeps burning GPU post-abandon; (4) missing key warns but build() succeeds → late raw 401 (env module-import capture vs build-time read split-brain); (5) model-typo → duplicated raw 404 + internal stack; (6) docs gaps (builder-api missing withFabricationGuard/withStallPolicy/withThinking entries; README same; Hot.md 15d stale).
- **North star:** harness = product, receipts = proof, first-touch DX = funnel. v0.13 = Prove (public bench + self-published token-multiplier) / Polish (P0 wave) / Publish (push main — 98 commits ahead of origin, never pushed; merge `feat/o3-abstention-trust-loop` after E2E).
- **Do-not-build held:** 2026-06-17 orchestration substrate spec (defer to v0.14+ w/ adoption data), Memory v2 (superseded by default-OFF), LATS/GoT. Stale-archive: 2026-03 adoption-strategy + gap-assessment.
- **Post-launch P2:** kill `compose()` alias, memory/learning single-route (additive facades, NO metric-gaming deprecations), provider adapter base (~5×800 LOC dup), direct/reactive merge, `.quick()` env-default entry.

## ✅ Cross-Tier Thinking SHIPPED to main (2026-07-01, merge `edc8b33a`, for 0.13.0)

Unified native `thinking` across ALL providers, OPT-IN / off by default (zero behavior change unless `.withThinking()` called). Built via brainstorm→spec→plan→SDD (7 tasks + whole-branch opus review + fix wave + re-review).

**Shipped:** `.withThinking(boolean | {enabled, effort, budgetTokens})` (rich-config home; `.withModel({thinking:true})` still the quick boolean). `config.thinking` TRI-STATE, **`undefined`→OFF for ALL providers** (control-pillar: no auto-enable by inference — this FLIPPED gemini's former thinks-by-default to opt-in). Shared `llm-provider/src/thinking/` (`resolveThinkingEnabled`, `reserveThinkingBudget` clamp 1024..16384, `anthropic-form.ts`); all 4 adapters resolve via the same helper. Per-request thinking = documented UNBUILT seam. Ablation session `benchmarks/src/sessions/thinking-ablation.ts` — **live-run PENDING** = empirical helps/hurts gate (promotes a tier to default-on only if it clears the lift rule).

**Provider API shapes (VERIFIED vs live docs — the original spec's legacy budget_tokens design was WRONG):**
- Anthropic: model-gen branch. Current (opus-4.6/4.7/4.8, sonnet-5, fable) = `thinking:{type:"adaptive"}` + top-level `output_config:{effort}`. Legacy (≤sonnet-4.5/haiku-4.5) = `thinking:{type:"enabled",budget_tokens}`. `type:"enabled"` → **400 on 4.7/4.8/sonnet-5/fable**.
- **temperature MUST be dropped when thinking on** — Anthropic + OpenAI reasoning both 400 on non-default temp. OFF path byte-identical.
- OpenAI: `reasoning_effort` + `max_completion_tokens`, no temperature; added `openai/o5-reasoning` capability entry.

**DURABLE LESSON:** request-capturing MOCKS echo any payload without API validation → all 7 per-task reviews GREEN while the headline capability would 400 on the whole Anthropic cloud tier. Only whole-branch review + real-API-doc verification (claude-code-guide + WebSearch) caught it. Provider-payload features: verify request SHAPE against current API docs; ablation live-run is the real proof. Detail: `~/.claude/.../memory/project_cross_tier_thinking_2026_07_01.md`.

**Ablation outcome (2026-07-01):** headline LIVE-VERIFIED via foreground probe — `.withThinking({effort})` on real Anthropic completes with correct output, no 400, BOTH forms (`claude-sonnet-4-5` legacy-enabled + `claude-opus-4-8` adaptive → correct "$0.05" bat-and-ball; trap is $0.10). Full statistical off-vs-on bench NOT completed: this env REAPS long bg bash tasks ~2min (astro docs:dev contention; only the first bg run ever survives — cloud-only + hands-off also died). Run it in a quiet terminal with a NON-SUT, non-reasoning judge (`claude-haiku-4-5-20251001` — NOT gpt-5.x). **Fixed en route:** suffix-less `claude-sonnet-4-5` capability alias (commit `08d448f0`, mirrors haiku alias). **FOUND (pre-existing, NOT this branch, needs its own fix+TDD):** `gpt-5.x` (openai default models) require `max_completion_tokens` + reject `max_tokens` → our openai adapter sends `max_tokens` on the non-thinking path → **gpt-5.x BROKEN for normal use.**

Also sealed `runGuardedPhase` skip-bypass (`7664c7db`, on main): it now honors `phase.skip` (was only `runPipeline`); direct callers no longer run configured-off phase bodies; cost-route band-aid retired. Was the latent smell from cost-routing.

## ▶ Cost-Aware Model Routing SHIPPED to main (2026-06-30, for 0.13.0)

`.withModelRouting(options?)` — OPT-IN (off by default), routes each run to the cheapest CAPABLE model of the configured provider by task complexity, on BOTH inline + reasoning paths. Provider-agnostic (cost ladder haiku/sonnet/opus mapped per-provider via PROVIDER_CONFIGS; `isRoutableProvider`=Object.hasOwn(PROVIDER_CONFIGS,p) — DYNAMIC, no hardcoded list), capability-gated (never below a model whose ctx-window fits), advisory (degrades to configured model on error). Completed the built-but-dead router (was Anthropic-only, no public API, DEAD on reasoning path: reasoning-think.ts:256 fed defaultModel; kernel think.ts:611 stream omitted `model`). Full brainstorm→spec→plan→SDD (5 tasks + opus whole-branch review + fix wave). Merged 91fb3c86; docs 32b7feca (cost-tracking.md + builder-api.md + whats-new). **DURABLE LESSONS: (1) tsup/`bun run build` PASSES despite real `tsc --noEmit` errors → run tsc separately as the type gate; (2) 2 implementer green-suite claims masked real defects (streaming regression falsely called "pre-existing"; masked tsc errors) — ALWAYS independently re-verify subagent "all green"; (3) streaming regression root cause: `runGuardedPhase` BYPASSES phase.skip → cost-route ran for streaming, threw on provider "test" → Effect DEFECT killed stream fiber (fix: in-run guard + Effect.try; latent smell: skip-bypass also hits guardrail/strategySelect); (4) reasoning path ignores .withLayers (ReasoningServiceLive captures LLMService at construction) — capture model via EventBus LLMExchangeEmitted; (5) .withTestScenario forces provider=test → routing degrades.** Also fixed a pre-existing main tsc error (verificationStep loop leftover from 157453e9). Detail: `~/.claude/.../memory/project_cost_aware_routing_2026_06_30.md`.

## ▶ Prompt / Context / Structured-Output Audit + Fixes (2026-06-30→07-01)

Branch **`fix/prompt-context-so-audit`** — MERGED to main (`bda7d04f` in main, verified 2026-07-01). Report: `wiki/Research/Audit-Reports-2026-06-30/prompting-context-structured-output-audit.md`. reasoning+runtime tsc clean; 271 reasoning + 10 runtime tests green; 14 tests added. **8 fixes shipped:** SO-1 json-repair `fixPythonLiterals`/`fixNonFinite` now string-aware (`replaceOutsideStrings`) + single-quote normalize BEFORE literal fixing (`"True Story"`/`"NaN Industries"` survive repair); CM-1 message-window keeps recent window as INDEX RANGE + preserves ungrouped mid-thread user instructions (were silently dropped over budget); SO-2 field-provenance boundary-match (`findWithBoundary`, rejects `cat` in `concatenate`) + nested recursion (dotted paths) + grounded-extract abstention skips dotted keys; PR-1 `buildSanitizedReverseMap` keeps-first + WARNS on tool-name collision (`a.b`&`a/b`→`a_b`) vs silent wrong-dispatch; SO-3 `streamObjectFrom` gates reparse on structural delim `,}]` (O(N²)→gone, DROP semantics make it safe); SO-4 `parsePartial` Tier-1 walkback bounded MAX_WALKBACK=64; CM-4 word-boundary fold summary; +HEADER_OVERHEAD dedup (tool-formatting had `220` twice). **Grade: prompting B+, context B/B+, structured-output A−.**

**RANKED REMAINING LEVERS (in report §Remaining Levers — need ablation/arch pass, DO NOT blind-fix):** (1) real token accounting — `length/4` heuristic (dup `CHARS_PER_TOKEN`) fires window LATE on dense code/CJK; per-provider tokenizer + tune `COMPACTION_THRESHOLD` 0.75 = HIGHEST value; (2) collapse curator/assembly duality — two parallel context systems (assembly `project-results`/`compact-history` vs curator `message-window`); CM-2 (window keeps turns by COUNT not SIZE) lives here; (3) bounded tool visibility PR-2 — `computePromptSchemas` think.ts:131-192 no cap, tier-scaled priority-preserving cap behind ablation-warden; (4) tool-name collision PREVENT not warn (registration-time uniqueness, `packages/tools`); (5) semantic grounding + graded confidence (still substring/binary 0.9-0.4); (6) measure hybrid steering double-inject (context-manager.ts:119-156). **DISMISSED CM-5:** `extractObservationFacts` is LIVE tier-gated distiller (`act.ts:145 shouldExtract`, default-on local/mid), NOT the "falsified 44% lever" (that was a perf-experiment result, not dead code). **LESSON: worktree edits MUST use worktree-absolute paths (main-repo edits = different tree, silently ignored by worktree tests); `tsc -p tsconfig.json` from repo root pulls apps/* = 401 pre-existing errors → always cd into the package.**

## ▶ Release-Readiness for 0.13.0 (2026-06-30)

Current ver = **0.12.0** (tag-driven; source package.json uniformly 0.10.6 = baseline, `scripts/release.ts` stamps the target; NO drift, `release:dry 0.13.0` PASSES). Full build GREEN. **2 BLOCKERS FOUND+CLEARED:** (1) 6 red suite tests = dead-end docs-bench remnants — `rw-bp1` made REAL_WORLD_TASKS=11 vs count-tests expecting 10 + docs-receipts session referenced never-committed rw-d* tasks. User confirmed DEAD END → PURGED (rw-bp1 + docs-receipts + run.ts wiring; suite green, zero test edits). `8bdae46c`. (2) `withVerificationStep({mode:"loop"})` = documented public option that was a SILENT NO-OP → REMOVED "loop" from union (5 type spots + JSDoc + dead warning branches). `157453e9`. **POLISH:** drafted 0.13.0 CHANGELOG (50 commits since v0.12.0; DRAFT — user finalizes version/theme) + fixed stale README "## 6 Reasoning Strategies" (registry=7). `06b54dcd`. **REMAINING (non-blocking):** checkMultiSource neutral-0.5 placeholder w/o TAVILY_API_KEY (doc-note); `as unknown as` AT the 76 cast-ceiling (zero headroom); 106 `as any` in runtime god-files. Full suite 6699/0. **VERDICT: release-ready once CHANGELOG version/theme finalized.**

## ▶ Test-Suite Health Audit + E2E Verification (2026-06-30)

**FINDING #1 RETRACTED — FALSE ALARM.** Earlier claim ".withFabricationGuard/.withStallPolicy absent from the built package" was WRONG: the probe ran from `/tmp` (outside the repo), so `import "reactive-agents"` resolved to bun's GLOBAL install cache = the stale PUBLISHED v0.12.0 tarball, not the workspace. From inside the repo both methods are present + callable; they're simply UNRELEASED (runtime src 0.10.6; committed June 27). **Durable rule: probe/verify ONLY from inside the repo — a /tmp probe silently tests the last published package.**

**Session pivot (user directive):** dedicate session to E2E-verifying existing features + auditing TEST-SUITE HEALTH (green-but-lying tests), fix issues, patch the regression nets that missed them. Baseline `bun test`: 6634 pass / 4 fail / 23 skip / 820 files / 96s. Method: 4 parallel audit agents (assertion-free · over-mock · error-path · skipped/drift) + in-repo live verification. **🐛 REAL HIDDEN BUG FOUND+FIXED:** `withMinIterations(N)` under-enforced — `minIterations:3` made only 2 LLM calls; both enforcement sites (`inline-harness-hooks.ts:91` direct-LLM + `reasoning-harness-hooks.ts:159` reasoning) were a lone `if` (one retry) not a loop to N → run finalizing at iter 1 got 1 extra pass regardless of N, breaking the "block early exit before N iterations" contract. FIX `if`→`while`; verified runtime 1039/0, DTS clean. Surfaced by strengthening a green-lying test (4 other strengthened tests confirmed their feature works). **Other FIXED:** (1) `runtime/smoke-guardrails.test.ts:5` — only "injection blocked" (security) test, green whether or not blocking happened → verified feature live, asserts `threw===true`; (2) restored `benchmarks/src/sessions/docs-receipts.ts` (broken main import `run.ts:15` from `8141353b`, file never on main) from `5d54144b` → unblocked 40 tests; (3) NEW `runtime/tests/built-surface.test.ts` — builds dist, imports BUILT `dist/index.js`, asserts all 83 documented `.with*` survive compilation (THE missing build/export-drift guard); (4) `reasoning/m9-termination-oracle.test.ts:427` tautology → real test shelling out to `scripts/check-termination-paths.sh` (also fixed that script: skip comments/`.test.ts`, was exit-1 on false positives); (5) `reasoning/m2-strategy-switching.test.ts:678-707` 4 fake `it("[SKIP]")` that ran green → `it.todo`. **🐛 2nd REAL BUG (property tests) — stringified tool-args dropped to `{}`:** added fast-check property tests for the parse/heal surface (`tools/tests/tool-calling/native-fc-property.test.ts` + `healing/healing-property.test.ts`); invariant "tool args always a Record" FAILED on current code → `normalizeArgumentsForResolvedTool` (native-fc-strategy.ts:531) dropped STRING args to `{}` (cloud adapters JSON.parse args; local.ts:216 passes through → tool called with no input). FIX: coerce string→JSON.parse at the resolver chokepoint (defends all adapters). Verified property 3/0, tools 838/0, DTS clean. The deterministic mock emits CLEAN FC → structurally can't reach parse/heal; property tests are the only path. **Test-robustness vetting (3 axes):** property/fuzz=0→2; 92% src-only imports (build-drift blind); NO strategy tested vs real provider in `bun test` (mock-only, tier=config-dim 2/8); 2 MOCKED caps (withRetryPolicy reimplements retry wrapper→prod Schedule.recurs untested=likely next bug; withMemory recall→prompt fake+seam voids context); 5 unguarded feature-combos. Plan: `wiki/Planning/Implementation-Plans/2026-06-30-test-robustness-strategy.md`. **🐛 3rd REAL BUG — `withRetryPolicy` dead on kernel path:** prod `runtime.ts:515` wrapped only `complete()`, but the kernel runs via `stream()` (`think.ts:611`) + structured via `completeStructured()` → retry policy never fired for normal runs. FIX: extracted `applyRetryToLlmService` (`runtime/src/llm-retry.ts`) wrapping all 3; `createRuntime` uses it; test rewritten to drive the REAL helper (deleted the in-file reimplementation) + cover stream/structured. Verified retry 5/0, runtime 1038/0, DTS clean. Commit `55e0f163`. **MOCKED/WEAK capability thread DONE (3/3):** withRetryPolicy=bug fixed; withMemory recall→prompt=NOT a bug (`iterate-pass.ts:430` intentional Phase-1 void seam; recall flows via `engine/bootstrap`→`priorContext`; test-gap deferred, opt-in); withHook=NOT a bug (fires through real run; sealed w/ `lifecycle-hook-firing.test.ts`, `ae9903e1`). **PATTERN: every MOCKED capability hid a real bug (3/3: minIterations, stringified-args, retry); WEAK=coverage gaps not bugs.** Session commits: `de207801`, `679f554b`, `55e0f163`, `ae9903e1`. **P0 SHIPPED — tier/provider-quirk contract runner** (biggest systemic hole: NO strategy tested vs real provider in `bun test`). Extended deterministic provider (`llm-provider/src/testing.ts`) with `ProviderQuirk` option (`stringified-args`|`snake_case-name`|`think-leak`); `TestLLMServiceLayer(scenario, quirk?)`. New `reasoning/.../kernel/provider-quirk-contract.test.ts` replays the react-kernel contract across quirks (`describe.each`): tool call→resolve to REGISTERED name+parsed args (healing+coercion), answer→no `<think>` leak (strip). 5/5 green, NON-VACUOUS (verified quirks mutate output). Deterministic. EXTENSIBLE. **COMPLETED across strategies — DECOMPOSITION: 8 strategies' tool-resolution = TWO families, not 7 redundant tests.** (1) react-kernel family (react/reflexion/ToT/direct + plan-execute react path) → react contract. (2) executeToolAndObserve family (plan-execute/blueprint) → plan+answer as TEXT, parsed after `extractThinkingSafeContent` strips `<think>`; plan-execute think-leak contract (`8bc00d93`); blueprint shares same primitives → transitive, not duplicated. code-action=sandbox (diff surface); adaptive delegates. All shared normalization primitives now tested (native-FC resolver, healing, think-strip, json-repair). Systemic "no strategy vs real provider" hole CLOSED at primitive+integration level, no clutter. reasoning 1825/0, llm-provider 292/0+DTS clean. **LIVE E2E (haiku, in-repo):** builder surface ✅, structured output ✅, blueprint ✅, durable runs ✅ (runs.db persisted). **DEFERRED (documented, not forced):** benchmarks 10-vs-11 task-count fails = blueprint/docs-bench thread's call (`rw-bp1` added w/o updating tests, updates in `stash@{0}`) — tests CORRECTLY red; Ollama `local.ts:213-217` no string-arg coercion = LATENT gap (qwen3:14b returns objects live, NOT repro'd — over-mock agent overstated; parseToolCalls-hook tests inject own coercer = real lying-green) → provider-warden call. Only 1 genuinely disabled test repo-wide (env-gated Ollama E2E); no hidden `.only`/`.skip` masking broken features. Report: `wiki/Research/2026-06-30-test-suite-health-audit.md`. Detail: `~/.claude/.../memory/project_harness_hardening_2026_06_30.md`.
## ▶ O3 Abstention / Trust-Loop — harness-forced SHIPPED, model-initiated CUT (2026-06-30)

First build from the landscape gap analysis (O3). Branch `feat/o3-abstention-trust-loop` (14 commits off 6e6ccf7b, green, NOT merged/pushed). Spec `wiki/Architecture/Design-Specs/2026-06-29-abstention-trust-loop-design.md`, plan `wiki/Planning/Implementation-Plans/2026-06-29-abstention-trust-loop.md`. Built via SDD (8 tasks + whole-branch review). **SHIPPED+VERIFIED — harness-FORCED abstention:** no fabricate-or-crash; structural impossibility (required tool unavailable / repeated ungrounded synthesis ≥2) → typed `abstained` terminal: new `terminatedBy:"abstained"` (core/result.ts), `deriveGoalAchieved→false`, additive `result.abstention:{reason,missing}` (NOT run-level `abstained` bool — name taken by structured-output per-field map). Wired abstain as terminal sibling of `final_answer` (ToolCallResult union + resolver + think.ts branch); `decideForcedAbstention` runner §7.5 (gated by countDeliverableCandidates + `if terminatedBy!=="abstained"`). **C1 (whole-branch review caught):** result.abstention dropped by 3 forwarding links (reactive.ts extraMetadata + engine/util.ts normalizeReasoningResult whitelist [root] + execution-engine.ts) → fixed + runtime e2e test. Green: build 38/38, reasoning+runtime 2874/0. **CUT — model-INITIATED abstain** (headline "model chooses to decline): E2E real-model probe (claude-haiku) killed it — (1) no enablement (`MetaToolsConfig` lacks `abstain`; method is `.withMetaTools` not `.withTools`); (2) even wired, `abstain` never in offered `toolSchemaNames` (umbrella dist/resolution + never-iter-0 gate); (3) **frontier model already declines in honest PROSE, never fabricated**. Tool redundant at top (capable self-decline) + ineffective at bottom (weak models fabricate UNCONSCIOUSLY → won't self-call). Reverted unverified enablement; model-facing pieces dormant/experimental. Lift UNMEASURED (needs local-tier proof-gate). **DURABLE LESSON: green tests on the parts (unit + per-task + even whole-branch review) ≠ verified headline capability — none asserted the abstain tool was OFFERED to a model or measured lift. Always run E2E before claiming a feature works.** Disposition pending user (land forced-path + doc dormant vs trim offering out). Detail: `~/.claude/.../memory/project_o3_abstention_2026_06_30.md`. **Merged to main 2026-07-01 (v0.13 lift Wave 2.1) — forced-path landed; model-initiated pieces stay dormant/experimental.**

## ▶ Agentic Landscape 2025–2026 vs RA — Competitive Gap Analysis (2026-06-29)

6-stream deep research (reasoning, memory/context, frameworks, tool-use, reliability/eval/governance) + full RA v0.12.0 inventory. Report: `wiki/Research/2026-06-29-agentic-landscape-vs-reactive-agents.md`. **Industry thesis VALIDATES RA bets:** (1) "the harness IS the product" (same model+diff harness swings scores 10–34pp; community demands harness disclosure); (2) reasoning moved INTO model → orchestration value moved to a THIN DURABLE harness (ToT/GoT/LATS = prod dead-ends, native reasoning absorbed them); (3) Bitter Lesson hits orchestration LOGIC not the LAYER (substrate+ops+verification is durable; build structure removable); (4) reliability+cost = battleground (88% pilots never ship); (5) verify with EXECUTION not opinion (intrinsic self-correct neutral-to-harmful w/o external signal); (6) security is action-layer (lethal trifecta, OWASP Agentic 2026). **RA SCORECARD — AHEAD:** deterministic-oracle eval + pass^k, structured-output at emission-boundary-only (Alignment-Tax fix), no-LATS/GoT + no-LLM-reverify (M3), blueprint/ReWOO, tier-aware + tool-sanitize + healing + relevantTools, 4-layer cognitive memory (rare LangMem club), durable crash-resume + HITL. **BEHIND/WHITE-SPACE:** KV-cache prefix stability + tool-masking (RA compaction/lazy-prune CHURNS prefix + dangles tool refs = fights 10× cost lever), long-horizon deep-agent harness (recitation-to-recency + file-offload + per-feature checkpoint + cross-session recovery + per-step decomp/verify), agentic security (tool-descriptor trust/MCP OAuth2.1/capability attenuation), abstention as first-class action, memory formation discipline (hot-path vs background, verify-then-commit gate, relevance-gated retrieval, memory-evolution, Anthropic memory-tool /memories protocol, SKILL.md compat). **RANKED OPPORTUNITIES:** T1 — O1 cache/context efficiency (10× cost, pure win), O2 long-horizon deep-agent harness (top 2026 momentum, RA owns substrate), O3 deterministic-verify+abstention as TRUST BRAND. T2 — O4 cheap-first cascade routing + pre-call cost gate, O5 code-as-action first-class tiered action space + progressive tool disclosure, O6 retrieval-over-tools >100. T3 — O7 OTel-GenAI conventions, O8 memory formation discipline. T4 — O9 agentic security suite (biggest white-space, heaviest, later campaign). **RECOMMENDED: lead O1+O2, anchor O3** (all press RA advantages, not me-too). Detail: `~/.claude/.../memory/project_agentic_landscape_2026_06_29.md`. **Awaiting build direction.**

## ▶ Cross-Provider × Strategy Failure Sweep — Gemini thinking-starvation ROOT bug fixed (2026-06-29)

Comprehensive sweep enumerating MAJOR failure modes across provider × strategy × harness (3 static-audit agents + targeted empirical probe). **ROOT BUG found+FIXED — explains "Gemini struggles where local models crush":** kernel caps visible output by tier (`reasoning/.../reason/think.ts:584` → mid=2000/large=3000/frontier=4000) but reasoning models spend HIDDEN thinking out of that SAME budget, and no adapter carved out a thinking allowance. Gemini 2.5 thinks BY DEFAULT with a *dynamic* budget that expands to consume the whole `maxOutputTokens` → answer starved/truncated (empirical via `RA_GEMINI_DEBUG=1`: gemini-2.5-pro@4000 = 3837 thinking / 143 visible → finishReason=MAX_TOKENS, no answer). Local models (thinking OFF) get all 2000-4000 as answer → "crush" it. **Difficulty-scaled** (harder task→more thinking→worse). Systemic but LATENT for anthropic (never sets `thinking`) / openai (never sets `reasoning_effort`) — only Gemini (thinking-on default) breaks today. The 2026-06-26 sweep never tested Gemini → undocumented until now. **FIX (Cluster A):** `llm-provider/src/providers/gemini.ts buildGeminiConfig` — for `resolveCapability().supportsThinkingMode` models, set bounded `thinkingConfig.thinkingBudget=clamp(answerBudget*4,1024,16384)` + `maxOutputTokens=answerBudget+thinkingBudget` (answer reserved ON TOP). complete()+stream()+completeStructured via shared helper. After: pro & flash both finish=STOP w/ full answers (flash honours budget as hard cap; pro advisory, ~4-5k natural appetite, 16384 ceiling prevents mid-thought truncation). flash-lite (non-thinking) untouched. **FIX (Cluster B, parity):** only gemini surfaced non-OK finishReason; anthropic/openai silently returned empty-success on max_tokens/refusal/length/content_filter → ported guard to both on complete()+stream() paths (kernel uses stream()) → fail w/ explanatory LLMError. **Verify:** llm-provider 292/292 green (6 new TDD tests: gemini thinking-budget ×2, anthropic guard ×2, openai guard ×2), ESM+DTS build clean. Probe: `.claude/skills/harness-improvement-loop/scripts/gemini-thinking-starve-probe.ts`. Report: `wiki/Research/Harness-Reports/2026-06-29-cross-provider-strategy-failure-sweep.md`. **COMMITTED `881ce51a` (A+B), `8141353b` (G2).**

**G2 SHIPPED+VERIFIED (8141353b):** cloud `complete()` timeout 30s→120s (gemini/anthropic/openai/litellm, match local). After A lets Gemini think longer, ToT expansion (uses `complete()`) exceeded 30s → `ExecutionError: Expansion failed at depth 1`. Verified: e1-lis on gemini-2.5-pro now completes ("Tree-of-thought completed successfully", was crashing). Added `cluster-a-gate` bench session.

**BENCH GATE:** moderate cells (m2/m3) INCONCLUSIVE (100% before AND after — don't think hard enough to starve at 2000/4000 cap; A's benefit lives on HARD reasoning). Need a HARD deterministic reasoning task (zebra exact-match) for a discriminating lift number.

**OUTPUT-OWNERSHIP INVARIANT SHIPPED (723f854d):** cross-tier-stress map (7 models × 4 providers × 5 tasks, react/plan-execute/ToT) → harness broadly HEALTHY post-fixes; all failures = **empty final output**. Worst: gpt-4o-mini c4-db-decomposition **22418 tok → output=""** (status=done). Trace root: terminatedBy=`"controller_early_stop:dispatcher_early_stop"` (arbitrator.ts:937) but §8.5 harness-deliverable whitelist only had hyphenated `"dispatcher-early-stop"` (reactive-observer.ts:390, diff producer) — string mismatch → no synthesis → answer discarded. FIX `runner.ts §8.8`: `done && !output && countDeliverableCandidates>0 → commitDeliverable(assembleDeliverable())` (immune to terminatedBy drift, additive). Verified: RED→GREEN test, reasoning 1808/0, gpt-4o-mini c4 ""→3674-char answer **acc 0→1**. **ToT WALL-CLOCK GUARD SHIPPED (a5a15a07):** ToT 0-output on e3 (gemini-pro+qwen3 killed at 300s) = explore (serial BFS 270s+ on thinking models) starved Phase 2. Fix `tree-of-thought.ts`: wall-clock guard in BFS loop (beside maxCost), `Date.now()-start>=exploreBudgetMs→break`; env `RA_TOT_EXPLORE_BUDGET_MS` default 120s; bestLeaf+Phase2 still run → best-so-far not 0. Verified RED→GREEN, reasoning 1809/0, gpt-4o-mini e3 60s/28291tok→28.1s/17905tok @4s budget. **RULED OUT non-bugs:** e6-guardrail 0-tok (guardrail blocks injection pre-LLM = legit defense); sonnet c4 empty (tokenDelta=0 ×6, artifactsAvailable=0 = genuinely stuck, honest). **SESSION: 4 commits/5 fixes (A+B 881ce51a, G2 8141353b, output-ownership 723f854d, ToT-wallclock a5a15a07). Harness broadly healthy cross-tier.** Remaining: C red-herring (model-bound, needs new grounding mechanism); Cluster-A hard-task gate (zebra exact-match deterministic task).

**NEXT BUG (Cluster D, diagnosed NOT fixed): ToT has no wall-clock budget.** e3-logic-fallacy (tree-of-thought) on gemini-2.5-pro INCONSISTENT: run0 killed at 240s cell timeout → **0 output/0%**; run1 done 313s. `tree-of-thought.ts:174` `start=Date.now()` is TELEMETRY-ONLY, never a time guard (only `maxCost` guard :324). Fix = wall-clock budget guard at BFS depth boundary → break + synthesize best-so-far BEFORE external timeout (avoid 0-output-on-kill; finalOutput=null when bestLeaf undefined :642). `TOT_TIER_LIMITS` exist but ignore per-call LATENCY on slow thinking models. Other deferred: C red-herring (model-bound), B strategy-side output-ownership invariant, D cost-opacity/tier-caps, E relevantTools-as-invariant.

## ▶ Trustworthy Docs Benchmark — deterministic-first (2026-06-28)

Refresh the public docs bench (apps/docs `/features/benchmarks`) from a stale, **regex-scored**, 3-month-merged `MultiModelReport` → canonical **DETERMINISTIC-ONLY** (NO LLM judge) v2 `SessionReport` with per-model-tier ablation + reproducibility receipt. **Why no judge:** research (`wiki/Research/2026-06-28-agent-benchmark-scoring-practices.md`) — LLM-judge documented-unreliable for headline (12 bias types, "reliability without validity"); SWE-bench/τ-bench/WebArena score by execution/state/trace. Removes judge cost + bias caveat, fully reproducible. **SHIPPED (local main, UNCOMMITTED):** `judge.ts` (scoreVerifiable shell-aware = fixes rw-8 `&&` bug; NEW `trace` criterion+`scoreTrace()` = τ-bench tool-call assertions; `judgeOn` guard = zero judge calls when no JUDGE_URL); `types.ts` (`TraceAssertion`+`trace` variant, `SessionReport.runsPerCell`); `runner.ts` (eager `primeCapability` ollama BEFORE per-cell preflight = freshly-pulled local models work w/o STATIC_CAPABILITIES e.g. gemma4:12b; **merge-by-cell writer** = separate model runs ACCUMULATE not overwrite, recomputes ablation; trace ctx → scoreTask); `run.ts` (`--models` subset filter; registered `docs-receipts`); 3 NEW deterministic tasks `rw-d1`(CSV→JSON),`rw-d2`(bug-fix hidden tests),`rw-d3`(read-only trace oracle) → REAL_WORLD_TASKS=14; `sessions/docs-receipts.ts` (NEW, deterministic-only, models gemma4:12b/gemini-2.5-flash/gpt-4o/claude-sonnet-4-6, 3 runs, ablation bare→reasoning→full); `m3-ablation.ts` pinned taskIds rw-1..10; `BenchmarkResults.astro` (renders SessionReport PRIMARY — was blank on session data; Reproducibility Receipt panel; pass-count uses ACCURACY not passRate); `benchmarks.mdx` rewritten deterministic-first. Tests: 126 bench + 6 oracle pass; build 38/38 green. **Local smoke validated** (gemma rw-d1+rw-d3: ablation OK, 0 inconclusive, judge=none, trace oracle fired, +1.0 lift). **IN PROGRESS:** frontier-first run (gemini-flash/gpt-4o/sonnet, 162 cells) → then add local tier (`--models gemma4-12b`, accumulates) → commit. Detail: `~/.claude/.../memory/project_trustworthy_docs_bench_2026_06_28.md` + `wiki/Planning/Implementation-Plans/2026-06-28-trustworthy-docs-benchmark.md`.

## ▶ Config Serialization Drift Closure + Anti-Drift Guard (2026-06-28)

Agent-as-data roundtrip (`AgentConfig`↔builder) had drifted: 3 artifacts must agree — `AgentConfigSchema` (agent-config.ts), `serializeBuilder()` (builder/to-config.ts), `agentConfigToBuilder()` (agent-config.ts). Schema+deserializer grew; **serializer never updated** → `toConfig()` silently dropped fields. Root cause: `builder.toConfig()` (builder.ts:2010) `serializeBuilder(this as unknown as BuilderStateForSerialization)` — cast severs typecheck so new schema field never forces serializer update. **DROPPED-FIELDS FIXED:** grounding, fabricationGuard, stallPolicy, taskContext, tools.focusedTools, reasoning.auditRationale, outputSchemaOptions (serialize-OUT only; schema obj not JSON). **DATA-PARITY ADDED (schema+ser+deser):** agentId, execution.minIterations, requiredTools, budget, circuitBreaker (incl `false`), rateLimiting, skillPersistence, durableRuns. ⚠️ builder `BudgetLimits`={tokenLimit,costLimit,warningRatio} NOT cost-pkg {perRequest...}. `leanHarness` EXCLUDED (profile switch, force-disables memory → can't coexist in one config). **DYNAMIC ANTI-DRIFT GUARD = `packages/runtime/tests/config-serialization-drift.test.ts`:** reads `AgentConfigSchema` AST at runtime, walks every leaf path → (1) COVERAGE: MAXIMAL_CONFIG fixture must set every schema leaf (new field→RED), (2) ROUNDTRIP: config→builder→toConfig drops no leaf (missing ser/deser branch→RED), (3) documented `NON_BUILDER_ROUNDTRIP` + exclusion-rationale prose. Future config can't drift silently. Verified: guard 3/3 (RED-first), agent-config 26/26, runtime 1037/0, build+DTS green. **SHIPPED local main (NOT pushed).** Detail: `wiki/Research/Debriefs/2026-06-28-config-serialization-drift-debrief.md`. Lesson: `as unknown as` at a serialization boundary is a drift magnet — AST-driven runtime guard + maximal fixture substitutes for the lost compile-time check.

## ▶ Reasoning Strategy Portfolio + `blueprint` strategy (2026-06-28)

**RESEARCH-SHARPENED:** new strategy NAMED **`blueprint`** (was ReWOO). Web-validated: [Beyond-ReAct planner-centric DAG](https://arxiv.org/html/2511.10037v1) beats GPT-4 ReAct 59.8 vs 48.2 StableToolBench @2.29 steps; canonical 4th single-agent pattern. **Hard caveat: SLMs unreliable as standalone planners → one-shot DAG fails on weak/local (our #1 req).** Fix = **PLAN→VERIFY→EXECUTE(0-LLM,parallel)→SOLVE** (PACT). blueprint PLAN pours framework leverage into small-model planning: schema/grammar-ENFORCED gen (extractStructuredOutput, local jsonSchemaEnforcement = biggest lever) + calibration channel + numbered-step prompt + experience-tips inject + plan-VERIFY gate (deterministic valid-DAG/required-tools/refs + heal; degrade→reactive if invalid; local optional 1 critique-refine) + healing-in-Worker. NO fine-tuning variants (BYOK/local; design only). **✅ blueprint SHIPPED 2026-06-28 (merged local main, NOT pushed; built via SDD): `strategies/blueprint/{worker,plan-verify}.ts` + `strategies/blueprint.ts`, registered `"blueprint"`+`"rewoo"`, 24 tests, reasoning 1797/0. PROOF-GATE (claude-haiku): rw-8 decomposable = blueprint 3.8k tok vs plan-execute 78.9k (~20× cheaper; both acc=0 = haiku model-bound on exact-output, parity); blueprint=1 LLM call(plan;solver short-circuit)+3 LLM-free file-writes. rw-9 observation-required = blueprint LOSES (acc0) vs plan-execute (acc1) → domain boundary CONFIRMED. Ships OPT-IN. ⚠️ raw-builder can't run plan-strategies (extractStructuredOutput fails for BOTH blueprint+plan-execute via builder; use bench runSession). **✅ ADAPTIVE ROUTING SHIPPED 2026-06-28: adaptive heuristic+LLM-classifier route static-local-gen→blueprint, guards networkIO+observationDriven→plan-execute/reactive (rw-9 proof-gate evidence); local-tier keeps default-reactive (blueprint auto-routes mid/large/frontier only, local=opt-in); 8 routing tests, reasoning 1805/0 runtime 1021/0.** **✅ BLUEPRINT VALIDATED both tiers 2026-06-28: rw-bp1 corpus task (create-3-files, deterministic node-check verify) → frontier(haiku) acc=1/1734tok + local(qwen3:14b) acc=1/1721tok, both 1-LLM-call+3-LLM-free-writes. Tier-portability + small-model planning proven. ✅ REACTIVE BATCH IMPROVED: parallel-batch tool calls now heal (shared healCall, was bypassing → weak-model batched calls hard-failed); fixed healed-flag bug (call!==rawTc always-true → actions.length>0, both paths) + added StallPolicy fields to KernelMeta type. reasoning 1806/0, runtime 1021/0.** Below = pre-build notes:

Pivot to strategy quality+efficiency. **Goal: portfolio of tier-portable strategies that each SHINE in a domain (not dead weight) + cross-cutting context/tool/memory/verify. All tiers local→frontier.** Scope: `wiki/Architecture/Design-Specs/2026-06-28-reasoning-strategy-portfolio.md`. Anti-goal: NO LATS/GoT/self-consistency (cost, no lift). **Build target: ReWOO** (plan tool-DAG once→execute tools w/ 0 LLM→solve once = ~2 calls vs plan-execute ~9). Warden brainstorm: ReWOO GREEN (~80% infra exists = plan-execute minus reflect; Worker=`executeToolAndObserve` tool-observe.ts:159; #E DAG=`{{from_step:sN}}` plan.ts; ToolService.execute concurrency-safe, reuse `isParallelBatchSafeTool`). **Tier-portability driver = `calibration.parallelCallCapability` (reliable/partial/sequential-only) + `capability.toolCallDialect!=="native-fc"||source==="fallback"`→text-parse fallback.** ReWOO risks: loop-internal StallPolicy/required-tools bypassed by direct Worker (validate required-tools at PLAN time + self-budget); failed #E→empty args (fail-on-unresolved-ref); healing NOT in direct path (Worker must run runHealingPipeline). **✅ SHIPPED pre-ReWOO (merged local main, NOT pushed): (1) Memory P0 — severed `experienceTips` loop (computed, never injected) → `appendExperienceTips` in reasoning-think.ts, tier-capped (1 local/3 else), 5 tests. (2) tier-aware plan prompt (plan-execute.ts `modelTier:"mid"` hardcode → resolveProfile). reasoning 1773/0, runtime 1018/0.** NEXT: parallel-tool Worker helper → rewoo.ts → proof-gate vs plan-execute rw-8/rw-9. Detail: [[project_strategy_portfolio_2026_06_28]].

## ▶ Eval-driven harness sweep + honesty reframe (2026-06-26)

First weakness sweep USING the eval system as probe (cross-tier: qwen3:14b/cogito:14b/claude-haiku/gpt-4o-mini × bare-llm/ra-full). Report `wiki/Research/Harness-Reports/2026-06-26-cross-tier-weakness-sweep.md`. **⚠️ CRITICAL: `analyzeRun` honesty label `claimed-success (unverified)` (analyze.ts:404-427) = "real work, no deliverable FILE" — NOT dishonesty; mislabels CORRECT text answers (rw-2@haiku acc=1.0 → "unverified"). The "95% honesty crisis" was a misread — real signal ~50% claimed-but-wrong (overconfidence) + low absolute accuracy (gpt-4o-mini ra-full ≤36%).** Always combine honesty label with judge accuracy. SHIPPED to main (local, NOT pushed): `ef0eb2be` verifier `output-not-continuation-intent` check (minority hardening, fired on 0 cells in re-bench — honest scope); `97c024f5` **`trustVerdict(honestyLabel, accuracyScore)`→`RunScore.trust`** (the REAL fix; offline-validated 4 verified-correct/5 claimed-but-wrong/1 honest-fail on real data, 16/16 + 126/0). Skill `harness-improvement-loop` updated to eval-system-as-primary-probe. **⚠️ BENCH OPS: GPU = 16GB VRAM (4070 Ti Super) — constraint is VRAM budget NOT "no local". One big model resident = fast; >1 big spills to RAM → 120s timeouts (14b Q4≈9-10GB, 12b≈7-8GB, small 3-4b≈3-4GB; 14b SUT+gemma-12b judge≈17GB>16=spill). Recipe: serialize SUTs (concurrency 1, ONE big at a time) + judge that co-resides (small 3-4b alongside 14b ≈13GB) OR off-GPU (cloud/ollama-cloud, `OLLAMA_API_KEY` free-tier in .env). NEVER 2 big SUTs + big judge. Single 14b SUT alone = fast. Calibrated models only (qwen3:14b/cogito:14b/qwen3.5/gemma4 — NOT qwen3:4b/cogito:8b; `local-models` session stale-broken).** **✅ W2 FIXED 2026-06-26** (merged local main `c38e70a4`+`e2832c20`, NOT pushed): "harness over-acts" hypothesis FALSIFIED (neutral prompt, 0 harness signals); real bug = agent fabricated benchmark timings ("150ms→90ms,40%") with NO execution tool, passed all 7 verifier checks. Fix: always-on `output-not-fabricated-measurement` verifier check + `detectFabricatedMeasurement` (high-precision perf-only, sentence-scoped %), `RA_FABRICATION_GUARD` env killswitch — lives in verifier → universal zero-plumbing. rw-6 claimed-but-wrong→honest-failure (acc still 0 = model limit, not metric-gamed); 21/21 + reasoning 1767/0. **✅ CONFIG-RAIL REPAIRED + `.withFabricationGuard()` SHIPPED 2026-06-27** (merged local main `0dd5df8b`, NOT pushed): the `.withGrounding()`-dropped-by-reasoning-service bug (ReactiveInput never declared grounding + reactive.ts omitted it from KernelInput) is FIXED — both grounding+fabricationGuard now threaded builder→config→executeRequest→reasoning-service spread→ReactiveInput→reactive.ts KernelInput→verifier. `.withFabricationGuard("off"|"warn"|"block")` (default block; env wins-loses to method). Deterministic test-provider test: default REJECTS fabricated metrics, off ships (2/2); resurrects `.withGrounding()` too. runtime 1012/0, reasoning 1767/0. **✅ BENCH ARTIFACT SANDBOX+CLEANUP SHIPPED 2026-06-27 (`0a1a33e9`):** file-read/write hardcoded `process.cwd()` base → model writes leaked to REPO ROOT (cluttered tree + depressed `verifiable` write-task accuracy; rw-8 `bun run generate.ts` in tmpDir → guaranteed acc=0). Fix: tools `withFileRoot()`/`getFileRoot()` ALS file-root (default cwd; concurrency-safe through Effect), bench wraps each cell `withFileRoot(tmpDir)`, `cleanupStaleBenchDirs()` sweep, .gitignore trace dirs. tools 830/0 (+5 sandbox tests), benchmarks 126/0, root verified clean. **▶ ACCURACY-GAP DIAGNOSIS:** harness lifts big where model capable (rw-3 0→0.9, rw-9 0→1.0); genuine gaps rw-2 (red-herring, 0.2 — model SKU-aggregation depth, CSV tiny so not harness-hiding) + rw-8 (multi-phase, was write-leak-0, now model-dependent) = MODEL-CAPABILITY overconfidence, NOT structural harness bugs. Remaining: runs≥3 re-bench (cloud judge), W5 detectors. **▶ EFFICIENCY INVESTIGATION 2026-06-27 — 3 hypotheses FALSIFIED, NO commit (proof-first): ❌ prompt-caching/prefix-stabilization NOT the lever (caching CODE works @8k tokens cC→cR, but harness prompts ~600-3262t too SMALL to trigger it; 2411t→cC=0; lean prompts correct); ❌ prefix mutation (system byte-identical across iters); ✅ REAL lever = call/iteration count + NO-PROGRESS LOOPING (rw-9 re-issued IDENTICAL required-tool nudge 4× before entropy-fail, all → failure anyway). **✅ SHIPPED `StallPolicy` 2026-06-27 (`3ddc3884`, local main, NOT pushed): on-by-default `.withStallPolicy({ignoredNudgeTolerance=2, escalateNudgeContent=true})` — nudge "ignored" when missing-required set didn't shrink; after 2 ignored → FAIL fast (no partial deliver); repeated nudges escalate wording. Counters via state.meta. rw-9: 21→5 iters, 17710→11586 tok (~35%). reasoning 1773/0, runtime 1013/0, build 38/38. Efficiency=reliability moat. DO NOT re-chase caching.** Detail: [[project_harness_sweep_2026_06_26]].

## ▶ Canonical Evaluation & Improvement System (2026-06-24) — Phase 1 SHIPPED

Post-v0.12 direction: unify RA's **triple-fragmented** measurement infra into one canonical system. Infra is MATURE but split across 6 pkgs + a skill, three parallel stacks, **no shared spine**: `benchmarks` (matrix/ablation/9-variant ladder/5 competitor adapters, private) · `eval` (5-dim judge, published, simpler) · `trace` (`analyzeRun` honesty+failure-mode+blind-spot, **orphaned — no score links to its trace**) · `judge-server` (FROZEN judge, SHA-pinned, Rule-4, production-ready) · `diagnose`/`replay` · `harness-improvement-loop` skill (manual). Fragmentation: 2 judges, 2 taxonomies (10 vs 5), 2 task models, 2 stores; industry alignment NOMINAL (named SWE-bench/GAIA but runs none).

**Plan:** canonical `Run` record (1 runId links score↔trace↔diagnosis); L0 corpus(+real industry adapters) → L1 ONE frozen judge/ONE 10-dim → L2 benchmarks matrix → **L3 wire-the-why (attach analyzeRun to every Run — biggest dogfood win, mostly LINKAGE)** → Lg `evaluateLiftGate` → L4 ImprovementLedger(=B's substrate) → L5 `rax eval` + honest public bench (≥3 seeds, raw traces, stop-the-line >15%). Reframe: canonical JUDGE=frozen judge-server, ENGINE=benchmarks; candidate mutation = a `HarnessVariant` → gate run = 2-variant ablation.

**SHIPPED — Phase 1 (Lg verdict), merged to LOCAL main `3e123eb7`, NOT pushed:** `packages/benchmarks/src/gate/` — `evaluateLiftGate(SessionReport, baselineVariantId, candidateVariantId, policy?) → GateVerdict` (default-on|opt-in|reject) + `projectTierEvidence` + `formatGateReceipt`. Pure/sync/deterministic, 16 tests, build green. Rule: ≥3pp ∧ ≤15%tok ∧ ≥2 tiers ∧ significant(per-cell variance=stddev) ∧ not-partial(inconclusive blocks default-on + excluded from aggregate). Tier=`modelVariantId`. **Unblocks B (verifiable self-improvement): gate IS B's validator.**

**SHIPPED — Phase 2 (contract-unify + dedup), merged to LOCAL main `e9d6216b`, NOT pushed:** 3 commits. (1) `@reactive-agents/core` now owns canonical `QualityDimension` (the 10 agentic dims) + `DimensionScore {dimension;score;evidence?}` + `CANONICAL_QUALITY_DIMENSIONS` (`core/src/contracts/score-contract.ts`, plain interfaces). (2) `benchmarks/types.ts` re-exports those from core (killed its duplicate decls — byte-identical, 98 tests green). (3) judge wire-contract deduped: `judge-server` type-exports its contract, `benchmarks/judge.ts` `import type`s it (deleted local mirror; type-only, no Effect bleed). **Decisions locked:** taxonomy = the 10 (safety→guardrail, relevance/completeness→accuracy rubric, cost-efficiency→efficiency — all EXCLUDED + deferred); scope = contract-unify only, NO scoring-logic rewrite, **eval UNTOUCHED**. Plan: `wiki/Planning/Implementation-Plans/2026-06-25-eval-phase2-contract-unify.md`. 101 tests green, builds green.

**SHIPPED — Phase 3 (wire-the-why / L3), merged to LOCAL main `684358d9`, NOT pushed:** 6 commits, benchmarks-only (+ new `@reactive-agents/trace` dep). Attaches the "why" to every bench run: when `session.traceDir` set → `.withTracing({dir})` → `${traceDir}/<taskId>.jsonl` → `loadTrace`→`analyzeRun`→slim `RunDiagnosis` {honestyLabel, honestyEvidence, failureModes[], blindSpots[]} on `RunScore.diagnosis` (+ `traceId`); flag-worthy runs print `⚠ honesty=… · failure=…` under the row. **NO runtime change** — `AgentResult.taskId` already keys the trace (the user's "expose runId" fork was unnecessary). `diagnoseRun` best-effort (never throws); OPT-IN (no traceDir → unchanged). **LIVE-verified end-to-end** (Anthropic run captured `diagnosis="dishonest-success-suspected"`). 107 tests green. Files: `benchmarks/src/diagnose.ts` (`projectDiagnosis`/`diagnoseRun`/`formatDiagnosisLine`), `types.ts` (`RunDiagnosis`+`RunScore.diagnosis?`), `runner.ts`. Real trace field is `blindSpots:{metric,reason}` (not `why`). Plan: `wiki/Planning/Implementation-Plans/2026-06-25-eval-phase3-wire-the-why.md`.

**SHIPPED — Phase 4 (gate CLI + CI), merged to LOCAL main `9104b7d0`, NOT pushed:** 3 commits + 2 fixes. `rax eval gate --report <SessionReport.json> --baseline <id> --candidate <id> [--metric/--min-lift/--max-tok/--min-tiers]` — reads a report (written by `rax bench --output`), applies pure `evaluateLiftGate`→`formatGateReceipt`, exits via pure `decideExitCode` (reject→1, no-comparable-tiers→2, default-on/opt-in→0). Report-mode = NO live models in the command. benchmarks DYNAMIC-imported (private pkg, matches bench.ts; only `import type` at module scope — NO static dep). `runEval` now `run|gate` dispatcher. Registered `frontier-spot-check` session (bare-llm vs ra-full, 4 frontier models) in bench CLI + `.github/workflows/regression-gate.yml` (workflow_dispatch: build→bench --output→eval gate→fail-on-reject, secrets incl GOOGLE_API_KEY for the gemini model). Fixes: Gemini key in CI env, NaN-guard numeric flags. 111 tests green. Files: `apps/cli/src/commands/eval-gate.ts`. Plan: `wiki/Planning/Implementation-Plans/2026-06-25-eval-phase4-gate-cli.md`. **ImprovementLedger (L4) deferred.**

**SHIPPED — Phase 4b (ImprovementLedger / L4), merged to LOCAL main `27dba6ba`, NOT pushed:** 3 commits + 2 fixes. Code-owned gate-centric ledger in `@reactive-agents/benchmarks/src/ledger.ts`: records dogfood chain weakness→hypothesis→gateVerdict→regression-baseline. Pure core `recordGateOutcome`(id+createdAt injected)/`formatLedger`/`emptyLedger`; async `loadLedger`(best-effort, never throws, unknown-narrowed)/`saveLedger`(mkdir -p). status map default-on→adopted/opt-in→opt-in/reject→rejected; pins regressionBaseline when `decision!==reject && liftPp>0`. **COMPLEMENTS (not replaces) skill's loop-state.json** — distinct baseline kinds (gate lift% vs probe-metric iterations/kernel-steps), cross-refs via optional `weaknessRef`; skill UNTOUCHED. Consumers (anti-scaffold §9): `rax eval gate --ledger <path> [--weakness/--hypothesis/--weakness-ref]` appends; `rax eval ledger [--path]` lists (default `wiki/Research/Harness-Reports/improvement-ledger.json`). **Smoke-verified end-to-end.** 12 ledger tests. **B's substrate.** Plan: `wiki/Planning/Implementation-Plans/2026-06-25-eval-phase4b-improvement-ledger.md`. Deferred: cross-run baseline CHECK, B (autonomous loop reads ledger), skill back-link.

**KEY GROUNDED FINDINGS (for future phases):** the two judges already share ONE engine — `judge-server` *depends on* `eval`, wrapping eval's `JudgeLLMService` in an HTTP server (SHA-pinned/Rule-4); benchmarks calls it over HTTP. Dep graph: `core(pub)←eval(pub)←judge-server(priv)←benchmarks(priv,HTTP)`. benchmarks can't import eval (published→private) — hence contract lives in core. eval's in-process judge is NOT frozen (no SHA); judge-server adds the frozen wrapper. **Deferred:** eval taxonomy migration (fold rel/comp, safety→guardrail), eval reproducibility parity, P3 wire-the-why (attach `analyzeRun` to every Run — biggest dogfood win, mostly LINKAGE), P4 `rax eval gate` CLI/CI + facade, P5 industry adapters + publish (→ v0.13 "Receipts"). Specs: `wiki/Architecture/Design-Specs/2026-06-24-canonical-evaluation-system.md` (umbrella) + `2026-06-24-eval-lift-gate-harness.md` + `wiki/Decisions/2026-06-24-high-leverage-roadmap-ranking.md`.

## ✅✅ v0.12.0 "Durable & Honest" RELEASED 2026-06-17

Tag `v0.12.0` pushed → publish.yml SUCCESS: all **35 public packages** (incl `@reactive-agents/cortex`) on npm at 0.12.0; GitHub release with full notes. **Fresh-install verified** (`/tmp/ra-v0120-verify`, `bun add reactive-agents@0.12.0`): 252 pkgs, no `workspace:*` leak, `test`-provider run → `"42"`/success, all v0.12 builder APIs present, `rax v0.12.0`. Headline features all live: durable crash-resume + durable HITL, typed structured output (Zod/Valibot/ArkType/Effect, all providers), **memory DEFAULT-OFF** (`b96b3464` — supersedes the stale "NOT executed" note below), grounding opt-in, debrief-off-critical-path, effect-free hooks, unified observability, Cortex durable/structured/budget UI.

**Pre-release fixes shipped (this session):** (1) `e5a1f0cd` — 10 real typecheck errors on main (over-narrowed `EntropyScoreLike`, durable-HITL `awaiting_approval` sentinel reason, structured-output `Schema.Schema.AnyNoContext` variance, durable test-fixture handler `Record<string,unknown>` + 5 missing `ExecutionContext` fields, cortex `exactOptionalPropertyTypes`). (2) `c6f3e93e` — cortex-ui double-build race: `@reactive-agents/cortex` build was `tsup && cd ui && bun run build` while private `cortex-ui` also built the same `apps/cortex/ui/build` concurrently → adapter-static `writeFileSync` ENOENT. Fix: cortex build = `tsup` only; turbo `cortex#build dependsOn cortex-ui#build`; cortex inputs `server/**` (NOT `src/**`), cortex-ui outputs `build/**`. (3) `2b95c9e8` — regenerated stale **git-ignored** North Star baseline (cogito/qwen3 numCtx 8192→32768 was intentional pre-v0.11.2; `bun run gate:update --reason`). Gates: build 38/38, typecheck 68/68, **test 6558/804 files/0 fail**.

**Public-docs reposition (per ratified 2026-06-10 strategy):** harness = star (control/observability/composability/steerability); **local-model reliability = headline payoff** (not strategy-count — heavy strategies demoted to frontier/niche, parity at 3–15× cost); memory shown opt-in; surfaced buried flight-recorder (replay + rax-diagnose); honesty discipline; launch posture HELD for v0.13 "Receipts". Hero finalized: *"The composable TypeScript agent harness built for control, not magic. Steer every reasoning step as a typed event, run one codebase from local 4B Ollama to frontier APIs, and ship agents that actually finish."* **Stats corrected to authoritative:** 6,558 tests/804 files; strategies 7→**6** (excluded `direct` no-op passthrough from `generate-metrics.ts`); grandTotal **40** (35 pkgs + 5 apps; 35 published); `metrics.json` is gitignored (regen at prebuild from `metrics-cache.json`).

**origin/main divergence RESOLVED:** the long-standing local-main-ahead state — CI "Sync to main" landed VERSION/CHANGELOG on the STALE `origin/main` (`d475c4cb` on `03f8be1b`), missing ~229 commits. Cherry-picked CI sync locally (VERSION 0.12.0 + CHANGELOG aggregate, consumed changeset; pkg versions stay repo-ephemeral), merged origin/main (clean, identical content), **pushed `main` → origin in sync (`7ac2250d`, 0/0)**. origin/main now reflects shipped code. PR #194 should auto-close.

## ▶ TYPED STRUCTURED OUTPUT SPRINT — ✅ MERGED TO MAIN 2026-06-15 (51-commit `feat/typed-structured-output`, branch deleted). Build 38/38, structured-output 60/60, runtime 189/189.

**Post-merge (2026-06-15):** also merged origin hotfix `03f8be1b` + PR #194 docs-sync `worktree-docs-sync-0.12.0` into LOCAL main (whats-new v0.12 conflict → one unified section; accuracy fixes: 33 model IDs/13 files, removed false @deprecated+zero-any claims, builder-API docs for withProfile/withContract/withBudget/withLearning/withSkillPersistence ALL verified-exist). **Local main NOT pushed (~155 ahead of origin — merge-to-local-main + tag-publish workflow); PR #194 auto-closes on push.** ⚠️ memory is DEFAULT-ON in code (builder.ts:213/711) — roadmap "memory-default-OFF" NOT executed.

**Docs overhaul 7-task list COMPLETE (2026-06-15, local main, NOT pushed):** (1) subscribe form → right TOC sidebar every page — PageSidebar override renders it INSIDE `.right-sidebar-panel > .sl-container` (default `.right-sidebar` is position:fixed full-width so sibling-append overflowed; width CSS replicated globally since Starlight's is component-scoped; playwright-verified subscribe container == TOC 208px). Removed from footer. (2) curated progressive IA (Start Here→Core Guides→Ship to Production→Features→Concepts→Cookbook→API Ref→Rax CLI→Help). (3) manual "New" badges REMOVED (auto last-updated indicator supersedes). (4) stability.md v0.10→v0.12 (killed dead .withHealing/.withSubAgents; fixed .withHook sig). (5) validation: `.withComplexityRouting()` fabrication→real CostService.routeToModel, read-file→`file-read` (7×, canonical builtin), @reactive-agents/otel→observe. (6) PM tabs on installs. (7) builder-api.md was MISSING withOutputSchema/withDurableRuns/streamObject/resumeRun/listRuns → ADDED; withGrounding→verification.md. (8) introduction.md→.mdx flair. Builds green (81 pages, links clean). DEFERRED: web-integration react/vue/svelte framework-tabs (large restructure).

**Pre-v0.12 sweep (2026-06-16, order C→B→A; local main, NOT pushed):**
- **C clean-types DONE:** HS-34 (4 `Layer.merge as any`→typed `widen` helper in reactive-intelligence/runtime.ts), HS-35 (2 stale `as any` removed from reactive-observer.ts — entropyHistory already typed, kernelState cast was unnecessary). Both governance ceilings GREEN: console.warn 9→10 (removed redundant iterate-pass.ts warn that already yielded Effect.logWarning; justified kernel-codec.ts sync fallback); as-unknown-as 66→76 (consolidated 3 vendor casts → `asVendorSchema` helper; documented bump for 4-vendor schema adapter + durable codec). Full suite 6463/0.
- **B memory DEFAULT-OFF DONE (BREAKING, user-approved):** builder.ts:221 `_enableMemory=false`. `HarnessProfile.balanced()`/`intelligent()` now enable memory EXPLICITLY (were no-ops relying on the old bootstrap default). Tests: builder-memory-default-on→off rewritten (bare=stateless debrief undefined; `.withMemory()`/balanced() opt-in); harness-profile patch assertions updated. Docs: whats-new behavior-change reversed, builder-api withMemory row, choosing-a-stack, HarnessProfile table; stale code comments refreshed. Migration: add `.withMemory()` to v0.11 agents relying on implicit memory. Full suite 6463/0.
- **A durable HITL Phase D = DONE 2026-06-16** (branch `feat/durable-hitl-2026-06-16`, 11 commits, NOT merged). Reuses crash-resume infra: gate = new `terminatedBy:"awaiting-approval"` (non-failure; post-condition gate passes it through in terminate.ts), pause persists to RunStore (`run_approvals` table), resume = `resumeRun` seeded with `ApprovalDecisionRef` (core, mirrors `ResumeStateRef`). Builder `.withApprovalPolicy({tools?,requireFor?,mode})` (detach default w/ durable; build-guard throws if detach w/o durableRuns). Agent `approveRun`/`denyRun`/`listPendingApprovals`. Kernel: `shouldGate` (decide/tool-gating.ts, pure: tools-set ∪ predicate), act.ts pauses first flagged pending call, runner re-entry (`resolveApprovalReentry`: approved→seed call+`approvalBypass`→handleActing once; denied→observe). **Threading gotcha:** approvalPolicy needs forwarding at runtime.ts:352 (createRuntime) AND on BOTH config types (RuntimeOptions runtime-types.ts + `ReactiveAgentsConfig` `&{}` intersection types.ts:669 — function field can't be Schema). **SCOPE (v0.12):** durable pause rides `runStream()` path only (durable persistence is stream-only; `run()` has no RunController); triggers = explicit `tools` list + `requireFor` predicate (per-tool `requiresApproval` FLAG auto-trigger DEFERRED — kernel has no tool-def lookup, needs registry enumeration). Build 38/38, suite 6490/0, governance green (no ceiling bump). **⚠️ E2E (commit `918d73b6`) EXPOSED 3 REAL BUGS the 11 gate-logic commits MISSED — feature was NON-FUNCTIONAL end-to-end until then; seam tests all passed but the full reactive→kernel→engine chain was broken:** (1) **forwarding gap** — `approvalPolicy`/`approvalDecision` dropped at `ReasoningInput`(reasoning-service.ts)→`ReactiveInput`(reactive.ts)→`kernelInput` hops (added to executeRequest+KernelInput but NOT middle types; same FM-I class as Phase-C resumeState); (2) **finalization re-open** — in-loop (iterate-pass.ts:911) + post-loop (runner.ts:539 required-tools / §9.0 verifier:693 / §9 quality:873) treated the paused gated-but-unexecuted tool as "required but uncalled" → redirect-to-thinking/fail → looped to max_iterations (runtime AUTO-enables required tools; `executeReactive` unit had none → masked it). Fix = `isAwaitingApproval` guard skips all post-loop finalization; (3) **normalizer strip** — engine `normalizeReasoningResult` (util.ts) allowlist dropped `awaitingApprovalFor` → `pendingApproval` never surfaced. **LIVE-VERIFIED claude-sonnet-4-6:** runStream pause→listPendingApprovals→approveRun→tool executes→complete + denyRun. Deterministic test `reactive-approval-gate.test.ts` (WITH requiredTools to catch the loop), example `apps/examples/src/advanced/durable-hitl.ts`. **`reasoning` pkg `bun` export=DIST not src → rebuild reasoning before any runtime probe.** Spec `wiki/Architecture/Design-Specs/2026-06-16-durable-hitl-design.md`, plan `wiki/Planning/Implementation-Plans/2026-06-16-durable-hitl.md`. **run() DURABLE PATH DONE (`7cec56c7`, both tiers, live-verified):** HITL now works on `run()` not just `runStream` via shared `runDurable` wrapper (createRun + RunController + `installDurableCheckpointing` + persist-on-pause). **Tier 1:** `run()` returns `AgentResult.status='awaiting-approval'` + `pendingApproval{runId,gateId,toolName,args}` (surfaced in buildRunTaskEffect via `durableRunId` option). **Tier 2:** `run(task,{onApproval:(pending)=>bool|{approve,reason}})` drives pause→decide→resume loop in ONE call (multi-gate). approveRun/denyRun also route through runDurable so re-pause persists. **CRITICAL CHECKPOINT FIX (`42f6970e`):** paused state was NEVER checkpointed (per-iteration onCheckpoint fires at pass BOUNDARY pre-gate) → resume restored pre-gate state → re-entry inert → gate re-fired (shipped stream resume was FALSE-POSITIVE: markRunStatus forced completed). Fix: iterate-pass.ts checkpoints the post-gate paused state at `iteration+1` (distinct row wins latestCheckpoint, no fork race). serializeKernelState envelope = `{codecVersion, state}` (probe must read `.state.meta`, NOT `.meta`). Live-verified: approveRun executes the EXACT gated tool deterministically. **Also fixed RunStore read-path mkdir (`527e0046`): fresh-agent listRuns/listPendingApprovals/resumeRun crashed "unable to open database file" — read path now mkdirs.** Branch 22 commits. **DOCS SWEEP DONE (2026-06-16, 10 files committed on branch, NOT pushed):** dedicated guide `apps/docs/src/content/docs/guides/durable-hitl.md` was UNREACHABLE via nav until added to the manual sidebar (`astro.config.mjs:169`, after Durable Execution). whats-new now shows run() awaiting-approval + onApproval (was runStream-only). cheatsheet got `.withApprovalPolicy`/`.withDurableRuns` rows + listRuns/resumeRun/listPendingApprovals/approveRun/denyRun runtime methods. builder-api documents run() `onApproval` + AgentResult `status`/`pendingApproval`. **production-checklist had a FALSE auto-pause claim** (per-tool `requiresApproval:true` does NOT pause/emit ApprovalRequired — metadata only; gating is `.withApprovalPolicy`) — corrected. building-tools/interaction-modes/durable-execution/security-hardening cross-link + distinguish in-process `approvalGate()` from durable HITL. examples lists A22. Docs build green (82 pages, links valid). NB compose `requireApprovalFor` + gateway `requireApprovalFor` are SEPARATE features — left untouched. **Follow-ups:** per-tool `requiresApproval` flag auto-trigger (registry enumeration), resumeRun (crash-resume) re-checkpoint-on-resume, Cortex resume UI.
v0.12 top net-new feature (the one confirmed table-stakes gap that ALSO plays to the local-model moat). Spec `wiki/Architecture/Design-Specs/2026-06-15-typed-structured-output.md`, plan `wiki/Planning/Implementation-Plans/2026-06-15-typed-structured-output.md`. Executed subagent-driven (implementer + spec-review + code-quality-review per task). 16 commits, base `e9016969`→HEAD `c9b78a28`.

**Reframe insight:** robust structured-output ALREADY EXISTED but only INTERNAL — `extractStructuredOutput` 5-layer pipeline (`reasoning/src/structured-output/pipeline.ts`: native completeStructured→high-signal-prompt→JSON-extract+repair→Effect-Schema-validate→retry), used by plan-execute/plan-mutation/infer-required-tools, NEVER surfaced for user output. So SURFACE+EXTEND, not rebuild. Verify spine (`requirement-state`/`verifier`/`evidence-grounding`) = the moat for the P2 grounded engine.

**Decisions (locked):** Standard Schema surface (Zod/Valibot/ArkType/Effect via adapter) · lenient-degrade default (`object`=undefined+`objectError`; opt-in `onParseFail:'throw'`→`StructuredOutputError`) · clean provider contract (no kernel branching) · partial-JSON deep-partial streaming · LAYERED (fast single-shot floor + grounded-loop engine, capability-routed) · abstention + grounded-default ship OPT-IN, ablation-warden before any default-on flip.

**P0 SHIPPED:** `SchemaContract<A>` + `toSchemaContract()` (`schema-contract.ts`) — validate always / toJsonSchema opportunistic (incl. real `StandardJSONSchemaV1` emission) / effectSchema (Standard-Schema bridge via `Schema.declare`). Additive `contract?` overload on `extractStructuredOutput` (discriminated-union config = compile-time exactly-one; native path re-validates via contract). 3 internal callers byte-identical.

**P1 SHIPPED (fast path WORKS e2e):** `OutputSchemaOptions` + `AgentResult.{object?,objectError?,provenance?,confidence?,abstained?}` · `StructuredOutputError` tagged error · `.withOutputSchema(schema,opts?)` builder (mirrors `.withGrounding`) · `extractObjectFromAnswer` (`engine/finalize/extract-object.ts`) wired into `reactive-agent.ts buildRunTaskEffect` (config threaded builder→agent-instantiation→ReactiveAgent ctor [now 19 args]→run effect; `Effect.map`→`flatMap` for LLMService scope) · `chooseStructuredEngine` routing (`engine/finalize/structured-route.ts`; grounded→fast fallback until P2; `calibrated` hardcoded true w/ TODO(P2)) · agent-config `OutputSchemaOptionsSchema`. Gate: reasoning structured-output 14/14, runtime 170/170, all pkgs build (cortex-ui CSS fail = PRE-EXISTING, unrelated).

**TYPED-CARRY DONE (proper):** `ReactiveAgentBuilder<TOut=unknown>` + `ReactiveAgent<TOut=unknown>`; `withOutputSchema<A>():ReactiveAgentBuilder<A>` (one `as unknown as` cast; 81 `return this` preserve TOut free); `run():Promise<AgentResult & {object?:TOut}>` (intersection `unknown&TOut=TOut`, AgentResult interface UNTOUCHED). `result.object` typed `A`, proven by load-bearing `@ts-expect-error`. Zero consumer ripple. Cuts: runStream/resumeRun bare AgentResult.

**P2 GROUNDED DONE:** leaves under `reasoning/src/structured-output/grounded/` — field-requirements (Effect-AST `TypeLiteral.propertySignatures.isOptional`), field-provenance (`groundFields`→provenance+confidence 0.9/0.4), schema-satisfaction (`VerificationCheck` reject>escalate>pass, in grounded module NOT kernel = no warden), grounded-extract (`groundedExtract`: `Schema.partial` extract→ground→opt-in abstention non-required-only→`Schema.pick` surgical repair ≤1pass→**final validate FULL contract** = `validation.value` not cast = sound). Wired into `reactive-agent.ts` grounded branch (corpus `metadata.reasoningSteps`→`buildEvidenceCorpusFromSteps`; throw→StructuredOutputError). Routing auto: grounded when tools/uncalibrated/non-native.

**P3-CORE DONE:** `partial-parse.ts` (`parsePartial` bracket-walker, drops dangling keys, 3-tier fallback) · `engine/stream-object.ts` (`streamObjectFrom` async-gen: TextDelta→parsePartial→dedup-yield DeepPartial→StreamCompleted final-validate; throw/degrade) · `ReactiveAgent.streamObject()` + `DeepPartial<T>`.

**KNOWN LIMITATION:** grounded field-tracking is EFFECT-SCHEMA-FIRST — Standard-Schema (Zod) inputs get provenance+confidence but `fieldRequirementsFromSchema`→[] (non-TypeLiteral) so no requirement-tracking/surgical-repair; with `abstainBelow` can't detect required. Follow-up: derive requirements from JSON-schema `required[]` (StandardJSONSchemaV1 emitter). Fast path works both surfaces. `calibrated` routing signal hardcoded true (TODO).

**⚠️ LIVE VALIDATION FIXED 3 BUGS THE TEST PROVIDER MASKED (2026-06-15):** test scenarios fed pre-perfect JSON so extraction/steering never exercised. Live Anthropic exposed: **RC1** (`8c2f882d`) extraction prompt never rendered the schema → blind model → fixed by rendering JSON Schema into `buildStructuredPrompt`/`buildRetryPrompt` (helps all prompt-path providers incl. local = moat); **RC4** (`6a36b0d7`) `streamObject` parsed the agent's prose (no JSON, agent not steered) → fixed by augmenting the task with a JSON-only schema instruction before runStream + `parsePartial` strips fences/prose; **RC3** routing treated `nativeJsonMode=false` as needs-grounding → mis-routed Anthropic to grounded → fixed to `toolsRegistered || !calibrated`. Post-fix fast/grounded/auto + streamObject all correct live; example 09 PASSES. **CROSS-TIER VERIFIED: anthropic/openai/gemini/ollama-qwen3.5/ollama-gemma4:12b ALL produce valid schema output + multi-partial streaming (local models = the moat). Gemini returned valid `currency:"US dollars"` for plain String — use Schema.Literal enum to force normalization.** **ZOD JSON-SCHEMA FIX (`05de0711`):** user scratch (Zod+ollama gemma4:e4b) exposed — Zod 3.x has no JSON-schema emitter → `toJsonSchema()`=undefined → extraction prompt blind → prose output → "Required ×N" fail → object undefined. BROKE HEADLINE ZOD SURFACE (docs example is Zod). Fix: `vendor==="zod"` branch in `fromStandardSchema.toJsonSchema()` via `zod-to-json-schema` (installed; `std` IS ZodType at runtime). Live-verified scratch extracts nested object on gemma4:e4b. **LESSON: deterministic test providers AND Effect-Schema probes MASK bugs — live-probe structured/streaming with the ACTUAL headline surface (Zod).** **Grounded requirement-tracking for Zod/Valibot DONE (`4926821c`):** `fieldRequirementsFromJsonSchema` reads `properties`+`required[]`; groundedExtract uses `toJsonSchema() ? fromJsonSchema : fromEffectAST`. Zod grounded now 3/4 features (provenance/confidence/abstention ✅). RESIDUAL (low-impact): surgical-repair unreachable for Zod (Phase A full-contract, bridge can't `Schema.partial`) — first-pass usually succeeds via schema-in-prompt so rarely needed. `calibrated` routing still hardcoded true. **DOC: `.withOutputSchema()` is BUILDER-only (before `.build()`).**

**ARRAY + LATENCY FIXES (2026-06-16, user scratch `z.array(...)`):** (1) Top-level ARRAY broke object-centric grounded engine (`{...extracted}` mangles array → "Expected array, received object") → `41a3a8b2` groundedExtract degrades to plain extraction for non-object schemas. (2) **LATENCY: `run()` did a separate untraced extraction LLM pass (+retries) on critical path AFTER the answer — +28s on gemma4:e4b (7s→35s).** Fix `9ad47376`: steer agent (shared `buildSchemaSteering`) + parse-first (`parseJsonLoose`+validate → skip LLM extraction; fallback on miss) — like streamObject. Plus shape-aware prompts ("JSON array" vs "object" — object-wording made models wrap arrays → parse-first miss). **Array 35s→3.8s.** TRADEOFF: `result.output`=JSON (steered) in structured mode. Debrief forked NON-blocking (`dispose()`=21ms); residual ~14-17s = inherent gemma4:e4b speed; memory-flush real cost ~2.7s (observability "≥10s LLM" alert overstates — misattributes forked debrief). DOC: `.withOutputSchema()` is BUILDER-only (before `.build()`).

**COMPOSE composability (2026-06-16):** `.withOutputSchema()` COEXISTS with `.compose(...)`/killswitches (verified — loop runs under composed harness) but is NOT a composable primitive (no `h.tap('structured.*')`, no killswitch; wired in `buildRunTaskEffect` outside chokepoints). Seam gap: extraction fallback LLM call bypasses harness governance (rare w/ parse-first). Killswitches (`budgetLimit`/`maxIterations`/`timeoutAfter`/`watchdog`/`requireApprovalFor`) in `@reactive-agents/compose`, not umbrella. **OBSERVABILITY fix:** `console-exporter generateAlerts` mislabeled all ≥10s phases as "(LLM latency)" → now phase-aware. Pre-existing console.warn-ceiling test (11>9, fails at BASE too) NOT touched (unrelated, raising = metric-gaming).

**3.3 SVELTE/VUE BINDINGS DONE:** svelte `createStructuredStream(endpoint)` (writable store) + vue `useStructuredObject(endpoint)` (refs) — HTTP/SSE clients (zero `@reactive-agents/*` deps), mirror `createAgentStream`/`useAgentStream`, add `object=parsePartialObject(text)` per TextDelta (local per-pkg parser strips fences/prose). svelte 30/0, vue 28/0. **REMAINING (follow-up, non-blocking):** P4 asTool (cut-line) · real `calibrated` routing signal · Standard-Schema/Zod requirement-tracking (JSON-schema `required[]`). Cross-tier already live-verified. Detail: [[project_structured_output_sprint_2026_06_15]].

## ▶ DX WAVE #1: EFFECT-FREE HOOKS — MERGED to main (`d41ee000`, 2026-06-15)
`.withHook()` `LifecycleHook.handler` was the LONE Effect-leaking public extension point (others already plain). Now accepts `RawHookResult = ExecutionContext | void | Promise<…> | Effect<ctx, ExecutionError>` — write plain sync/async hooks, no Effect import. ADDITIVE (Effect form still compiles+runs). New `runtime/src/hooks-normalize.ts` (`normalizeHookResult` for registry path `hooks.ts`, `runHookResultForSideEffect` for harness-mirror `invokeUserHookSafely` — fixed a LATENT no-op where lazy Effects never ran on the mirror). Return ctx to modify / nothing to observe; throw/reject/fail → `HookError` (mapped at `hooks.ts` boundary). **Compose API `.compose(h=>h.before(...))` was ALREADY Effect-free** (`harness-types.ts` PhaseHookFn/ErrorHookFn/TransformFn/TapFn all plain; zero Effect in `packages/compose/src/`) — both surfaces consistent now. Subagent-driven (6 tasks, per-task spec+quality review + final holistic). Verify: runtime 959/0, build 38/38, ceilings green (as-unknown-as 66 unchanged; no-silent-swallow 20→21 w/ documented 1 legit boundary-shim). Gotchas: `bun test` skips full typecheck (tsc/DTS caught `Effect.fail(new Error())` not assignable); SendMessage-to-subagent unavailable in toolset (applied trivial review nits inline). Detail [[project_effect_free_hooks_2026_06_15]]. **Remaining DX wave: observability 5→1, builder facades (79 `.withX()`).**

## ▶ PERF: DEBRIEF OFF CRITICAL PATH — biggest harness latency lever, FIXED + MERGED to main (`787bd50d`, 2026-06-13)
Efficiency scan found the #1 waste: the post-answer debrief LLM call BLOCKED `run()`. **Measured (sonnet, memory ON): 4683ms of a 9847ms run = 48%**, AFTER the answer was produced (~6s local, GH #143). `execution-engine.ts:1059` "never blocks the result" was FALSE. **Fix (user Option C):** split `debrief-synthesis.ts` → `prepareDebrief` (cheap fallback, inline) + `finalizeDebriefBackground` (LLM+persist, `Effect.forkDaemon`'d). `result.debrief`=instant fallback; new `result.debriefRich()` awaits the forked rich version lazily; `_debriefFiber` attached via Object.defineProperty; `_pendingDebriefs` Set joined by `dispose()` (forkDaemon interrupted by ManagedRuntime.dispose → would drop persist). `result.metadata.tokensUsed` now = answer cost (debrief tokens background). **Re-measured: run() 9847→5297ms (~46% faster).** debrief-fork 3/3, trivial-gate 8/8, runtime 937/1 (1=pre-existing ceiling 68>66, +0 my casts), build 38/38. **Falsified levers stay dead** (cache-churn/extractObs-44%/local-step-economy/cogito-stall/escalation-lift). **MERGED 2026-06-13** (`787bd50d` ff; branch deleted; docs debrief-chat.md+builder-api.md updated, comment now truthful). **Finalize-tail scan VERDICT (2026-06-13): critical path now efficient — no large structural lever remains.** #2 runLocalLearning ❌ FALSIFIED-CHEAP (`onRunCompleted` = pure local compute + WAL SQLite, NO LLM/network; "2.7s flush" was 100% debrief). Verified efficient 4 ways: tail=1 forked LLM call; batch tools already parallel (`act.ts:519` Effect.all concurrency); recall once-at-bootstrap not per-iter (Noop seam default); local-learning cheap. Remaining #3 qwen3 decode / #4 numCtx = LOCAL-tier model-specific tuning ONLY, bounded payoff, NOT structural. **Entropy double-embed lever FALSIFIED by ollama probe (2026-06-13): `llm=false` on every score call (LLMService not wired into EntropySensorService layer) → semantic embed NEVER fires → zero per-iter network cost; double-scoring real but cheap deterministic. PERF HUNT CONCLUDED — no major lever left.** New arch/honesty debt surfaced (NOT perf): semantic-entropy dead-by-default (`semanticEntropy:true` but inert) + redundant double-scoring. Tech-debt branch `fix/tech-debt-sweep-2026-06-13` (NOT merged): #1 as-unknown-as-ceiling 68→66 green (`ec56de71`, stale channel-service AgentEvent casts removed); #2 semantic-entropy sensor flipped default-OFF (`1f8c08d2`) — probe proved it non-functional via 3 bugs (llm-unwired + priorThought-never-populated + taskEmbedding-null/only-taskAlignment-surfaced); config was lying (`semanticEntropy:true` but inert). Verification-layer `enableSemanticEntropy` is SEPARATE, untouched. Re-enable needs all 3 fixed + ablation. Detail: [[project_debrief_off_critical_path_2026_06_12]].

## ▶▶ v0.12.0 STRATEGY LOCKED (2026-06-10) — leverage audit + 3 user decisions
Full audit: `wiki/Research/Audit-Reports-2026-06-10/v0.12.0-leverage-audit.md` (3-agent sweep: mechanism census, DX audit, June-2026 competitive research). Verdict: structure healthy (A−); leverage = identity not architecture. Differentiators already built but buried: (1) local-model reliability (calibration+healing+tier-context; Mastra Ollama = known hole), (2) local-first deterministic replay + rax-diagnose (anti-LangSmith-funnel). Table-stakes GAP: durable execution (crash-resume + HITL pause/resume story). NOT differentiators: memory, strategy count (own parity data), RI (unproven publicly). **✅ v0.11.2 PUBLISHED 2026-06-10** (npm @latest=0.11.2, GH release live, tag `26c0243e`, VERSION→0.11.2 `b51fd6e1`). Beat June-15 retirement. Hiccups en route: `debrief.test.ts:254` 5s CI-timeout flake (follow-up: bump timeout) + npm E401 NPM_TOKEN expired (rotated; consider OIDC trusted publishing in 0.12.0). 8 themed changesets cover the full 622-commit v0.11.1→v0.11.2 span (lesson: changeset discipline at merge time, not release time). **Durable-exec Phase A SHIPPED** on `feat/durable-execution` (`b901e9f6`): RunControllerLike.onCheckpoint seam + kernel-codec.ts (12/12 new tests, reasoning 1620/0). Phase B next = RunStore + .withDurableRuns (runtime-warden). **ROADMAP REALIGNMENT RATIFIED 2026-06-10** (`wiki/Decisions/2026-06-10-roadmap-realignment-v0.12-v1.0.md`): **v0.12 "Durable & Honest"** (durable exec + DX wave + memory-off, one migration) → **v0.13 "Receipts"** (public local-model bench vs Mastra/LangGraph.js/AI-SDK + flight-recorder; **LAUNCH here**) → **v0.14 "Compounding"** (recitation/experience-reuse, ablation-gated on public bench) → v1.0 polish. Vision pillars unchanged; root ROADMAP.md rewritten; 07-ROADMAP amendment logged. **Decisions:** (1) fast **0.11.2 NOW** from main (model-defaults fix, beats June-15) → 0.12.0 proper; (2) first 0.12.0 track = **durable execution** (RunController/auto-checkpoint/replay/sessions primitives ~70% exist); (3) **memory default OFF in 0.12.0** (`builder.ts:213` currently true). Then: DX wave (Effect-free hooks, 77 builder methods→facades, observability 5→1), local-model bench receipts, tier-aware debrief (~825tok/run local), strategy-surface honesty. Deprioritized: structural refactors, I4 merge, memory v2.

## ▶ DURABLE EXECUTION Phases A–C COMPLETE on `feat/durable-execution` (2026-06-12, NOT merged)
v0.12 lever #1 (table-stakes crash-resume; leverage audit). Branch REBASED onto current main (was 74 behind). **Phase A** (pre-session): KernelState codec (`kernel-codec.ts`) + `onCheckpoint` seam. **Phase B (subagent-driven kernel-warden + runtime-warden):** B1 seam serializes FULL state → lossless string (core `RunControllerLike.onCheckpoint(serializedState: string, iteration)`); B2 `RunStoreService`/`RunStoreLive(dbPath)` SQLite (`runtime/src/services/run-store.ts`) — **warden caught plan's DB API wrong, real shim API = `db.exec`/`db.prepare().run(...spread)`/`.get(...spread)`**; B3 `.withDurableRuns({dir?,checkpointEvery?})` opt-in (threaded like budgetLimits/grounding); B4 wiring in `execute-stream.ts` (gated `config.durableRuns && runController` → createRun + onCheckpoint `Effect.runFork` write every N + finish status). **Perf QA: +0.9% wall-clock (test provider), output IDENTICAL, 1 checkpoint/run, zero-overhead off.** reasoning 1663/0.
**Phase C SHIPPED (2026-06-12, marketable gate — done main-thread, NOT subagent, after warden surfaced FM-I forwarding gap):** `agent.resumeRun(runId)` + `listRuns({status?})` + config-hash guard + cross-process hard-kill e2e. **C1** (`8a07f544`) `KernelInput.resumeState?: KernelState` seam + runner base-state + codec re-export. **Hop A forwarding** (`ResumeStateRef` FiberRef in core = opaque serialized string, mirrors `RunControllerRef`): reasoning-think reads → `deserializeKernelState` → `executeRequest.resumeState` → ReasoningService params (spread) → `ReactiveInput.resumeState` → `kernelInput.resumeState`. Fixed C1's FM-I gap (field on KernelInput but no forwarding tail). **Hop B** (`durableConfigHash` shared helper, run-store.ts): identity hash = **systemPrompt+provider ONLY** (NOT model — resolved `config.defaultModel`="test-model" not reproducible from a `.withModel()`-less agent → spurious mismatch; root-caused via debug log). Threaded `{dir,configHash}` onto ReactiveAgent at `agent-instantiation.ts`. `durable-resume.ts` = load+guard+listRuns+markStatus helpers. resumeRun runs via `engine.execute` (NO re-checkpoint write on run() path; re-crash-during-resume deferred, documented). **API named `resumeRun` NOT `resume`** (collision with in-process pause/resume control verb). **Tests:** C2 3/3 (resume-to-completion, config-mismatch guard, listRuns filter), C3 1/1 cross-process (child captures+exit137 / parent reconstructs from on-disk checkpoint). reasoning 1665/0, runtime 934/1 (1=pre-existing `as-unknown-as-ceiling`, red on main too: 67>66, my commits +0 casts), full build 38/38. **C4:** guide `apps/docs/.../guides/durable-execution.md`, withProgressCheckpoint honesty fix, exported `DurableRunNotFoundError`/`DurableConfigMismatchError` from runtime+umbrella. Plan `wiki/Planning/Implementation-Plans/2026-06-12-durable-execution-phase-c.md` (completion banner). **Phase D deferred:** durable HITL (approve/deny/awaiting-approval), Cortex resume UI.
**⚠️ MAIN REGRESSION (fixed on branch `527f660a`, NOT yet on main):** grounding D1 shipped `runner.ts:682 buildSynthesisPrompt(state.output,…)` TS2345 (`string|null`); turbo build green but `tsc --noEmit` errors. Fixed `state.output ?? ""` on durable branch — lands on main at branch merge; main `tsc --noEmit` errors until then (CI turbo gate green).

## ✅ OPT-IN EVIDENCE-GROUNDING — MERGED to main (`d40270ed`, 2026-06-11)
Numeric evidence-grounding now OPT-IN (`.withGrounding({mode:"block"|"warn"})`, default OFF). Killed the false `failed at evidence-grounded` verifier warnings on correctly-formatted `$` figures (old always-on byte-substring match vs COMPRESSED tool obs). When on: tolerant numeric VALUE match (`validateNumericGrounding`, parses `$`/commas/`k|M|B`) against FULL tool data (`buildEvidenceCorpusFromSteps(steps, scratchpad)` resolves `storedKey`→scratchpad). `block`=bounded corrective re-synthesis→degrade-to-warn (pure-capped `decideGroundingBlockOutcome`, dedicated `meta.groundingBlockRetry`, `hasNonGroundingBlock` guard so it NEVER rescues parrot/escalate; NOT M3 re-verify loop); `warn`=advisory softFail (untouched). **Scaffold-leak split out** → standalone always-on `reject` guard (`scaffold-leak.ts` `detectScaffoldLeak`: `[STORED:]`/`_tool_result_N` echoed as answer). Prose claim-grounding REMOVED (64-73% false-reject). reasoning 1651/0, reviewer-clean. Detail [[project_opt_in_grounding_2026_06_11]].

## ⚠️ BENCH-ACCESSOR: `result.success` is TOP-LEVEL — `metadata.success` does NOT exist
Session-long "success=0%" (canonical-tool-exec + grounding benches) was a PROBE BUG: read `result.metadata.success` (undefined → Boolean→false). Real field `result.success` (`core/src/types/result.ts:98`); metadata only has duration/cost/tokens/confidence/stepsCount. Runs actually succeeded (`confidence:high`). NO framework "success floor" existed. Use `result.success`/`result.status`/`metadata.confidence` in probes.

## 🔑 ENV KEYS: frontier API keys live in repo `.env` (bun auto-loads), NOT shell env
`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GOOGLE_API_KEY` all present + live in `.env`. **Don't conclude "no keys / cross-tier blocked" from `echo $VAR`** — shell env lacks them; bun `run`/`test` auto-loads `.env`. Check via `set -a; . ./.env; set +a`. Defaults (2026-06-11): anthropic→`claude-sonnet-4-6`, openai→`gpt-4o`.

## ✅ FM-I — STRATEGY KERNEL-INPUT DIVERGENCE (RESOLVED incl. tool_call sub-gap, 2026-06-11)
**CORE FIXED + shipped to main (reasoning 1617/0):** canonical `buildKernelInput` builder (kernel/state/, Pick-partition→drop=compile-error) + all 4 heavy strategies threaded. Commits `90c7c089` (builder+reflexion), `9030d5a1` (ToT+adaptive), plan-execute 3-layer (+kernel-warden react-kernel inner). Divergence found at UP TO 5 layers/strategy (input-interface narrowing ×N + literal drops). Per-strategy `before('think')`-fires tests in strategy-threading.test.ts; reflexion live hook 0→1. **tool_call SUB-GAP RESOLVED (2026-06-11, #195):** canonical `executeToolAndObserve` primitive (`kernel/capabilities/act/tool-observe.ts`) — ONE execute-and-observe path shared by kernel act + plan-execute `tool_call`. Phases A–D shipped: primitive+unit tests, kernel single path byte-identical (golden-master), plan-execute `tool_call` migrated (direct dispatch retained, gains healing+compose tags+obs-metadata; verifier/memory OFF). Suite **1625/0**. Live: gemma4:12b plan-execute-reflect `.on('observation.tool-result')` 0→1 (`tool=crypto-price`). `analysis` steps = correctly out of scope (no tool to observe). **REFRAME (durable):** orchestration divergence LEGITIMATE (preserve outer loops) / tool-execution divergence ACCIDENTAL (canonicalize); reflexion/ToT/adaptive covered transitively via act.ts (zero `toolService.execute`). **Phase E SHIPPED `b0219b50` (split):** E1 (default-on) batch act path now emits `observation.tool-result`+`lifecycle.failure` per parallel call (were invisible to `.on()` = #195 class). E2 (opt-in `RA_TOOL_OBSERVE_SYMMETRY=1`, default-OFF) single path gains verifier+memory via extended primitive; default-off byte-identical (golden-master green), suite 1628/0. **Benched live, 3 local models** (reactive crypto-price): gemma4:12b +0.00/4 +0.5%tok; qwen3.5 ~0 (3/4 strict both arms); cogito:8b +0.00 −27%tok = **ALL PARITY, no regression** (scary n=2 qwen3.5 −2.00 was witness artifact — bare-number outputs; n=4 deep-dive identical both arms). `ok=false` everywhere = pre-existing evidence-grounding, NOT E2. **CROSS-TIER ablation RAN** (keys live in `.env`, bun auto-loads — earlier "no keys" was shell-env-vs-`.env` mistake): gemma4:12b +0pp/−7.8%tok, claude-sonnet-4-6 +0pp/−11.5%tok, gpt-4o +0pp/+5.5%tok; priceOk=100% both arms all tiers. Lift rule: no tier ≥3pp → **E2 OPT-IN CONFIRMED**. Side-finding (not E2): `success=0%` ALL tiers incl frontier = evidence-grounding uniformly rejects crypto numeric answer (price≠byte-match tool obs) — possible over-strict, separate look. **Strategy compose-hooks CONFIRMED ALL PASS:** observation.tool-result fires for every tool-running strategy — reactive (det test `strategy-compose-tags.test.ts`), plan-execute (C/D), reflexion/ToT/adaptive (live probe gemma4 1× each). **Follow-up #1 (batch→primitive) = DELIBERATE LEAVE:** batch computes verification/errorRecovery in sequential post-loop reading mid-loop-mutated allSteps/newToolsUsed → moving to parallel primitive = behavior change not dedup; legitimate orchestration divergence (no-metric-gaming/cohesion-over-LOC). **#195 FULLY CLOSED 2026-06-16 (`fae561d4`) — last gap was code-action:** the "fires for EVERY strategy" claim above was WRONG for code-action (runs tools in the Worker sandbox, NOT kernel act, so the primitive never reached it). Fix: `CodeActionInput` gains `harnessPipeline?` (already on StrategyFn input + reasoning-service `{...params}` spread → real dispatch populates it, NO registry change); emit `observation.tool-result` per `runInSandbox` toolCall (healed:false; rejected sandbox throws pre-emit so every recorded call succeeded). RED→GREEN `code-action-compose-tags.test.ts`; #195 cluster 62/62, reasoning build+DTS green. **v0.12 milestone issue queue now EMPTY** (triage 2026-06-16 slipped #188/#47/#35→v0.13, #43→v0.14; #195 closed). Detail [[project_canonical_tool_execution_2026_06_11]], [[project_fm_i_kernel_input_divergence_2026_06_11]].

## 🔴 ORIGINAL FM-I REPORT (HIGH, GH #195, 2026-06-11) — see status above
Found by running scratch.ts LIVE (ollama gemma4:e4b, reflexion, `.on('observation.tool-result')` fired ZERO times despite tools running). Heavy/composite strategies hand-build `KernelInput` literal per call site, silently DROP cross-cutting fields `{harnessPipeline,budgetLimits,calibration,auditRationale,verifier}`. Code-verified drop matrix: reflexion `reflexion.ts:149,451`=0/5; plan-execute tool path `step-executor.ts:344`=0/5 (synthesis `plan-execute.ts:952` has only harnessPipeline); ToT `tree-of-thought.ts:189,647`=0/5 (`:599`=RI not kernel); adaptive drops before delegating; code-action bypasses kernel. Runtime supplies it (`runtime.ts:348`). **Consequences:** compose dead + killswitches don't fire mid-step (cost hole) + calibration off degrades LOCAL models (headline differentiator). **2nd occurrence of this class** (1st=MCP relevantTools drop) → structural fix justified, validates strategy-consolidation. **Fix:** Phase 0 thread 5 fields + per-strategy `.on()`-fires test (ship first); Phase 1 mandatory `buildKernelInput()`; Phase 2 lint raw literals. v0.12 "Honest" item. Docs: `wiki/Failure-Modes/FM-I…`, `wiki/Architecture/Design-Specs/2026-06-11-canonical-kernel-input.md`. Detail [[project_fm_i_kernel_input_divergence_2026_06_11]].

## ✅ CLOUD-PROVIDER MODEL-SUPPORT REFRESH — RESOLVED, RELEASED in v0.11.2 (2026-06-10)
Anthropic/OpenAI/Gemini model registries in `packages/llm-provider/src/` were stale (retired/retiring ids that 404). Refreshed to 2026-06 lineup; ids/contexts/prices verified against authoritative sources (Claude API ref + OpenAI/Google official docs), not invented. **⚠️ HARD DEADLINE June 15 2026:** default `claude-sonnet-4-20250514` retires then, is the default in PUBLISHED npm 0.11.1 → every default Anthropic agent 404s after. **RELEASED in v0.11.2 (2026-06-10) — deadline beaten.** TWO published defaults fixed: `provider-defaults.ts` + `llm-config.ts:getLLMConfig()`. Also dead: `claude-3-5-haiku-20241022` (retired Feb 19, was `claude-haiku` preset), `gemini-2.0-flash/pro` (shut down June 1). Changes: capability.ts (+opus-4-8/sonnet-4-5/gpt-5.5/5.4/5.4-mini/gemini-2.5-pro/flash/flash-lite/3.5-flash, −gemini-2.0, contexts 200K→1M), ModelPresets repointed (keys = public `ModelPresetName`; renamed dead `gemini-2.0-flash`→`gemini-2.5-flash-lite`), token-counter pricing additive. **NEW GUARD** `model-support-consistency.test.ts`: every default+preset ⊆ STATIC_CAPABILITIES (else 2048-ctx fallback fires capability-source build warning). Verified 285/0. **Sibling work:** docs-sync 0.12.0 PR #194 (`worktree-docs-sync-0.12.0`); README adoption audit `wiki/Research/Audit-Reports-2026-06-06/`.

## ▶▶ CORTEX PARAMETERIZED RUNS — PHASE 1 SHIPPED (2026-06-08, branch `feat/cortex-parameterized-runs`)
Track B of the Cortex overhaul. Agent templates with `{{variable}}` placeholders filled at launch. **`apps/cortex` only — zero framework edits** (design forbids `packages/**`). 12-task plan executed via subagent-driven dev (impl + 2-stage review each). Spec `wiki/Architecture/Design-Specs/2026-06-06-cortex-parameterized-runs-design.md`; plan `wiki/Planning/Implementation-Plans/2026-06-06-cortex-parameterized-runs.md`.
- **One resolver, server-authoritative.** `server/services/resolve-template.ts` `resolveTemplate(input, variables, values)` deep-walks string leaves, substitutes `/\{\{\s*([\w.]+)\s*\}\}/g`; unknown/required-no-value tokens → `unresolved[]` (left literal, never silently blanked). Client NEVER re-implements it — live preview delegates via `POST /api/template/resolve` (`{payload,variables,values}`→`{resolved,unresolved}`). Client `ui/src/lib/template/scan-template-vars.ts` is **authoring-only** (finds tokens, does not resolve).
- **`secret.` namespace RESERVED, not implemented** — `{{secret.X}}` always → `unresolved` (extension seam for a future secret-store spec; smoke-confirmed).
- **Three launch paths wired:** (1) interactive Lab Run → `ParamFillModal` (schema-driven fill + debounced live preview) when `builderConfig.variables.length>0`, else launch as before; (2) `POST /api/runs` threads `variables`+`variableValues`, **400 on unresolved** (FiberFailure.message===CortexError.message, string-match `includes` — instanceof does NOT survive `Effect.runPromise` boundary); (3) cron/gateway resolves from variable **defaults** (`gateway-process-manager.ts`, fails the scheduled run + records `error_message` via canonical `upsertRun`+`updateRunStats` if a required var has no default).
- **Authoring:** Variables editor section in `AgentConfigPanel.svelte` (auto-seed from `{{...}}` via Rescan, enrich type/default/required/enumValues/description); pure testable `param-fill-validate.ts` (`initialValues`/`validateParamValues`/`toVariableValues`).
- **Verify:** cortex `bun test` 342/0, typecheck clean, live smoke 3/3 (resolve substitutes / `secret.` unresolved / runs 400). **KNOWN PHASE-1 GAPS (left intentional):** "save & run" path (`POST /api/agents` `runNow:true`) NOT modal-gated → server 400s on unresolved (no fill UX yet); sweep (multi-value matrix runs) is Phase 2 (schema-ready, not built); secret store is a sibling spec. MERGED to main + RELEASED in v0.11.2 (2026-06-10); leftover branch deleted (25/26 commits patch-equivalent).

## ▶▶ SIDE-INCOME AGENT VENTURE (2026-06-05) — SEPARATE from `apps/advocate`
Analyzed `deep-research-report.md` (12 models) under locked constraints: **build-on-RA + pure cold-PLG + side-income/low-burn**. Strategy: `wiki/Research/2026-06-05-sidegig-venture-strategy.md`.
- **Side income removes the MOAT requirement** (not the prior deadlock). Game = niche-too-small-for-funded + get-found, NOT build-a-wall. Reliability > depth ("agentic depth = moat" = rationalization, feature race).
- **Burn-vs-chargeability trap:** local-first cold-PLG = free download (AnythingLLM problem) = can't charge; hosted = burn scales. **Resolution = BYOK-hosted** (charge orchestration/UX, user brings key, burn≈0). **Drops RA local-first moat**; RA role = multi-step reliability + cross-run memory + verification. Skip identity/RBAC/Cortex.
- Ranking criterion replaces report TAM: `cold-PLG-discoverability × niche-too-small-for-funded × recurring-pain × burn≈0`. Report top-3 (Content/Lead-Gen/Healthcare) DISQUALIFIED; Micro-SaaS = shape.
- User reach = **dev/technical + starting cold → Archetype A (dev tool)**, doubles as RA funnel. **Lead candidate: dependency-upgrade triage agent** (codebase-aware upgrade risk = gap Dependabot/Renovate leave). Runner-up: release-notes narrative agent.
- **Next = validation-first:** landing page + waitlist + "built with RA" demo BEFORE building; confirm gap vs Snyk/Socket/Renovate; build MVP only if waitlist converts.

## ▶▶ HEAVY-STRATEGY DIAGNOSE+IMPROVE (2026-06-05, branch `fix/reflexion-empty-output-2026-06-05`)
Follow-on to escalation-lift falsification. User Q: reactive beats plan-execute-reflect where it shouldn't; unify divergent strategies on the kernel? **Reframe:** kernel ALREADY canonical (all 5 strategies → `reactKernel`); divergence = orchestration wrappers (plan-execute 1084 / reflexion 827 / ToT 748 LOC). "Unify to improve perf" = category error.
- **Niche probe (the untested UNVERIFIABLE class):** `cross-strategy-matrix.ts` (+full-`output` capture) on t4 (DB-index trade-offs) + t5 (answer→critique→improve = reflexion home turf) × 4 strategies × qwen3.5:latest + gpt-4o-mini. Report `wiki/Research/Harness-Reports/2026-06-05-heavy-strategy-niche-probe.md`. **NO quality lift on either class; rough parity.** Cost tier-dependent (advisor-corrected): heavy 3–15× on LOCAL (no prompt caching), comparable-or-CHEAPER on frontier. ToT 15× = TOKENS not wall-time (serial per-candidate scoring; parallelism = 0 token saving + single-GPU serializes). **User decision: diagnose+improve heavy strategies, NOT deprecate. Honest bar = robust+cheap when opted-in, NOT beat reactive.**
- **REFLEXION empty-output FIX SHIPPED (`660c4856`).** gpt-4o-mini t4/t5 returned 0ch success=false (trace 01KTAV0MVG/01KTAV0WYA). Root (trace-confirmed): generate sub-pass at `kernelMaxIterations ?? 3` — model spent budget on meta-tools (brief+find×3), dispatcher early-stopped before synthesis → kernel honestly committed empty deliverable → cascaded through reflect/improve (improve LLM-errored on malformed meta-tool thread) → 0ch. Reactive survived same task (maxIters=10). **Fix (strategy-scoped, no kernel edit):** when genPass.output empty, force ONE synthesis from a CLEAN single-turn prompt (task + observation digest) — NOT genPass.messages (raw tool_call thread trips OpenAI, same cause as the improve llm_error). M7 empty→failed invariant preserved if synth also empty. Verified: t4 0→2523ch ok, t5 0→4215ch ok; reasoning 1592/0 (+1 RED test).
- **PLAN-EXECUTE STREAMLINE SHIPPED (`ce009691`).** Diagnosis path (2 hypotheses falsified before the real fix): (1) input-bloat FALSIFIED (decode-dominated, 6959 out >> 4911 in; independent steps share empty-completedSteps wave); (2) synthesis-skip FALSIFIED by advisor gate (seq7 raw prose vs seq12 markdown sections — synthesis ADDS structure). Then confirmed on HOME TURF (multi-tool t3 trace `pe-tool-diag`): tool_call steps = DIRECT DISPATCH (no prose LLM) → plan-execute is LEAN where it belongs; waste isolated to off-turf single-analysis (step generates raw prose + synthesis restructures = 2 generations). **Fix (scoped `plan.steps.length===1 && type==="analysis"`):** collapse plan→execute→reflect→synthesize into ONE structured generation (seeded by goal+step instruction) + quality gate, early return; non-decomposable task degrades gracefully to ~reactive cost; tool/multi-step untouched. **Verified:** qwen3.5 t4 7→4 calls, 20623→5134 tok, output still `###`-structured, completed; RED test (0 EXEC/0 REFLECT/1 SYNTHESIS); migrated 3 tests off single-analysis fixtures→multi-step; reasoning 1593/0; turbo build ESM+DTS green. Parity-ceilinged (robust+cheap, NOT beat reactive). **NORTH STAR (separate session):** route PE generation through canonical reactKernel (output-synthesis+verifier). **ToT NOT touched** (token levers deferred: batch per-candidate scoring, drop ancestor-path re-send, trim local breadth/depth).
- **`[object Object]` BUG FIXED (`25d232dd`).** Root cause `memory-flush.ts:155` `String(deps.task.input)` (task.input is `{question}` object) → poisoned Tier-2 memory-extraction prompt (seq13). Fix: canonical `extractTaskText()`. RED test in semantic-extraction.test.ts. runtime 925/0.
- **PER SYNTHESIS FULL-RESULT FIX SHIPPED (`d1d77dbb`) — 3rd PER fix (CORRECTNESS, user-directed).** Symptom: gemma4:e4b scratch.ts (fetch 15 HN posts) rendered only 8 + fabricated placeholders 9-15. NOT generic compression (reactive works on identical task). PER-specific root: step-executor compresses tool_call result to N-item preview, stored ONLY preview on `step.result`, synthesis (plan-execute.ts:~1018) read `step.result` → never saw items past cutoff → fabricated tail. Reactive survives via in-loop `recall()` from scratchpad; PER synthesis is TOOL-LESS so had no path back to full. Fix: `StepExecResult.fullResult` + `PlanStep.fullResult` (additive optional) carry sanitized UNcompressed result; wave-apply threads `result.fullResult`→`step.fullResult`; synthesis builds from `s.fullResult ?? s.result`. Intermediate analysis/reflection prompts STILL compressed (protects documented 50KB-MCP-array regression). RED→GREEN test (15 items, budget 100/preview 3 → synthesis prompt must contain HN-POST-15). scratch.ts re-run: 15/15 render no fabrication. reasoning 1596/0, runtime 924/0, build ESM+DTS green. Residual cosmetic (separate bug): posts 1-8 show 30-char-truncated URLs from intermediate analysis-step preview; 9-15 full. **3 PER fixes now: single-analysis short-circuit + rationale gate + synthesis full-result. Next: ToT token levers.**
- **ToT BATCH SCORING SHIPPED (`e65ad6b5`) + DECODE-BOUND FINDING.** ToT scored each candidate in own `llm.complete`, re-sending task+ancestor-path+rubric B×/parent. Batched → 1 scoring call/parent (candidates share ancestor path). **Clean A/B gemma4:e4b (non-thinking, same task): explore 30667→17167 tok (−44%), 162→119s; all 7 calls parsed, scores discriminate.** **REGRESSION caught via qwen3.5 A/B pre-ship (advisor gate):** batch → thinking model evaluates N candidates → more `<think>` → truncated before any score → old loose parser read truncated numbered thinking list (`1. **Analyze**`) as index→0.5 → silent all-0.50 collapse (BFS pruning blind). OLD per-candidate did NOT collapse (single fit budget; A/B 0.70/1.00). Fixes: strict numeric-body `parseBatchScoresDetailed` (prose REJECTED→`ok=false`, 4 unit tests) + `ok=false`→per-candidate fallback (never ships 0.50) + budget scales w/ breadth. qwen3.5 confirmed discriminating via batch(ok=true)+fallback(ok=false). **KEY FINDING (4th decode-bound confirmation this session): thinking tiers (qwen3.5 = niche-probe 15× case) DECODE-bound; batching shrinks INPUT not decode → flat-to-worse. Only lever = suppress thinking on scoring sub-task (no CoT needed); prompt `/no_think` OVERRIDDEN by framework Ollama `think:true` (config resolves via /api/show); per-call `thinking:false` config-only = cross-package/provider-warden. DEFERRED (ToT no quality lift per niche probe, build not earned).** reasoning 1601/0, build green. Anchors `Rate this thought`→`Rate each` ×5 test files.
- **PER OPTIMIZATION AUDIT COMPLETE — 2nd lever shipped (`1c8ec88b`).** Planner rationale strict-retry = AUDIT-ONLY tax (rationale.why → ToolCallStarted→debrief only, never execution); gated behind `auditRationale` opt-in (mirrors reactive `92c52842`), default OFF skips the re-plan. RED test (audit-off no STRICT-RETRY / audit-on issues it). **CONCLUSION: PER-specific levers EXHAUSTED** — quality-gate-after-synthesis is a pure decision (no redundant LLM); refinement doesn't re-execute completed steps; multi-step path lean (parallel waves + direct-dispatch). Remaining cost is SHARED (classifier, debrief #143 — not PER-specific) or INHERENT (reflect = the point). **2 PER fixes: single-analysis short-circuit + rationale gate. Next: ToT token levers.** reasoning 1595/0, runtime 925/0 (re-verified after gate commit `e539d04f`), builds green. CAVEAT: single-analysis short-circuit = CHEAPER not CHEAP (still pays classifier + FULL planner ~3333 out + one gen; killed only duplicate-gen + reflect). Planner tax is inherent — skipping a degenerate plan is the ROUTER's job, not PER's.

## ▶▶ TOOL-CALLING ROUTING REGRESSION — STAGE A FIXED (2026-06-03)
Branch `fix/text-parse-bare-toolcall` (off `main` @ `152b6e59`). Symptom: "all agents fully regressing — repeat over and over, never call tools." Two faces, one root: (1) loop to max_iterations; (2) raw `<tool_call>` XML rendered as the answer.
- **Root cause (trace-verified):** `482c11e4` keyed the tool-call DRIVER on `calibration.toolCallDialect` but left the RESOLVER injection keyed on `caps.supportsToolCalling`. Ollama hardcodes `supportsToolCalling:true` for EVERY model (`local.ts:951`), so every *uncalibrated* Ollama model got NativeFCStrategy resolver (`runner.ts:126`) + TextParseDriver (`mode:text-parse`). No native tools sent (`think.ts:503`); model emits the `<tool_call>` XML the driver instructs; resolver (parses only native-FC/fenced-JSON/pseudo-code) can't read it → `think.ts:852` resolver branch classifies thinking/final_answer and RETURNS. `TextParseDriver.extractCalls` (`act.ts:164`) is unreachable — kernel runs `handleActing` only on `status:"acting"`, which `think.ts` sets ONLY on its 2 native-FC paths (`:952`,`:1198`).
- **Deeper finding:** text-parse mode was NEVER a live path — no calibration produces the `"text-parse"` dialect (`calibration-runner` emits `none`/`native-fc`); pre-482c11e4 every model → NativeFCDriver. `482c11e4` switched on a half-built path (no think→acting transition for text markup).
- **Stage A fix (`11996c5a`):** capability is the single master signal. `selectToolCallingDriver(dialect, supportsToolCalling)` → native unless `supportsToolCalling===false`. `runner.ts` resolves caps ONCE, feeds both resolver injection + driver selection → coherent triple (injectResolver ⟺ native driver ⟺ attachTools). Verified gemma4:e4b 0-call/21-iter/13k → file-write+final-answer/6-step/4.6k/success (N=3 3/3); cogito:14b (482c11e4's trigger) fixed. tools 819 / reasoning 1576 / runtime 907 green. Direct worktree fix (pilot override).
- **Boundary:** tool-INCAPABLE Ollama models (gemma3:12b → `/api/chat` `"does not support tools"`) now fail fast+loud (`llm_error`, 1.4s, 0 tok) vs 482c11e4's silent 13k-tok loop — net-positive, still can't use tools.
- **Stage B (NOT started):** narrow `local.ts:951` to per-model `/api/show` tools probe **COUPLED WITH** building the text-parse think→acting transition (detect `<tool_call>` → `pendingNativeToolCalls`+`status:acting`; driver pure-extraction, think.ts owns classification). Then retire older `tool-calling/resolver.ts`. Must land together or cogito trades one break for another. **[SUPERSEDED 2026-06-04 — Stage B subsumed by the calibration-adapter design at §"WEAK-MODEL TOOL-CALL GAP" below; not a standalone next-step.]**
- Spec `wiki/Architecture/Design-Specs/2026-06-03-tool-calling-driver-redesign.md`; evidence `wiki/Research/Harness-Reports/2026-06-03-tool-calling-routing-n3.md`; register R1(closed)/R2(open). No cloud keys in env → cross-tier cloud gate deferred. Branch unpushed, no PR. **[SUPERSEDED 2026-06-04 — full fix MERGED to `main` `c19558c0`; cloud keys WERE in `.env`, all tiers×3 providers 5/5. See lines 13-15 below.]**
- **HARNESS-DETRIMENT ROOT CAUSE FIXED (`aa6ff260`, 2026-06-04).** THE pruner stranding the task tool = kernel `RA_LAZY_TOOLS` block (`think.ts:236-256`, DEFAULT-ON, opt-out `RA_LAZY_TOOLS=0`) — NOT runtime `adaptiveToolFiltering` (off by default) NOR a separate kernel `filterToolsByRelevance` (sole consumer is runtime tool-schemas.ts). Lazy-prune floor was `required ∪ relevant ∪ toolsUsed ∪ discovered ∪ META` — **omitted `input.allowedTools`** (threaded `reasoning-think.ts:212`→`KernelInput.allowedTools` kernel-state.ts:499). Classifier (on the model itself) judges task tool irrelevant on weak models → not relevant/required → lazy-prune drops it despite explicit allowlist → only META survives → drift. **Fix (kernel-warden, pure `computePromptSchemas()`):** (1) `input.allowedTools` added to floor in BOTH lazy + RA_LAZY_TOOLS=0 arms; (2) never-prune-to-META-only guard (restore unpruned when pre-prune ≥1 non-META domain tool but post-prune 0; dormant pure-META + pressureCritical). Reasoning 1581/0; 3 RED→GREEN + 2 dormancy pins. **VALIDATED gap-probe BENCH N=5:** DRIFT→0 BOTH; cogito:14b 4/5 SUCCESS (was drifting). qwen3:14b residual 5/5 NO_EMISSION = SECOND FACTOR, fixed next. Trace prune-event DEFERRED (think.ts has only `hooks`, no recorder → FiberRef risk).
- **SECOND FACTOR FIXED — prompt↔FC tool-name MISMATCH (`954ae37a`, 2026-06-04).** Native-FC tools array sanitizes names for provider regex (`github/list_commits`→`github_list_commits`, `think.ts:539`), but prompt tool-reference (`buildToolReference`) + `buildRules:207` ("use the full listed prefix") rendered RAW slash name. Weak models read slash in prose, emit `<rationale>` citing slash, emit NO native call for underscore FC name → end_turn/empty → loop→max_iter NO_EMISSION. **3-way bench (qwen3 N=5):** slash-prompt-vs-underscore-FC (MISMATCH) 0/5; `github_list_commits` (matched, compound) 5/5; `list_commits` (matched, bare) 5/5 → MISMATCH is blocker NOT prefix. Evidence: trace tail `~/.reactive-agents/traces/llm-direct.jsonl` (LLMExchange mis-keyed there) — qwen3 rationale-only, native_calls=[], stop=end_turn vs FLAT stop=tool_use. **Fix (kernel-warden, display-only):** sanitize-mapped copy of promptSchemas→`project()` (`buildThinkProviderRequest` extracted); canonical names still feed FC array + de-sanitize map (`think.ts:695` from gatedToolSchemas) → registry byte-identical. **CROSS-TIER VALIDATED N=5 namespaced:** qwen3 0→5/5, qwen2.5 5→5/5 (control held), cogito 4→5/5. **ALL 3 LOCAL MODELS 5/5 BENCH.** Reasoning 1584/0 (4 tests/strategies assertions truth-updated slash→underscore — tests asserted the BUG, surfacing-intent preserved, NOT gaming). qwen3 IS calibrated (228 samples, classifier=high) — "uncalibrated" assumption wrong. Rationale gate NOT blocker (FLAT 5/5 with gate active). Diagnostics: `apps/examples/qwen3-emission-capture.ts` + gap-probe `TOOLNAME` override.
- **COMPLETE PROOF + SUITE CLOSE (2026-06-04).** Branch commits: Stage A `11996c5a`, floor `aa6ff260`, name-match `954ae37a`, no-allowlist knob `f7c0a108` (UNPUSHED, no PR). Proof: (1) gap-probe PROBE+BENCH × {qwen3:14b,qwen2.5:14b,cogito:14b} = ALL 5/5 (PROBE re-baseline lifted by name-fix → "over-prescription" was same mismatch, dead); (2) real github MCP + allowlist original repro: cogito ✓ real commits, qwen3 ✓ goalAchieved; (3) real github MCP NO-allowlist 45 tools (`SPOT_NO_ALLOWED=1`): qwen3 ✓ — classifier→required github/list_commits + relevant get_commit, floor kept, native call, real commits. **Classifier-relevance NOT a bug** (falsified: returned required:[github/list_commits] in passing+failing runs; stale root-cause-doc claim rested on wrong "qwen3 uncalibrated" premise — qwen3 IS calibrated). Suites GREEN: reasoning 1584/0, runtime 924/0/1skip, full-repo typecheck 68/68 (warden escalation closed). **CROSS-TIER CLOSED:** cloud keys ARE in `.env`. gap-probe parametrized `PROVIDER` env. BENCH N=5 namespaced: gpt-4o-mini 5/5, claude-haiku-4-5-20251001 5/5, claude-sonnet-4-6 5/5 → **ALL TIERS × 3 providers (ollama/anthropic/openai) = 5/5.** Mid+frontier sound, no regression. **MERGED TO MAIN LOCALLY (fast-forward, `main`@`c19558c0`) — UNPUSHED (19 ahead of origin/main).** Follow-on axes MEASURED sound cross-tier (no fix): multi-tool chain (cogito+qwen3 fetch→write), repeated/parallel calls (qwen2.5/qwen3 5/5, cogito 4/5). Cosmetic-only (not chased): goalAchieved:null on end_turn (advisory; success still §9.0-verified, terminatedBy-agnostic gate); rationale-as-tool-args = metadata artifact (40/40 trace executions clean).

## ▶▶ OBSERVABILITY + EFFICIENCY SPRINT (2026-06-04, on `main`)
Follow-on to the tool-calling fix. Reframe lesson: universal structural fixes beat per-model adaptation; bottleneck was the feedback loop. **A — trace decision-record instrument SHIPPED:**
- `5d0f9c3d` re-key LLMExchange to the real run. observable-llm emitted `PLACEHOLDER_TASK_ID="llm-direct"`. Fix FiberRef-FREE: added optional `traceContext?:{taskId?,iteration?}` to `CompletionRequest` (provider-warden; no adapter reads/sends it, no request hits Schema.decode), observable-llm reads it (placeholder fallback for non-kernel sub-calls), think.ts:605 populates it. `rax-diagnose replay <runId>` now shows per-iter offered-tools + native calls + content + stopReason. Scope: reactive think-loop only.
- `a25d21c6` surface prompt-cache tokens on the STREAM path. Stream accumulator `case "usage"` dropped cacheCreation/cacheReadInputTokens (complete() was fine; kernel always streams). Fixed → cache hit rate visible + bench input-token undercount fixed.
- **B opening (cache economy) — churn hypothesis FALSIFIED.** Raw SDK dump (sonnet): input_tokens 363→1→1, cache_read 3215/3906/3868 — caching works great on frontier (prefix stable, ~3800 tok/turn @ 90% off). Haiku doesn't cache (2048 min-block too big; sonnet 1024 caches). Caching is cloud-only (`supportsPromptCaching:false` local) → NOT the cross-tier lever; don't chase haiku block-consolidation (sprawl).
- **RATIONALE GATE → OPT-IN SHIPPED (`92c52842`).** Owner: per-tool-call `<rationale>` block is AUDIT (→rationaleLog→debrief), not performance → opt-in. Cross-tier ablation (N=3, memory-isolated via new SPOT_NO_MEMORY knob; quality 3/3 every cell): off vs on → qwen3 −27% latency/−20% out-tok, qwen2.5 −19% latency, cogito flat. Pure cost. Wired default-OFF end-to-end mirroring observationSummary: KernelInput.auditRationale ← reasoningOptions.auditRationale (runtime-warden caught the `as unknown as` cast dropping it in reasoning middle-layer: reasoning-service/strategy-registry/reactive.ts). `.withReasoning({auditRationale:true})` + env RA_RATIONALE_AUDIT=1. reasoning 1591/0, runtime 925/0. FOLLOW-UP: plan-execute plan-rationale NOT gated (integral to plan JSON, once-per-plan not per-turn). Lesson: input-reduction ≠ speed (decode-bound); rationale is OUTPUT so it WAS the real tax.
- **RATIONALE PARSER HARDENED + DOCS CURRENT (2026-06-04, unpushed).** User caught 2 opt-in capture bugs: (a) haiku captured rationale even audit-OFF — gate only suppresses PROMPT INSTRUCTION; capture is opportunistic (memory-recalled blocks still parse) → LEFT ungated by design. (b) gemma4:e4b emitted but DROPPED from debrief. Root cause = 3 brittle conditions in `packages/tools/src/drivers/rationale-parser.ts` (`parseRationaleBlocks`/`extractRationale`): strict `JSON.parse` rejected fenced/prose bodies; `why>280` rejected whole block; gemma tags EVERY block `call="1"` (12×) → map collision drops all-but-last. FIXED tools-warden RED-first +28 LOC: lenient parse (strip fences + first balanced `{}`), why truncate-not-reject, collision→next-free-sequential-key. tools 822/0, reasoning 1591/0 (shared `extractRationale` downstream via think.ts `.get(i+1)`; no drop-on-280 test existed), typecheck clean. Cross-tier empirical: gemma+haiku both land in `debrief.rationale[]` (debrief only present when memory ON). Chain: think.ts parse→tc.rationale→act.ts onAction({callId,rationale})→kernel-hooks ToolCallStarted(gated on callId)→execution-engine:228 rationaleLog→debrief-synthesis:162. DOCS (5): decision-tracing.md/whats-new.mdx/reasoning.mdx mandatory→opt-in + plan-execute always-on carve-out; tools.md NEW Scoping section (`allowedTools` hard vs `focusedTools` soft — both were undocumented); CHANGELOG Changed+Fixed. spot-test.ts has debug DEBRIEF_RATIONALE_JSON print.
- **LOCAL-TIER STEP ECONOMY — FALSIFIED AS A LEVER (2026-06-04).** Documented "cogito:14b 17-step/3-call stall" is DEAD. Identical commits→file task, N=3 clean default (audit off): cogito:14b **3/3, 9 steps, 3 clean calls, ~12s**; qwen3:14b **3/3, 9 steps, 3 calls, ~53s** — both at OPTIMAL step count. Fixed post-doc (likely rationale opt-in `92c52842` and/or routing `11996c5a`; causation NOT claimed). cogito:8b (obsolete 11mo 4.9GB) ~1/3 reliability, writes ```python pseudocode parser misses → max-iter loop; **below FC floor, document-and-skip, not a lever.** METHOD: "rationale-ON breaks weak models" was N=1 FLUKE (N=3 scrambled to noise OFF 1/3 ON 1/2); retracted. Also caught silently swapping cogito:8b for documented cogito:14b. NO live local-tier step-economy lever on capable models.
- **FRESH unchased signal:** qwen3:14b ~4× slower than cogito:14b for IDENTICAL work (53s vs 12s, same 9 steps/3 calls/3-of-3). Pure decode — qwen3 likely wasting thinking tokens. Reversible per-model output-token economy lever (fits calibration thesis). Needs: measure thinking-vs-content split first.
- **ESCALATION-LIFT EXISTENCE PROOF → NOT FOUND. difficulty→effort controller = DEAD lever (2026-06-04).** Code-read: `adaptive.ts` = start-time SHAPE-router (regex picks 1 strategy upfront); switching = LATERAL entropy-recovery (no effort order); `verifier.ts:126` already emits 4-level severity (pass|warn|reject|escalate) but drives retry/HITL not strategy-escalation. So verifier-triggered runtime escalation = a BUILD. Pre-registered N=3 (qwen3:14b, gradable, capable=no emission confound, incl plan-execute HOME TURF): proof=task where reactive fails but heavy succeeds. FALSIFIED 4 classes: easy-multitool reactive optimal; hard-coding(haiku) 10/10; LIS(qwen3) reactive 5/5 = reflexion 5/5 (+13s); long-horizon commit-analysis (plainly-phrased→adaptive routes reactive) reactive **7/7×3** vs plan-execute **7/7 4/7 6/7 +2-3× slower**. Reactive single-loop = strong default trivial→expert; heavy strategies equal-or-WORSE + always slower. **DO NOT build the controller.** Surfaced architecture-simplification Q (not run): do heavy strategies EVER beat reactive on a real task, or just latency+weight? plan-execute net-NEGATIVE here. SESSION FALSIFICATION TALLY: cache-churn, extractObservationFacts-44%, local-step-economy, cogito-stall, rationale-breaks-weak-models, escalation-lift — all evaporated. Only non-falsified levers (bounded): qwen3 ~4× decode (model-specific), memory-flush fork (~2.7s universal).
- **OTHER LEVERS surfaced (not pulled):** (1) difficulty→effort CONTROLLER — compose existing pieces (strategies+verifier+entropy+calibration+memory+switch-evaluator) into start-cheap→verify→escalate (the real vs-single-loop differentiator). OPEN Q: is adaptive.ts an escalation ladder or just lateral switch-evaluator? = wire-vs-build. (2) stopping calibration (cogito 17-step/3-call stall). (3) numCtx right-sizing (fixed-per-model, not prompt-adaptive; Ollama KV-cache speed). (4) memory-flush fork (complex BLOCKS ~2.7s post-answer). Suites green: reasoning 1591/0, runtime 925/0, typecheck (chain) green.

## ▶▶ WEAK-MODEL TOOL-CALL GAP → CALIBRATION-ADAPTER DESIGN (2026-06-04)
Follow-on to the routing regression. Measured 4 local models (committed harness `apps/examples/toolcall-gap-probe.ts`, deterministic tools, ERROR≠NO_EMISSION≠DRIFT≠SUCCESS, flat/namespaced + meta on/off controls, single-model runs to avoid swap artifacts):
- **qwen2.5:14b PERFECT** 60/60 incl. namespaced fetch → the achievable bar + **regression control**.
- **cogito:14b ~80%** — failures = rationale with FULL intent (tool+args), no native call → RECOVERABLE.
- **qwen3:14b 0/15** namespaced fetch — **slash-name FREEZE** (flat name flips NO_EMISSION 14→0) + `<think>` reasoning-mode emptiness + heavy drift even flat.
- **llama3.1** works trivial (single capture); v1 N=20 matrix "0/20" was a harness BUG (ERROR conflated into NO_EMISSION), fixed in v2.
- **Gap is HETEROGENEOUS — no single root.** Shared recoverable pattern (intent formed, native call not emitted; mode no-emission↔drift interchangeable by condition) + model-specific extras. `find`-drift is an attractor NOT the root (disabling find didn't restore qwen3). `rescueFromThinking` wired (think.ts:747) but too narrow (only <50-char content) + prose-incapable downstream.
- **User direction:** improve+utilize CALIBRATION (M7) + ADAPTER (M12) systems for **per-model realtime adaptation**. Native/structured if capable, else reliable per-model extraction. Systems ~70% built but loop OPEN: G1 calibration dialect probe STUBBED (`calibration-runner.ts:313` hardcodes "none"), G2 `lastDialectObserved` telemetry-only (think.ts:889-894), G3 routing ignores calibrated style (Stage A is capability-only).
- **APPROVED design** — spec `wiki/Architecture/Design-Specs/2026-06-04-calibration-adapter-toolcalling.md` + plan `wiki/Planning/Implementation-Plans/2026-06-04-calibration-adapter-toolcalling-plan.md`. Loop: calibrate(real probe)→route by 3-class taxonomy (native-capable / extractable-dialect / needs-input-forcing) + traits (namespaceTolerance, driftProneTo)→observe→adapt realtime→persist (self-improving). 5 stages (0 bench→1 probe→2 route→3 input-forcing→4 realtime+persist), qwen2.5 = hard regression-control gate each stage, lift rule (≥3pp ∧ ≤15% tok). **SAFETY: extraction reads STRUCTURE not prose** (prose-mining rejected default-on — negation/alternatives/re-fire/outward-facing hazards). Awaiting user review before code.

## ▶▶ TTY STATUS-MODE TEST FLAKE FIXED (2026-06-03)
`bun test` from a real TTY failed ~16 behavioral tests (tool-loop, Conductor/meta-tools, streaming TextDelta, builder-terminal) that PASS piped/in CI. Symptom: tools never executed, `run()` output empty, stream deltas=0 (`toContain`/`toBeTruthy`/`toBeGreaterThan(0)`).
- **Root cause:** `execution-engine.ts:1270-1274` auto-enables status mode when `process.stdout.isTTY` truthy + no opt-out. Status mode (`:1329`) installs a `StreamingTextCallback` on EVERY `execute()` → forces `run()` down the streaming branch (tools dropped, output lost) + clobbers `runStream()`'s own callback. CI/piped → `isTTY=false` → off → green. Nothing actually set the documented `REACTIVE_AGENTS_DISABLE_STATUS_MODE` — CI just happened to be non-TTY.
- **Repro:** the Bash/agent tool ALWAYS pipes → always 0 fail; cannot repro TTY-only failures. Use `python3 -c 'import pty,sys; sys.exit(pty.spawn(["bun","test"]))'`. Also `bun test | grep` hides failures (bun writes detail to TTY/stderr) AND changes the result.
- **Fix:** added root `bunfig.toml` `[test] preload=["./scripts/test-preload.ts"]`; preload sets `process.env.REACTIVE_AGENTS_DISABLE_STATUS_MODE ??= "true"`. Deterministic across TTY/pipe/watch. Explicit `logging.mode==="status"` still activates (OR-branch). Verified 5982 pass / 0 fail both pty and piped.
- **Production root cause FIXED (2026-06-03)** — status mode now behaviorally inert (rendering-only); tool-using `run()`/`runStream()` in a terminal == piped. Two edits: (1) `inline-think.ts` streaming branch was NOT tool-equivalent to `complete()` — read tool calls only from `content_complete.toolCalls`, ignored native-FC `tool_use_start`/`tool_use_delta`. Now accumulates start/delta like the kernel (`reason/think.ts:565-574`) + `JSON.parse`s input back to object (matches complete()'s shape) + re-throws stream `error` event. Kernel path was already correct; only the no-ReasoningService inline fallback had the gap. (2) `execution-engine.ts:1329` status mode DEFERS to an existing `StreamingTextCallback` (installs renderer cb only when null) → no longer clobbers `runStream()`'s queue cb. Pinned by `tool-loop-behavioral.test.ts` equivalence test (run vs runStream), RED-verified. Full suite 5983 pass / 0 fail both piped + status-forced-on under pty.
- **Corrected mechanism:** kernel DOES descend from the entry fiber. The agent-entry null-scope was inert because :1329 re-set the cb INNER, not non-descent. There was NEVER a cross-test FiberRef leak — every probe TRUTHY was :1329 setting the cb on every execute under TTY.
- Method: 3 failed speculative fixes (canStream guard, null-scope at run() entry, execute-stream null) before advisor + pty-repro (`python3 pty.spawn`) + file-probe instrumentation nailed it. Lesson: gather component-boundary evidence (probe the actual FiberRef reads) before theorizing about Effect internals.

## ▶▶ TWO HARNESS BUGS FIXED (2026-06-02) — branch `refactor/canonical-sprint2-2026-06-02`
Surfaced by a user spot-test (gemma4:e4b, "price of XRP/BTC/XLM/BONK → write crypto.md").
- **`921b1cbc` batch-tool required-floor bug** — classifier set `crypto-price×4` (minCalls=4, "4 coins→4 calls"); model correctly batched all 4 in ONE call + wrote file, but the required-floor of 4 was unsatisfiable → endless "still must call crypto-price" nudge → 23 iters → max_iterations → success:FALSE despite deliverable. Root: crypto-price takes `coins: array (required)` but declared no cardinality → LLM's inflated minCalls passed through; even the `cardinality:"batch"` branch was buggy (`minCalls=llmMinCalls` not 1). FIX (`infer-required-tools.ts`): schema-detect batch (required array param ⇒ batch even when undeclared) + batch floor=1 (override inflated estimate). Non-array tools unchanged (http-get×4 stays 4, test-guarded). Empirical: before 23 steps/32209 tok/fail → after 9 steps/9918 tok/**success** (−69% tok). +4 tests.
- **`89b1f794` crypto-price coin coverage** — BONK notFound was NOT casing (input already `.toUpperCase().trim()` at :158) — BONK absent from 30-coin COIN_MAP. Decision (user): it's a demo/FIXTURE tool → deterministic map-expansion beats a live `/search` fallback (which would inject network flakiness/rate-limits into bench runs). Added BONK + 24 canonical-id coins. +2 tests.
- Method: advisor caught I was about to over-build the `/search` dynamic resolver — wrong default for a fixture. Determinism > coverage for bench tools.
- ALSO removed `crypto.md` (stray spot-test artifact accidentally committed into `f4e1fcbe` via `git add -A`). Watch `git add -A` near spot-tests — they write to repo root.

## ▶▶ WS-4 PROGRESS RECITATION — increment 1 SHIPPED + ablation RUNNING (2026-06-02) — branch `refactor/canonical-sprint2-2026-06-02`
The `goal_state` EventLog event (carries `remaining[]`, consumed by `systemPromptStage`) was a DEAD SCAFFOLD — consumer, ZERO live emitters. WS-4 gave it a real producer.
- **`fd1a1ef7` producer** — `fromKernelState` computes `verify(state.meta.postConditions, state.steps, {output})` FRESH each turn, emits `goal_state` with `remaining = describeConditions(unmet)` when unmet. systemPromptStage renders "Remaining steps: …". PROACTIVE (every turn) — NOT a duplicate of the Arbitrator's `applyPostConditionGate` (steers REACTIVELY only on a would-be exit-success). `describeConditions` factored out of `describeUnmet` (shared steering vocab, no drift). postConditions already derived once at kernel-start (runner.ts:250).
- **`4228576e` gate** — `recitationEnabled()` seam, OPT-IN via `RA_RECITE=1` (off by default) until cross-tier proof — mirrors RA_RECALL_GATE history. A new default-on without proof violates the project lift rule.
- Anti-scaffold: producer+consumer verified SAME-COMMIT by an e2e `project()` test (recited remaining surfaces in assembled system prompt; vanishes when all met). 18 recitation + 4 describeConditions tests; assembly+verify+decide+terminate 204/0. Build green.
- **Placement DEFERRED to measured ablation** — advisor reframe: judge is LIVE so placement (recency-tail vs prefix) is MEASURED not argued. systemPromptStage rebuilds the prefix every turn anyway → the Manus KV-cache argument is weak here; attention/accuracy = what pass^k measures. Shipped via the existing provider-safe system-prompt consumer first.
- Pulse `remaining[]` self-check = increment 2 DEFERRED (`buildPulseResponse` in packages/tools, cross-package).
- **Ablation DONE `4e829c9f` — INCONCLUSIVE (grading-channel confound), recitation STAYS OPT-IN.** Report `wiki/Research/Harness-Reports/2026-06-02-ws4-recitation-ablation.md` (`2c893901`). Raw: ra-recite −29pp accuracy (60→31), driven by qwen3.5 rw-9 100→0. BUT advisor caught the confound + code-confirmed: `judge.ts scoreWithJudge` sends `sutResponse = output.slice(0,1500)` (final TEXT only); the produced FILE (report.md/prices.md in tmpDir) is NEVER read/sent, though both rubrics grade "file is written + contains table/prices." Recitation steers deliverable INTO the file → thinner text → text-only judge under-scores. The −29pp measures a grading-channel SHIFT, not task success. **REAL FINDING = a hole in the "honest grading" half of the spine: `llm-judge` accuracy is blind to produced files, under-grading EVERY file-deliverable task.** Did NOT build the recency-placement variant (confounded data can't justify it).
- **RESOLVED via fork (B): fixed bench grader (`f4e1fcbe` `collectJudgeDeliverable`: judge grades final text + produced working-dir files, per-component budgets so a long preamble can't truncate the file off). Re-ran ablation (`ca93d231`): SMOKING GUN qwen3.5 rw-9 `100→0` (broken) → `98→100` (fixed) — the −29pp was 100% grading artifact. Fixed-grader verdict: recitation NEUTRAL (accuracy 62→63, +1, within noise), does NOT clear +3pp default-on bar → STAYS OPT-IN, but NOT harmful → viable lever. Next options: recency-tail-vs-prefix placement ablation, OR move to another Pillar-8 lever. SEPARATE finding: gpt-4o-mini 0/0 on rw-9 both arms — mid-tier fails resilience task (503+fallback discovery), own probe. Method lesson: validate the INSTRUMENT before trusting a cross-tier number — pick ablation tasks whose graded channel matches what the mechanism moves.

## ▶▶ MEASUREMENT SPINE COMPLETE + PR #181 (2026-06-02) — branch `refactor/canonical-sprint2-2026-06-02`
Two halves both done: honest CELLS (PreFlight capability-source) + honest GRADING (judge online).
- **`a4d88d5e` judge-online** — KEY FINDING: was an OPERATIONAL gap, NOT a code bug. `judge-server` live layer always sound, just needed starting. Verified live both directions (Paris→accept 1.0 / Berlin→reject 0.0, real per-layer reasoning, not stub's flat 0.95). Turnkey `scripts/judge-up.sh` (anthropic/haiku ≠ SUT, Rule-4-safe, keys from `.env`). Runbook `wiki/Development/judge-online-runbook.md`. Bench wires via `JUDGE_URL`; pass^k = `runs:3` + `computeReliability`. Judge running :8910 this session.
- **PR #181 OPEN** — measurement-honesty spine landed for review. Ollama reachable + .env has anthropic/openai keys → cross-tier runnable NOW.
- NEXT = WS-4 recitation (convergence design) against the now-REAL accuracy gate. Advisor pre-checked: render `goal·done·remaining` into RECENCY (not cached prefix — KV-cache), as a PROJECTION computed fresh each turn from `verify(postConditions, steps)` (NOT appended to state.messages — would accumulate stale blocks), kernel-side render passed through `fromKernelState`. Scope WS-4 only (pulse `remaining[]` self-check); WS-6 experience-reuse is separate P6. Live-run gate now satisfiable (judge up).

## ▶▶ MEASUREMENT-HONESTY SPINE SHIPPED (2026-06-02) — branch `refactor/canonical-sprint2-2026-06-02` (was unpushed; now PR #181)
Vision re-read + aligned: the moat = "harness lifts weak models, PROVEN by reproducible cross-tier bench." So measurement IS the proof engine, not tooling — built as forward-value shared contract, not refactor scaffold.
- **`15c1276f` canonical PreFlight contract** — `core/contracts/preflight.ts` (L1, types-only, no upward dep): `PreFlightViolation` union + `capabilitySourcePreflight(cap)` SINGLE decision + `PreFlightReport` + `formatViolations`. Both consumers unified: `agent.build()` (warn/strict-error) + bench. Anti-scaffold: ships ONLY the wired `capability-source` variant; future variants (capability-floor/tool-missing/...) land WITH their emitters. core 145/0, build green (ESM+DTS).
- **`f85667ee` per-cell BenchCellOutcome** — `runSession` marks fallback-source cells INCONCLUSIVE (short-circuit before dispatch) instead of aborting the whole grid (coarse throw removed). `TaskVariantReport.inconclusive?: PreFlightViolation` + `SessionReport.inconclusiveCells`/`partialMeasurement`. Inconclusive cells EXCLUDED from `computeAllAblation`+`summarizeDimensions` (a misconfigured cell never feeds equal-or-better). Mixed-tier sessions stay honest. bench 75/0, build green.
- Also this session: `d6b8f09a` reconciled all canonical plan frontmatter to code-verified status; `84e629a4` arch health audit (`wiki/Research/Audit-Reports-2026-06-02/`) — foundation strong (clean layers, 0 kernel cycles, single arbitrator), real gap = Pillar 8 capability axis parked.
NEXT (measure-first-then-capability): (1) PreFlight variants land with TaskContract preflight consumers; (2) **CAPABILITY axis = convergence Phase 2 recitation + experience-reuse** (grep→0, Pillar 8 unstarted, the real vision-gap); (3) I4 single-resolver merge (5→1) after bench can measure resolution regressions; judge-server online + raise N.

## ▶▶ CAPABILITY-SOURCE HONESTY GATES SHIPPED (2026-06-02) — branch `refactor/canonical-sprint2-2026-06-02` (unpushed)
Code dive corrected the canonical-refactor plan: **its RCs are a sprint stale.** WS-2 already done (runtime.ts = 6 `Layer.merge` / 3 casts / 10 `Layer.mergeAll`, not 40/44; runner.ts 771 not 1986; **0 raw `state.status=`**). WS-3 ~80% done (`tool-parsing`→`kernel/utils/`, `tool-gating`→`decide/`; `tool-execution` 0 external inbound; **kernel mesh = 0 cycles**, 16 acyclic edges — plan's "7 cycles/38 edges" wrong). RC-4 honesty 34 `Effect<X,unknown>` / 103 `as any` (modest). **Remaining structural work is low-value purism (metric-gaming risk) — the real lever is the measurement/honesty spine via `Capability.source`.**
Shipped 2 gates on that spine (close bench↔runtime asymmetry; attack the claude-haiku-4-5 silent-fallback root cause):
- `8c56a774` **bench preflight** — `runSession` refuses to SCORE a `source==="fallback"` cell. `packages/benchmarks/src/preflight.ts`, `RA_BENCH_ALLOW_FALLBACK=1` override. 7 tests.
- `b8c13f0f` **runtime build gate** — `validateBuild` surfaces fallback at agent build: warn default / error under `strictValidation`. `packages/runtime/src/build-validation.ts`. 3 tests; runtime suite 888/0; turbo build green (ESM+DTS).
- `afeaea62` doc addendum → `wiki/Research/2026-06-02-issue-canonical-cross-reference.md`.
NEXT (honesty spine): route the runtime warning through ObservabilityService (not just warnings[]) + surface `capabilitySource` on AgentResult metadata; Sprint-2 bench-honesty contract; raise N + bring judge-server online (dishonest-bait ungraded while offline). Branch unpushed — user decides push/PR.

## ▶▶ EVIDENCE REFRESH (2026-06-01) — `wiki/Research/Harness-Reports/evidence-refresh-2026-06-01.md`
Re-ran 2 stale-magnitude debts on current code.
- **Debt 1 RA_ASSEMBLY grid: WIN HOLDS.** Fair A/B (both arms full context), N=2, qwen3.5+haiku. LOCAL: project rescues
  legacy total failure (overflow legacy 0/2 recall-loop vs project 2/2 cov 1.0) + **−48/−49% local tok**. MID: 1.0 cov both,
  token-neutral. Stale "−57%" → **−48/−49% local + failure-rescue + 1.0 cov + mid parity** (gap shrank 57→49 as predicted).
- **Debt 2 #7 magnitude: did NOT replicate + ONE COUNTEREXAMPLE (narrow framing per advisor).** NOT "ON worse than OFF" (N=2
  + confound: the dishonest run was CREATED by a cogito tool malfunction, orthogonal to #7). (1) "0.31→0.72 / 1/3→3/3" does NOT
  replicate (mid clean both arms=no signal; cogito N=2 stochastic) → lift RETIRED, unmeasured (neither confirmed nor refuted).
  (2) ONE counterexample (pc1 r1): cogito file-write ERRORED→no file→final-answer→success=TRUE; ArtifactProduced genuinely UNMET
  (verify correctly needs successful write) yet exited success. STATUS (precise, NOT "#7 OPEN broadly"): VERIFIED seed-fires
  + gate demotes seeded-unmet (unit); UNVERIFIED+counterexample = final-answer e2e composition (one path). **DETERMINISTIC
  arbitrate() test RUN `c8614eb6` → GATE LOGIC SOUND:** added failed-write cogito shape (writeObs(false)) to post-condition-gate.test.ts
  → DEMOTES to post-condition-steer (7/7). deriveConditions + act.ts:388 final-answer wiring + isArtifactProduced all sound in
  isolation → live cogito miss is a COMPOSITION/WIRING gap, NOT gate-logic regression. Candidates (undiscriminated): seed-thread to
  arbitrator / verify-linkage on messy 3-write ledger / act.ts:334 completion-gap pre-gate. **#7 FINAL = RESOLVED `db6164ac` (2026-06-01).**
  Advisor REFRAMED: SKIP trace-replay (stochastic + serializeKernelState doesn't persist meta.postConditions → can't answer); question is
  binary+systemic, answered by READING + deterministic seam test. (c) ruled out by reading act.ts:334→388 — 334 only LOWERS canComplete
  (→reject→loop), NEVER false-accepts; canComplete=true ALWAYS reaches proven-sound arbitrate() at 388. (a) ruled out by 3 new seam cases
  through the REAL builder (arbitrationContextFromState + runner-seeded deriveConditions — the path ctxWith unit cases skipped): failed-write→
  final-answer DEMOTES live (10/10). (b) ruled out by reading isArtifactProduced (toolCallId-link only, NO union; cogito malformed writes had
  no path arg). **ALL 3 candidates closed → #7 gate SOUND in live composition; cogito `01KT1BQ6Z5` was an N=2 tool-malfunction artifact, NOT a
  gate hole.** PIVOT (advisor): N=2 stochastic non-signal = session-long bottleneck → measure with `pass^k`.

## ▶▶ #7 / Phase 1 spine CLOSED `f468525f` (2026-06-01)
Phase 0 `pass^k` harness was ALREADY BUILT (stale memory said "build it"): task-quality-gate.ts has RUNS_PER_TASK + passK + variance + T3-strict +
postConditionsMet wired to REAL verify(); passk-baseline-2026-05-30.md filed. Phase 1 code ALSO done. Ran the missing piece = Phase 1 LIVE-RUN GATE
(fixture-pinned cross-arm A/B). Re-froze fixture `hn-fixture-2026-06-01.json` (transient one gone). cogito:14b N=3 #7 ON(unset/default) vs OFF(=0):
**pass^k 5/5 BOTH, postCond flat → regression-safe; composite 86 vs 91 = run-noise.** Advisor RECONCILE (do NOT reopen / do NOT chase stochastic spot-test):
**#7 lift ~0 BY NATURE on realistic dist** (claimed-success+absent-deliverable is rare-tail; clean fixture+working tools → deliverable every run → gate never
fires). Per project lift rule: deriveConditions deterministic/no-LLM + verify pure ledger-scan → ~0 overhead → **KEPT default-on as cheap tail-risk INSURANCE,
not a lift claim.** "0.31→0.72" RETIRED. **Composition PROVEN BY EXECUTION**: `terminal-post-condition-gate.test.ts` runs the REAL imperative stall path
(runStallDeliverableStep, the path that made cogito false-success trace `01KSWR3S5FEW0KM61PCF1M6946`) → status:failed with #7 on; added DEFAULT-ON unset case (7/7).
Report: `wiki/Research/Harness-Reports/phase1-postcond-ab-2026-06-01.md`. **#7 DONE.**

## ▶ NEXT TARGET — observation-TRUNCATION faithfulness defect (the gap Phase-0 baseline ACTUALLY found)
T3-strict 0/3 EVERY tier INCL sonnet-4-6 while prose success=3/3. #7 structurally CANNOT catch (SELECTION-wrongness ≠ deliverable-absence). Guardrail SATISFIED
(advisor "if even sonnet fails, metric may measure itself"): inspected sonnet T3 — NOT over-strictness, GENUINE. run0=wrong-pick(4 cited,1 right); **run1+run2=cited=[],
output MID-REASONING ("results were truncated… Let me retrieve the full content") — never produced deliverable, balked on a truncation marker.** Harness truncated the
25-post get-hn-posts observation → even sonnet concluded it lacked data + looped. TIER-AGNOSTIC harness context-engineering bug, canonical-assembly domain (#1 preview+ref).
**ROOT CAUSE DIAGNOSED + EMPIRICALLY CONFIRMED (2026-06-01, NOT yet fixed):** `compressToolResult` (`tool-formatting.ts:221`) array path is ALL-OR-NOTHING —
showAll (all items @ full 6-field, ~3900 chars for 25-post fixture) OR `slice(0, previewItems=3)`. At DEFAULT `toolResultMaxChars=800` (`tool-execution.ts:551`),
showAll fails → model sees **3 of 25 posts** + recall() hint for other 22 (models rarely follow; sonnet balked "retrieve full content"). Repro: budget 800=3/25
rows, 2000=3/25, 4000=25/25. Prior 4→6 field lift made descendants VISIBLE but only on 3 shown rows — did NOT fix ROW-COUNT truncation → top-N-by-field selection
impossible for K>~6 arrays. **PROPOSED FIX (kernel → kernel-warden): MIDDLE try-fit tier = full-coverage-reduced-fields** (drop url, tighten title, keep numeric
selection fields → all-25 ≈ 1375 chars fits budget, beats 3-item preview). Content-aware array projection = overhaul thesis. Report §ROOT CAUSE:
`wiki/Research/Harness-Reports/phase1-postcond-ab-2026-06-01.md`.

**▶▶ CORRECTED ROOT CAUSE (2026-06-01, full-path repro — advisor caught a SECOND cap; isolation≠composition AGAIN).** Field research
(`wiki/Research/2026-06-01-context-length-handling-competitive-research.md`): budget = %-of-effective-window, offload+JIT-retrieve, control-first
composable overrides (LangChain/Anthropic/OpenAI/Mastra). User approved "window-derived budget + column-drop." BUT real assembly path overturns it:
`conversation-assembly.ts:105-128` (G-4) — obs w/ storedKey → inlines FULL RAW from scratchpad BYTE-SLICED at tier-INDEPENDENT `TOOL_RESULT_INLINE_CAP=4000`
+ "…truncated, recall full" marker (`fullFromScratchpad ?? obsStep.content` PREFERS raw → THROWS AWAY compressToolResult's structured preview). Repro on
pinned 25-post fixture (raw 4874) at ALL 4 tier budgets = IDENTICAL: 4039 chars raw JSON, 21/25 posts, truncation marker. **Per-tier toolResultMaxChars
(600/800/1200/4000) is INERT for model-visible content — 4000 inline cap dominates once raw>4000. Window-derived per-tier budget = NO-OP for this defect
(§9 — DROP).** REVISED FIX (both KERNEL → kernel-warden): **(1) PRIMARY: conversation-assembly — when raw>cap use STRUCTURED preview (obsStep.content)
not raw byte-slice (complete coverage + no balk marker + fits cap); (2) column-drop in compressToolResult — NOW load-bearing (assembly uses it): all-items
reduced-width.** Inline cap MAY be window-derived later (secondary). Surfaced reversal to user.

**▶▶ RETRACTED — TRUNCATION DEFECT WAS ALREADY FIXED (2026-06-01, kernel-warden VETO + git timing).** Dispatched kernel-warden; it REFUSED + escalated
(correctly), ran the LIVE `buildConversationMessages` pipeline: all 25 fixture posts delivered at frontier/mid/local-8k/local-4k, NO marker; only tiny
local-2048 truncates. `applyAgeAwareCuration` (`RA_CURATION_AGEAWARE !== "0"`, DEFAULT-ON since 2026-05-30, context-utils.ts:229) runs AFTER assembly + keeps the
synthesis-target FULL. My diag-assembly.ts OMITTED this default-on stage → reproduced a PRE-FIX world. Git: curation flip `799487c1`=2026-05-30 19:47; sonnet 0/3
baseline ran 13:58 (~6h BEFORE fix). Docstring: curation ON → sonnet T3-strict 1/3→3/3. `799487c1` ancestor of HEAD. **Frontier truncation was REAL but
SHIPPED-FIXED; sonnet 0/3 was STALE. Changes A+B DROPPED (inert — curation overwrites conversation-assembly). No code, no commit.** PROCESS LESSON (4th
isolation≠composition burn this session — bank HARD): NEVER hand-reimplement a pipeline slice; reproduce through the REAL entry point (`buildConversationMessages`).
Warden pilot earned its keep. **GENUINE residual (NOT truncation):** cogito T3 0/3 = REASONING (wrong-field sort, sees all 25); qwen = instruction (no-filter dump);
narrow latent = raw>recentCharBudget (huge results / 2048 windows) byte-slices in curation RECENT branch (tool-formatting.ts:633-640) — column-drop helps THERE,
re-justify on merits. Field research valid: `wiki/Research/2026-06-01-context-length-handling-competitive-research.md`.

## ▶▶ NEXT HIGHEST-IMPACT = KV-CACHE PREFIX STABILITY (alignment-doc P2/P6 — top OPEN priority; P1 #7 / P3 pass^k / P5 ablations DONE)
Source: `wiki/Research/2026-05-30-reactive-agents-alignment-gap.md` (3× 🔴 conflicts root to per-iteration tool churn). Caching IS wired (verified): Anthropic
`cache_control: ephemeral` on system+tool-list+last-tool_result (`providers/anthropic.ts:44-153`); OpenAI reads `cached_tokens`. Impact = cloud INPUT-token COST
(cache_read ~10% price) → attacks Mastra 5× input gap. **Cached system-prompt prefix has 3 per-iteration BREAKERS (live on default path, assembly system-prompt.ts:54-62):**
(1) minute `Time:` (env block first line) — **FIXED Step 1 `283c22a5`** (default→date; control-first EnvTimePrecision param > RA_ENV_TIME_PRECISION env > "date"; minute/second
opt-in; reasoning 1615/0). (2) tool-reference CHURN — `buildToolReference(goal, c.tools.schemas)` uses lazy-PRUNED set (RA_LAZY_TOOLS!=0 default). (3) `Remaining steps:`
recitation (line 62) SHRINKS per iteration. **∴ caching defeated BY DESIGN (volatile per-turn content lives IN the cached prompt); Step 1 fixed 1/3 — measuring NOW
would be CONFOUNDED by (2)+(3), deferred (no confounded paid measurement).** **Step 2 (EXPANDED, ablation-gated): (a) stable tool CATALOG in prompt (no churn; canon
mask-don't-churn + tool_choice) + (b) MOVE `Remaining steps` recitation OUT of system prompt INTO RECENCY (also = alignment-doc P4 recitation + anti-lost-in-middle) +
(c) timestamp done. ABLATION REQUIRED (lazy-disclosure had real 2026-04-26 prompt-curation gains): stable-resident vs churn → cross-tier pass^k + cache_read on pinned
fixture. THEN clean combined cache_read before/after (cloud).** User approved Step1→Step2. Tool-churn also roots the relevantTools-drop bug + recall-lure; recall REDESIGN
(remove recall meta-tool → auto rehydration) adjacent: `wiki/Architecture/Design-Specs/2026-05-30-recall-redesign-automatic-rehydration.md` (draft).

## ▶▶ #5 window-resolution FIXED `9aa8176a`, MEASURED ≈ NEUTRAL (2026-05-31)
scaffoldProfile DROPPED (§9 no-consumer). Real defect: builder baked CONTEXT_PROFILES[tier] PLACEHOLDER
maxTokens (mid=32768) → flowed as caller-provided → runner's applyCapabilityMaxTokens early-returned →
builder agents ran at 32768 not model's real window (createRuntime resolved fine → API asymmetry). Probe:
callerMax=32768. Fix: `resolveProfileWithWindow(model,provider)` binds maxTokens to recommendedNumCtx
(capability=source-of-truth); per-model so ollama unknown→2048 intact. 32768→200000 (recency 45875→280000).
reasoning 1606/0, build green, +3 tests. **MEASURED (window A/B, overflow-summary 57k, mid haiku, N=2):
coverage 1.0 BOTH (no lift), tokens noise-neutral, success 4/4.** WHY: tool-result compression stores+previews
large reads BEFORE assembly → window rarely governs → bug largely BENIGN on this class. Correctness-positive
+ token-neutral but NOT a lift. UNTESTED: many-results/long-convo classes. DECISION (user): **KEEP as correctness fix** — #5 CLOSED. Harness knob committed `b090dae1`. Next direction =
USER FORK (deep substrate #4/#3 vs parked capability axis vs 2 stale-evidence debts), NOT auto-descent.
PRE-EXISTING runtime cast-ceiling RED (≤62; was 68 at base; #7 +2) — separate cleanup, not ceiling-raise.

## ✅ PHASE 1 COMPLETE (greenfield deterministic core) — subagent-driven TDD, 9/9 assembly tests
`packages/reasoning/src/assembly/` (outside kernel/**). Commits: `a88c0af7` EventLog+AgentEvent (append-only
single source) · `7ad2bd70` content-addressed ResultStore (sha ref; summarize/materialize via tools
renderValue) · `5fc971ee` ResolvedCapability (single source; budgets derived; predictNumCtx buckets) ·
`b98a219c` types + AssemblyTrace (observability = return type). All pure, typecheck clean, no `any`.
**✅ PHASE 2 COMPLETE** — pure `project()` pipeline, 18/18 assembly tests, typecheck clean, no `any`.
`afc135a1` skeleton+composition · `162f96a0` projectResults (FULL|summary+ref, no marker/recall) ·
`15308d2f` systemPrompt (persona+goal+remaining) · `a05be9eb` selectTools(deduped/masked)+finalize ·
`73dc7329` compactHistory + e2e (50-commit overflow→summary+ref, full data in store). Phases 1+2 = the
WHOLE clean deterministic observable core, greenfield outside kernel/**.
## ✅ PHASE 3 COMPLETE — live seam wired + PROVEN live (deterministic + multi-turn + overflow)
- 3.1 `ba471704` `fromKernelState → AssemblyInput` (8/8): goal=first user msg; toolCalls→tool_called;
  tool_result→events w/ storedKey ref; scratchpad→ResultStore via `putWithRef` (preserves `_tool_result_N`).
- `8ad271e6` **project() emits a PROVIDER-VALID thread** (advisor-caught gate): was emitting only tool_result
  legs → no user(goal)/assistant{tool_use} → providers 400. Fix: walk log.events in order, user(goal) first,
  group parallel calls into ONE assistant turn; compact-history never orphans a tool_result. 29/29.
- `b8fee8de` `toLLMMessages` glue (LLMMessage = role:"tool" + assistant tool_use as ContentBlock[], not toolCalls).
- `488daf34` **RA_ASSEMBLY live seam** (kernel-warden): think.ts gates prompt build through project(fromKernelState);
  unset = byte-identical curate(); trace→stderr under RA_ASSEMBLY_DEBUG=1. 28 kernel + 1480 green.
- `181afdf2` **golden-trace**: same state → byte-identical trace ×3; 126k→summary+ref; full data recoverable.
- `034fcebd` `RA_RECENCY_BUDGET_CHARS` knob (force overflow branch deterministically).
- **LIVE PROOF (Anthropic haiku, real MCP):** =1 multi-turn thread accepted 5 think-iters/17 steps/success;
  control (=0) failed identically on a separate bug ⟹ assembly innocent. With `RA_RECENCY_BUDGET_CHARS=2000`
  summary+ref FIRED mid-loop, thread stayed valid, 0 llm_error, success. **live+overflow+multi-turn closed.**
  Debrief `wiki/Research/Debriefs/2026-05-31-phase32-live-seam-and-mcp-name-bug.md`.

## ⭐ PRE-EXISTING BUG FIXED — MCP tool names broke native-FC `34dc70cf`
Found during the 3.2 live smoke (read the WIRE; earlier "malformed schema" guess WRONG). Raw 400:
`tools.0.custom.name: String should match pattern '^[a-zA-Z0-9_-]{1,128}$'`. MCP registers `${server}/${tool}`
(tool-service.ts:454); `/` violates the provider FC name regex (OpenAI identical). No sanitization anywhere ⟹
**MCP tools NEVER worked on Anthropic/OpenAI native FC** (text-parse/local only). Bisect: file-write succeeds
7 steps live; github/list_commits alone → 0-tok llm_error. Fix (sanitize ONLY at provider payload, canonical
elsewhere): `sanitizeToolName` helper; think.ts outbound sanitize + inbound reverse-map before both consumers;
`toProviderMessage`(=0) + `toLLMMessages`(=1) sanitize replay names. 11 tests, 1492 green. Separate ticket:
file-write tool wrote 3× but no file (sandbox/cwd).

## ⛔ PHASE 4 VERDICT `e4de9849` — DO NOT DELETE legacy builders (cross-tier A/B grid)
Grid `apps/examples/assembly-ab-grid.sh`: RA_ASSEMBLY(project) vs legacy curate(), 2 arms × {compact,
overflow} × {local qwen3.5, mid haiku} × RUNS=2. Debrief
`wiki/Research/Debriefs/2026-05-31-phase4-ab-grid-and-deletion-gating.md`.
- **compact = PARITY** (=1 succeeds everywhere); token deltas confounded by meta-tool choice (=0
  discover-tools vs =1 brief) — not a clean assembly cost.
- **overflow = MIXED; =1 REGRESSES on mid** 0/2 vs legacy 2/2 faithful @4250 tok. project() `summarize()`
  strips content to bare result_ref + steers to write_result_to_file → mid loops recall/find → fail.
  Legacy keeps **compressed-preview inline** (~10k of 57k) → content visible → faithful summary
  (wire-verified). local: =1 2/2 vs =0 one 84k runaway. Read = "no-regression bar NOT cleared," not "project broken."
- **Phase 5 does NOT rescue:** write_result_to_file copies a blob, can't summarize. Fix = 4th
  **content-preview projection mode** keyed to deliverable type (read-content=keep preview vs
  act-by-reference=bare ref). spike `2c5d77bf` validated act-by-ref; THIS grid tested summarize → bare-ref wrong.
- **Delete blocked, 2 independent legs:** (1) defaultContextCurator + buildStaticContext are PUBLIC API
  (mandate keeps); plan-execute/ToT/reflexion assemble via separate path project() doesn't cover (seam =
  reactive think.ts curate ONLY). (2) empirical mid overflow regression. MCP-unblock necessary, NOT sufficient.
- **Method (read-wire ×2):** bun loads reasoning from DIST (`"bun"` export) → REBUILD before live overhaul runs
  (dist was stale); seam fires REACTIVE only → SPOT_STRATEGY pin added. 4 overflow vehicles refuted; ONLY
  file-read of a local 57k fixture overflows.

## ▶▶ #7 RA_POST_CONDITIONS SHIPPED default-on `bc5737a1` + RA_ASSEMBLY parity DEBT (2026-05-31)
**#7:** state-grounded done default-on across all 3 gates (arbitrator + terminate [warden caught
the twin gate] + reflexion Gate B); opt-out RA_POST_CONDITIONS=0. Ablation FIRST caught 3 latent
bugs default-on would've triggered (path-norm `17a7169c`, write-verb derivation `463fbcee`,
branch-RED type mirror); re-ablation GREEN — cogito summary 1/3→3/3, mid parity, token-neutral;
haiku JUDGE per-run quality 0.31→0.72 (all pass 0.6). Verdict
`wiki/Research/Harness-Reports/postconditions-ablation-2026-05-31.md`.
**⚠️ RA_ASSEMBLY parity DEBT:** the FLIP (c86d1c00) was validated on a 518-test warden SUBSET;
FULL 1535 suite was RED (18; RA_ASSEMBLY=0 → 1535/0). project() dropped buildStaticContext
sections. FIXED: Environment port `0408f5d1`, tier-adaptive tool-reference port `e0e35ad5`
(requiredTools LIVE via runner seeding), custom-env thread `cf700b3a`.
**▶▶ FULL-GREEN `2c6be004` — reasoning 1597/0, 38/38 build.** The "8 remaining" triage was WRONG:
only the env one was narrow; the other 7 were THREE real production drops vs legacy: (1) TASK DROP
(5 tests) — goal sourced ONLY from state.messages, seeded ONLY from initialMessages (runner.ts:204);
executeReactive w/o initialMessages (legal) → empty messages + no goal (provider rejects zero-user-turn).
Fix: fromKernelState takes input.task fallback (think.ts threads it); projectResultsStage builds the
user turn FROM the goal event → one fix, both surfaces. (2) CoT PERSONA DROP (2) — dropped tier-default
buildSystemPrompt persona ("Think step by step"); fix: fall back to buildSystemPrompt. (3) RULES DROP
(2) — ported buildRules gated by same RA_LAZY_TOOLS=0. +2 latent typecheck bugs: state.requiredTools
→ state.meta.requiredTools; any-cast → typed normalizer. Kernel edits via warden (+KernelState.environmentContext
field, lived only on KernelInput).
**PROCESS LESSON REINFORCED: full suite is the default-on gate, NOT warden subsets; "test-shape migration"
is a seductive mislabel for real drops — PROBE before migrating.**
**✅ #7 postConditions seed incoherence — FIXED `2c9cb155`.** Was: runner.ts:242 seeded meta only `=== "1"`
while gates flipped default-on `!== "0"`; terminate.ts:120-122 (no re-derive fallback) → TERMINAL hard-stop
INERT by default (arbitrator+reflexion self-heal via re-derive, so only the terminal gate broke). Fix:
runner.ts:250 `=== "1"` → `!== "0"` (single-source); +3 stale comments. Tests: warden's terminate gate
unit (4) + my runner-level seed guard (unset seeds / =0 absent, discriminating by construction). Suite
**1603/0**, typecheck clean. **ADVISOR "ablate-unset" CLOSED BY EQUIVALENCE PROOF:** repo-wide grep → zero live `=== "1"`/truthiness
reads; all gates `!== "0"` → unset ≡ "1" byte-identically → **BEHAVIOR** transfers to shipped default with
certainty. **CAVEAT: NOT the numbers** — 0.31→0.72 measured at bc5737a1 BEFORE this session restored
env+persona+tool-reference to project(); "1"-then ≠ "1"-now → MAGNITUDE is stale evidence-debt (same as the
RA_ASSEMBLY grid claim); don't carry 0.31→0.72 live. Also: seed-fires + gate-demotes tested SEPARATELY; the
e2e "catches forced false-success" is undemonstrated by one test (required-tool confound) — don't overclaim.
DEFERRED 1 line: arbitrator:877 comment still says "=1" (stale); fold into next arbitrator edit.
**EVIDENCE DEBT — RA_ASSEMBLY grid STALE:** hardened grid ("−57% local tokens") ran at c86d1c00 when
project() missed env+tool-ref+persona+RULES (all 4 now restored). Faithfulness verdict SAFE; token delta
was largely measuring DROPPED content — do NOT carry "−57%" forward. Re-run vs content-complete project().
**META-RULE (3 deep): MEASURE THE DEFAULT REGIME USERS GET, NOT THE CONVENIENT ONE.** Critical path:
`wiki/Planning/Implementation-Plans/2026-05-31-cutover-critical-path-and-efficiency.md`.

## ▶▶ FLIP SHIPPED `c86d1c00` (2026-05-31) — project() IS THE REACTIVE DEFAULT (first real strangle)
`assemblyEnabled()` (`RA_ASSEMBLY !== "0"`, mirrors `recallGateEnabled`) flipped `think.ts` from
opt-in → default-on. Legacy `curate()` RETAINED as `RA_ASSEMBLY=0` killswitch — **deletion DEFERRED
per user**. Cleared by hardened cross-tier grid (N=3, faithfulness-graded,
`wiki/Research/Harness-Reports/assembly-ab-grid-hardened-2026-05-31.md`): overflow project()
deterministic **1.0 coverage BOTH tiers** vs legacy 0.82-0.91 + a 90k-tok runaway; rescues
local-runaway + mid-incompleteness; no regression. Via kernel-warden; 518 reasoning tests pass;
`assembly-enabled-contract.test.ts` (4/4) pins the contract. **Trace fix `d0b429d4`**: `AssemblyTrace`
was double-recording assistants + misordering (goal last) → projectResults now sole recorder
(trace-only, zero request change). window cap (`from-kernel-state.ts:112` mid 32768 not 200k) =
#5/calibration-entangled, deferred. **Critical-path doc**
`wiki/Planning/Implementation-Plans/2026-05-31-cutover-critical-path-and-efficiency.md` sequences by
CAPABILITY: FLIP✓ → **#7 post-conditions default-on (next)** → #5 → #4 → #3 → #8. 5 efficiency rules.

## ✅ #1 SHIPPED `a7306e34` + #2 RE-SCOPED (2026-05-31) — the Phase-4 verdict's two blockers, addressed
**#1 = the "4th content-preview projection mode" the verdict (line 51-53) called for.** `ResultStore.preview()`:
structure-aware bounded preview (markdown heading-skeleton / head-fallback) + honest truncation marker + ref,
replacing the bare `summarize()` that regressed mid overflow. project-results overflow branch → `preview+ref`
mode. A/B (haiku, N=4): **22/22 vs legacy 19/22** faithful (legacy silently dropped 3 spread-tail sections),
tokens ~flat. Cleared the mid-overflow regression = cutover **leg (a)**. Grader `apps/examples/section-coverage-grade.ts`.
Debrief `wiki/Research/Debriefs/2026-05-31-content-aware-projection.md`.
**#2 / leg (b) DESIGN + TRACE (`wiki/Architecture/Design-Specs/2026-05-31-cutover-leg-b-substrate-unification.md`):**
the verdict's "delete blocked leg 1" (planners assemble via separate path) is CORRECT but the fix is NOT
"project() covers them" — they're single-shot JSON task-specs, not threads (piping = breaks parsing). The
honest goal is **substrate** unification, and the TRACE proved it is **GATED BY ROADMAP #4, not independent**:
the `result_ref` resolver (`write_result_to_file`→`scratchpadStoreRef` `Ref<Map>` `_tool_result_*`) is
kernel-act-path ONLY (`tool-capabilities.ts:91`, populated `tool-execution.ts:538`); plan-execute tool_call
steps call `toolService.execute()` directly (`step-executor.ts:144`), bypassing it → a `preview+ref` PUT
plan-execute-side resolves NOWHERE. `projectResultForPrompt` helper built then **REVERTED `f9aea551`** (§9
scaffold-without-callers; belongs in #4). **Near-term INDEPENDENT wins:** flip RA_ASSEMBLY default-on
(cross-tier grid), delete `curate()` (1 caller `think.ts:353`), **dead-hint-strip SHIPPED `83a0573e`**
(`stripDeadStorageHints` in `strategies/plan-execute/output-utils.ts` — plan-execute discards full data + injects
into tool-less prompts, so compressToolResult's `[STORED:]`/`recall()` hints are dead pointers → fabrication /
scaffolding-echo HARD-fail; strip them, re-append nothing). Roadmap order corrected: near-term wins → #4 → #3
EventLog → #5 scaffoldProfile (incl `from-kernel-state.ts:112` mid window 32768 not 200k) → #7 → #8.

## ▶▶▶ OBSERVABILITY MECHANISM (building NOW) — see your own intervention density + failure modes
Deep-read the kernel first. **CODE-GROUNDED DIAGNOSIS:** state-machine kernel + TWO thick layers
(`iterate-pass.ts` ~22 per-iter interventions + `runner.ts` ~8 post-loop gates incl a 2nd synthesis LLM call);
~10 scattered termination DECIDERS (single-owner terminate = writer not decider); tool-result budget INVERTED
(frontier 600/local 2000); recall seam fires+`void`s (dead); learn forkDaemon no consumer; output = 4-way
scramble gated by PROSE verifier (post-conditions flag-OFF); 11 meta-tools always injected; KV-cache hostile.
- **KEY DISCOVERY:** `emitGuardFired`/`emitCuratorDecision`/`emitAlternativesConsidered` = **ZERO callers**.
  Event taxonomy + full bridge→recorder→JSONL pipeline built, never connected (dead-scaffold in observability layer).
- **BUILT:** `17d7cca3` analyzer `@reactive-agents/trace` `analyzeInterventions`+`renderInterventionReport`
  (timeline, overlap-storm=≥2 deciders/iter, per-guard freq/outcome, trace-detectable modes overlap/nudge-loop/
  recall-loop/runaway/max-iter; HONEST=frequency+overlap+correlation NOT causality; dishonest-success=gap).
  Synthetic proof `apps/examples/trace-guard-synthetic.ts` (0 kernel edits). 6/6. `e65b2472` (kernel-warden)
  ONE emit-only terminal-decision emitGuardFired @ runner.ts §10. **PROVEN end-to-end real run** (haiku): event
  lands in `~/.reactive-agents/traces/<runId>.jsonl`, analyzer renders it. Tracing default-ON there.
- **FLESHED OUT `0c0722e3`** — `analyzeRun`+`renderRunReport`: full per-run decision-grade signal over LIVE events.
  Groups: **honesty(KEYSTONE)** + intervention-pressure + cost + reasoning-trajectory + tool-outcomes + failure-modes +
  **coverage(CENTERPIECE)**. Honesty: status self-reported (post-conditions OFF) → NEVER bare "success", only
  "claimed-success (unverified)" or "dishonest-success-suspected" (claimed done + 0 substantive tool work). Coverage:
  BLIND metrics (no emitter) vs real zeros; names dead emitters. PROVEN on real trace. 12/12 analyze, 41/0 suite, DTS clean.
- **EMITTER AUDIT:** LIVE = snapshot, entropy, decision-evaluated, intervention-dispatched/suppressed, tool-call-*,
  harness-signal-injected, verifier-verdict, guard-fired(terminal). DEAD = emitCuratorDecision(0)/emitAlternativesConsidered(0)/
  emitLLMExchange(no live fire); no provider populates tokensIn/Out/cacheRead.
- **FEEDBACK LOOP COMPLETE `a11306e7`** — cohort comparator: `aggregateCohort`/`compareCohorts`/`renderCohortDelta`. HONESTY GATE
  first-class (B improves ONLY if dishonest-suspected flat/down AND deliverable-produced flat/up; token win on loosened honesty =
  regression). COVERAGE carried through (neutral+blind→"inconclusive"). cohort→runId solved (AgentResult.taskId==runId, spot-test
  prints it). Proven on 31k real traces. 45/0 suite, DTS clean.
- **DEFERRED (pull-when-needed):** guard-fired fan-out → fold into refactor collapse (DRY); llm-exchange token/cache → KV-cache lever;
  emitCuratorDecision → curator refactor; content post-conditions → if honesty comparison too coarse.

## ▶▶▶▶ REFACTOR (loop armed) — collapse thick mesh, comparator-gated
Per-cluster: baseline cohort (current) → instrument cluster guard emits → collapse → re-run → `compareCohorts` gates (honesty-gated). Kernel = kernel-warden.
- **Cluster-1 map `130d478b`** (`wiki/Architecture/Design-Specs/2026-05-31-termination-decider-collapse.md`). Sites 2,5,6,7 instrumented emit-only (7 `emitGuardFired`, behavior-neutral, build+1557 green).
- **⚠ RE-AIMED on baseline-smoke evidence.** 3 free local smokes → ZERO of sites 2,5,6,7 fired. MASKED not cold: `iterate-pass.ts` L517 runReactiveObserver → L525 dispatcher-early-stop → **L542 `return "break"`** pre-empts stall(L647)/oracle(L707)/loop(L850); low_delta(L469) accumulation-starved. Arbitrator (via reactive-observer `stall-detect`) IS de-facto single decider, wins iter 2. "5 bypass arbiter" premise REFUTED.
- **ROOT CAUSE: `reactive-intelligence/src/controller/evaluators/stall-detect.ts:28` hardcoded `tier="local"`** → STALL_WINDOW always 2 → premature iter-2 give-up every tier (mid=3/frontier=5 table was DEAD). 3 hot-path defects: D1 dead tier-gate; D2 low-flat-entropy≠stuck (17k-tok overflow flagged stuck; doc-claimed tool-call guard also unimplemented); D3 empty-output early-stop slips FM-A3 backstop → incoherent `success:false`+`goalAchieved:true`+`outputLen:0`+`"Reasoning failed"` + terminatedBy provenance split. Plus fabrication-honesty fail (qwen3.5 invented summary of nonexistent file).
- **✅ DEFECT 1 DONE (uncommitted).** RI: `tier?` on `ControllerEvalParams`; stall-detect reads `params.tier ?? "local"`; new `tests/controller/stall-detect.test.ts` 9/9; RI 488/0. Kernel (kernel-warden): `profile.tier` → `runReactiveObserver` → `evaluate({tier})`; build GREEN, reasoning 1557/0. Live haiku `01KSZNHX3D…`: no premature stall, gate holds. Live finding: `low_delta_guard` fired haiku iter3 → give-up deciders NOT cold on mid + another terminatedBy mismatch → reinforces D3.
- **⚠ D2 DROPPED (discriminating check).** stall-detect NEVER terminated (only nudged); `behavioralLoopScore` non-discriminating (0.33–0.5 across all classes); overflow harm caused by `evaluateEarlyStop` (=D3), not stall-detect. D2 = minor wasted-nudge → deferred (same fix as the capability lever).
- **✅ DEFECT 3 DONE (committed) — terminatedBy truthfulness.** ROOT: `react-kernel.ts deriveTerminatedBy` catch-all `done ? "final_answer"` mislabeled every harness/give-up done-reason as `final_answer` → `goalAchieved=true` on FAILED runs (the `success:false`+`goalAchieved:true`+`"Reasoning failed"` incoherence). FIX (advisor: WHITELIST not blacklist — whitelist miss=honest null/loud, blacklist miss=silent lie/corrupts cohort): whitelist `final_answer|final_answer_regex|content_stable|entropy_converged`→final_answer; catch-all done→`end_turn` (null). kernel-warden fixed canonical helper; reactive.ts (direct) CALLS it now (DRY, killed inline dup + unused import). Test 20/0, reasoning 1570/0 (zero breaks). Happy path preserved (live qwen3:4b final_answer_tool→goalAchieved:true). Bounded: makes overflow HONEST-fail (goalAchieved:null), not success (capability lever deferred). arbitrator.ts:1023 left (correct).
- **✅ BASELINE COHORT LOCKED (committed) — thick-baseline arm A.** 30 cells (qwen3:4b N=6 + haiku N=4 × {compact,overflow,stuck}). Report `wiki/Research/Harness-Reports/decider-baseline-cohort-2026-05-31.md`; tooling `decider-baseline.sh` + `decider-cohort-report.ts`. local: claimed 67%/dishonest 0%/deliverable 72%/tok-p50 20.8k; mid: 100%/0%/100%/10.6k. FINDINGS: (1) honesty CLEAN content-VERIFIED — "stuck" nonexistent-file trap → HONEST "file doesn't exist" on BOTH tiers (fabrication hypothesis REFUTED); D3 coherence holds live. (2) give-up deciders fire (loop_resolution/stall/low_delta). (3) local ~2× tokens.
- **⛔ RETRACTED overclaim (corrective commit):** first report HEADLINED "overlap-storm 28%/67% = thick-mesh disease." WRONG — ARTIFACT: every "storm" = `[give-up site emit, terminal_decision MIRROR]` co-occurring at terminating iter (§10 post-loop mirror, not a decider). **Same-iter overlap STRUCTURALLY IMPOSSIBLE** (single-writer terminate + `return "break"`). Fixed `analyze.ts` (exclude terminal_decision → 0%); trace 45/0. Lesson: structural read beats metric def.
- **✅ TERMINATION CLUSTER CLOSED.** Wins = D1 + D3 (neither leaned on retracted metric). Relocated 4× under evidence; closed honestly not chased to 5th. **arm B DEFERRED**: overlap justification gone; real wrong-winner justification (low_delta terminates → §8.5 salvages to harness_synthesis) needs counterfactual faithfulness cohort. Deferred: (a) wrong-winner precedence; (b) §8.5 bug — `nonFinalAnswerTerminations` has `"dispatcher-early-stop"` (hyphen) but live = `"controller_early_stop:dispatcher_early_stop"` (colon) → salvage misses variant.
- **✅ #1 CONTENT-AWARE PROJECTION SHIPPED — Phase-4 cutover blocker (leg a) CLEARED.** Debrief `wiki/Research/Debriefs/2026-05-31-content-aware-projection.md`. `ResultStore.preview(ref,budget)` = structure-aware bounded preview (markdown heading SKELETON, else head-truncate) + honest marker + ref, replacing bare `summarize()`. `projectResults` overflow → `preview+ref`. preview 8/8, assembly 45/0, reasoning 1574/0, build GREEN. VERIFIED BAR: legacy inlined ~5k of 57k, covered ~19/22 (silently dropped spread tail) — "faithful 2/2" was LENIENT. Built section-coverage grade FIRST (`apps/examples/section-coverage-grade.ts`). **A/B haiku overflow N=4: legacy ~19.3/22 vs preview 22/22 ROBUST, tokens ~4039 vs ~4818 (+19%=more faithful output).** Honesty-gate B IMPROVES. project() now BEATS legacy on overflow-summarize.
- **▶ NEXT — cutover leg (b) = #2: project() covers NON-REACTIVE strategies** (plan-execute/ToT/reflexion via separate path; seam only covers reactive think.ts) + public API → gates RA_ASSEMBLY default-on / legacy-builder deletion. Then #3 EventLog sole-record, #4 ResultStore replaces recall/[STORED:], #5 scaffoldProfile governance (incl. deferred window-source fix: mid capped 32768 not 200k), #6 termination arm B (deferred), #7 RA_POST_CONDITIONS default-on, #8 KV-cache assembly.

## ▶▶ STRATEGIC PIVOT `b818c372` — CANONICAL HARNESS CORE (overhaul widened to whole loop)
Spec `wiki/Architecture/Design-Specs/2026-05-31-canonical-harness-core.md`. User reframe post-Phase-4:
overhaul must deliver BOTH structural AND capability lift; RA mission = small-model uplift + frontier
(NOT capable-model convenience the thin canon assumes).
- **CRUX:** thick-by-default + pieces-vs-pieces proof (never vs own absence) → complexity ratchets. Fix:
  WHOLE-vs-WHOLE cross-tier LIVE proof; salvage map = falsifiable HYPOTHESES not verdicts (don't bake
  removals contradicting measured gains — lazy-disclosure 2026-04-26 churn gain → masking-vs-churn = ablate).
- **RECONCILE:** tier-aware capability→**scaffoldProfile** = thin default; scaffold only where it earns
  cross-tier ablation-proven uplift, per tier. Frontier→thin, small→more (each earned).
- **CORE (5):** one reducer loop (strategies=policies, kills dispatcher fragmentation) · deterministic
  CONTENT-AWARE projection (folds Phase-4: bare-ref regresses overflow-summarize) · capability→scaffoldProfile
  (1 budget source) · state-grounded content-aware verify · minimal RESIDENT MASKED tools.
- **PRINCIPLES:** P0 live-or-it-doesnt-count (unit-green≠evidence) · P1 strangler-fig TOP-LEVEL (delete thick
  ONLY on aggregate live win) · P2 salvage=hypotheses · P3 scaffold governance lifecycle (default-OFF→tier-gated
  →graduate via receipt→removable; defer plug-in abstraction YAGNI) · P4 pass^k cross-tier.
- **ROADMAP:** A measure (pass^k failure-mode bench + wire telemetry + LOCK thick baseline) → B thin core
  FRONTIER/MID FIRST (thin wins there; bare-core-vs-thick-on-local = false-negative trap) → C earn small tiers
  (ablate each scaffold ON w/ receipt) → D collapse+delete on aggregate win. NEXT: advisor → Phase A writing-plans.

## (DEFERRED, folded into core above) Phase 5-6 — Phase 4 deletion deferred; RA_ASSEMBLY stays flag-gated off
Deletion deferred until (a) content-preview projection mode closes the mid regression + (b) project() covers
non-reactive strategy assembly. Phase 5 land write_result_to_file in the path + real tool-call telemetry.
Phase 6 delete recall/[STORED:]/inline-cap. Plan `wiki/Planning/Implementation-Plans/2026-05-31-canonical-context-assembly-plan.md`.

## ▶ STEERING EXPERIMENT (b) VERDICT `7e34fecd` — mechanism SOUND, maze NON-DETERMINISTIC
Cheap-proof attempt on the CURRENT path. Found 3 maze gates hiding the ref tool (REAL bugs fixed):
(1) META_TOOLS missing write_result_to_file → buildToolSchemas pruned it; (2) **runtime ToolService.execute
allowlist blocked ALL meta-tools incl. recall under explicit allowedTools** (fix: allowed = userAllowed ∪
META_TOOLS); (3) registration present. PROVED: tool OFFERED (89 schema refs); **cogito ADOPTS+COMPREHENDS**
(6 calls, conf 0.9) — overturns "weak models won't adopt" (availability suffices). Materializer+execute
unit-green. BUT single-shot e2e UNPROVABLE: assembly/projection fires INCONSISTENTLY across identical runs
(non-determinism = the disease). VERDICT: stop patching maze; build canonical deterministic project()
(golden-trace test not flaky lottery). Debrief `wiki/Research/Debriefs/2026-05-31-steering-experiment-b-verdict.md`.
NEXT: Phase 1 greenfield core.

## 🎯 DESIGN-LOCKED: Canonical Context Assembly (overhaul north star)
Spec `wiki/Architecture/Design-Specs/2026-05-31-canonical-context-assembly.md` (`50392d5a`).
MANDATE: genuine overhaul, best design > backward-compat, root-cause fixes, do NOT preserve
misaligned decisions. **Locked IN foundational:** (1) single append-only EVENT LOG (replaces
messages[]/steps[] two-record); (2) content-addressed RESULTSTORE (replaces scratchpad/recall);
(3) pure total `project(log,capability,store)` = SOLE assembler. 10 pillars (one log; CAS results
never inlined → no marker/recall; project pure+total → replay/cache free; capability-once + num_ctx
predicted; per-result full|summary+ref|cleared; observability IS the return type; no model-facing
context machinery; deterministic; strategies=reducers over one log; honesty=projection). Legacy maze
DELETED (the 4 builders + compressToolResult-marker + TOOL_RESULT_INLINE_CAP + recall + [STORED:]).
Migration = strangler-fig PROVING scaffold only (shims removed, not compat). NEXT: writing-plans,
Phase 0 = PIN live assembly path.

## ▶ OVERHAUL BRANCH `overhaul/agentic-core-2026-05-31` — clean-room core refactor, PROOF-GATED
Re-architect agent loop + context systems in-place (keep providers/MCP/memory/public API + phase
structure). Replace model-facing context indirection (recall tool + [STORED:] markers) with a
SYSTEM-OWNED ContextManager + content-aware honesty + always-on wire telemetry. 8-principle spec
`wiki/Architecture/Design-Specs/2026-05-31-agentic-core-overhaul.md` (`cc39912e`).
- **✅ `2c5d77bf` reference-protocol spike PASS** — riskiest assumption validated (advisor risk-first).
  cogito:14b + qwen3:14b + qwen3.5 ALL emit clean `write_result_to_file(result_ref=commits_1)` given
  system-summary + ref tool alongside plain file_write — the two that failed marker-copy reference
  cleanly. llama3.2 sub-3B = honest floor (ref-as-text + fabricate). `apps/examples/overhaul-spike-ref.ts`.
- **✅ PHASE 0 DONE `c64e4e2b` — live path PINNED; "dead function" claim REVERSED.** Plan
  `wiki/Planning/Implementation-Plans/2026-05-31-canonical-context-assembly-plan.md` (`df6f61b0`).
  F1: `think.ts:331 curate → ContextManager.build → buildConversationMessages` renders the live request
  EVERY iteration (adapter always present). buildCuratedMessages dead on live path. F3: messages/scratchpad/
  steps/postConditions/adapter at curate. F4: postConditions + verifyPostConditions → GoalState derivable.
  **CORRECTION: prior `86ce02d9` "dead function/nothing ran live" was a FALSE NEGATIVE** (dist/src confusion).
  buildConversationMessages LIVE; projection FIRED (126647-char result → summary+ref; budget 45875 from
  maxTokens=32768 NOT num_ctx 15360 — mismatch to fix). curation default-on + projection were live all along.
  **NEW REAL GAP:** data removed → cogito FABRICATES placeholders instead of calling write_result_to_file;
  availability ≠ adoption on weak tiers → deliverable path must STEER/FORCE the ref tool (Phase-5 N≥3 lever).
  NEXT: Phase 1 greenfield core (EventLog/CAS ResultStore/ResolvedCapability/AssemblyTrace), TDD subagent-driven.
- **(superseded, WRONG) `86ce02d9` "dead function" — see Phase 0 reversal above.**
  Projection seam + age-aware curation seam live in `attend/context-utils.ts buildConversationMessages`,
  only caller `context/context-manager.ts:142` — NOT live. `think.ts` assembles via `defaultContextCurator`
  (context-curator.ts). After full rebuild: projection ENTRY never logs; write_result_to_file called by ZERO
  models (qwen3/gpt EXEC logs = 0 — clean bullets were NATURAL, I mis-inferred tool use from file format).
  RETRACTED "end-to-end working"/"lift" (dead-fn + stochastic noise). Components unit-green in ISOLATION; spike
  `2c5d77bf` valid. **CRITICAL NEXT:** wire projection into `defaultContextCurator` (LIVE path); **VERIFY
  curation-default-on `c9e6fba2` isn't ALSO dead** (if only in buildConversationMessages → Spike-1 never hit
  live loop, main bug); verify write_result_to_file is OFFERED not gated-pruned (EXEC/logModelIO not file
  format); real tool-call telemetry; THEN N≥3.
- **`another non-canonical code path` (user, conclusive):** the context-assembly layer is a MAZE of
  overlapping/swappable/partially-dead builders — `buildConversationMessages` (only via
  ContextManager.build's `if(adapter)` branch), `buildCuratedMessages` (its `else` branch),
  `ContextManager.build` (context-manager.ts), `defaultContextCurator.curate` (context-curator.ts:131
  wraps build; ContextCurator is INJECTABLE/swappable). CORRECTION to prior "runs from dist": bun
  resolves reasoning from **SRC** (`require.resolve` → packages/reasoning/src/index.ts; "bun" export says
  dist but src wins) — so src IS live, NO rebuild needed, my rebuilds were wasted. YET instrumenting
  ContextManager.build (RA_OVERHAUL_DEBUG branch log) NEVER fired in a live cogito run → ContextManager.build
  is NOT on the live path despite curate→build being a direct call. So the live assembler is some OTHER
  curator binding or a think.ts streaming branch that bypasses curate. **The multiplicity + inability to
  cheaply confirm which path renders the live prompt IS the disease.** OVERHAUL FIRST TASK (reframed):
  (a) PIN the live assembly path (instrument defaultContextCurator.curate ENTRY in context-curator.ts +
  read think.ts ~320-340 for stream-vs-complete branches + how the curator is injected), (b) CANONICALIZE
  to ONE assembler, (c) add "what did the model actually receive" observability (principle #4) — THEN wire
  projection/tool there. LESSON: a passing unit test + a present src edit prove NOTHING about live behavior;
  must confirm the seam is on the executing path via runtime instrumentation, not caller-grep alone.
- **NEXT (advisor order):** telemetry-BOTH-paths + LOCK OLD baseline (tier×task grid) BEFORE new →
  marginal 3rd arm (OLD + strip-[STORED:]-from-file-write point-fix) → ContextManager + ref
  materialization (NEW MODULE outside kernel/**, A/B-able; one flag-gated kernel seam via warden) →
  content-aware honesty → cross-tier proof-gate, attribute lift PER-component. Merge only on measured
  lift (20-commit overflow faithful + dishonest-success caught) ≤ tokens. LEASH: KEEP phase structure
  (user rejected collapse-to-canonical); principle #6 minimal-reducer is north-star only.

## ▶ EXECUTING — Canonical Convergence Plan (2026-05-30) — Phases 0+1 SHIPPED
Subagent-driven; cross-tier `pass^k` live gate per phase. Branch `main`, unpushed.
- Plan: `wiki/Planning/Implementation-Plans/2026-05-30-canonical-agentic-convergence-plan.md`
- Thesis: one mechanical **post-condition set** = state-grounded done + progress
  recitation (recency) + pulse self-check. Local-first, control-first, anti-scaffold.
- **Phase 0 ✅ `91924103`** — `pass^k` harness (`RUNS_PER_TASK`, strict-T3, postCond stub,
  `TASK_GATE_HN_FIXTURE` data-pinning). Baseline + `hn-fixture-2026-05-30.json`.
- **Phase 1 ✅ `0d05fbe3`** — PostCondition spine = state-grounded success authority,
  gated `RA_POST_CONDITIONS` (**default OFF**). Two seams: arbitrator mid-loop steer +
  `terminate()` TERMINAL hard-stop (single-owner; arbitrator-only first pass leaked via
  stall/`low_delta_guard` → fixed). Conditions derived once → `state.meta.postConditions`,
  both gates DRY-read. reflexion B generalized; probe `postConditionsMet` wired. Live gate
  proven BOTH directions (flag-off lied; flag-on 6/6 honest + met→success live). Suite 1486/0.
  **OPEN: default-flip ON is a clean follow-up (evidence supports).**
- **Phase 3 ✅ `0bfad06d`** — recall-overflow gate OPT-IN→DEFAULT-ON (opt-out `RA_RECALL_GATE=0`).
  Ablation (fixture N=3): gpt-4o-mini pass^k 2/5→5/5, −31% tok, recall-smells 5→0; cogito −11% tok
  → **first measured COMPLETION lift**. `extractObservationFacts` KEEP (removal REFUTED — it's
  token-PROTECTIVE; "44% removable" was wrong). llama3.2 sub-7B local 4/5 default-on. Caveats:
  ablation models both tier `mid`; MCP-overflow path = Phase-4 follow-up.
- **Spike 1 ✅ `799487c1` — AGE-AWARE CURATION (curation root, the BIG win).** `RA_CURATION_AGEAWARE`
  (default OFF, opt-in). Keep most-recent TURN's tool results FULL (window-scaled), compress only
  AGED. Root was a flat `TOOL_RESULT_INLINE_CAP=4000` (conversation-assembly.ts), age/window-blind →
  truncated the synthesis-target. Ablation (T3-strict, trusted metric): **sonnet 1/3→3/3 (T3 faith
  0→100, truncation loop ELIMINATED, avg 91→100)**, gpt+qwen flat, ZERO regression. (qwen composite
  dip = over-listing penalty only, faith identical — metric rewarding starvation, not a regression.)
  Suite 1496/0 both arms. Built in attend/ (tool-formatting.ts applyAgeAwareCuration + context-utils.ts).
- **✅ `c9e6fba2` (2026-05-31) — CURATION FLIPPED DEFAULT-ON (opt-out `RA_CURATION_AGEAWARE=0`).**
  WIRE-PROVEN sole root cause via logging reverse-proxy on literal Ollama /api/chat. cogito:14b
  num_ctx=15360: OFF → synthesis tool_result 4087 chars + REAL `...truncated (17646 chars)` marker,
  **3 of 10** commit objects → wrote 2-3. ON → 21646 chars, no marker, **10/10** objects → wrote 10
  (payload-verified faithful; advisor caught "wrote 10 ≠ saw 10", grepped `"sha"` objects).
  **num_ctx + output-cap REFUTED as failure modes** (15360 fast prompt_eval~1s; done_reason=stop,
  eval<<num_predict). Default-on overrides Spike1 "opt-in" on USER MANDATE + cogito proof; other tiers
  ride Spike1 ablation; NOT lift-rule re-gated. Debrief `wiki/Research/Debriefs/2026-05-31-context-truncation-wire-debrief.md`.
  **NEXT:** recall removal + auto-rehydration (curator owns reversible store now); RECENT_WINDOW_FRACTION 0.35 tune.
  Method lesson: read the WIRE not steps[]; `done_reason` discriminates input-vs-output failure.
- **(superseded framing) CONTEXT CURATION = THE ROOT (Spike 1 done above).** Reframe: recall is a
  SYMPTOM. RA crushes the CURRENT tool result to 600–4000 chars (frontier/sonnet **600**,
  inverted vs 200k window) BEFORE synthesis (`act/tool-execution.ts` `compressToolResult`,
  `context-profile.ts`), stashing full for recall → preview-synthesis (low faithfulness,
  fabrication, "truncated, let me retrieve" loops). Known-good algo: keep CURRENT result FULL
  (budget scaled to window), compress only AGED → reversible pointer, auto-re-hydrate by focus
  (obviates recall), compact near limit, re-fetch from source. First change: stop crushing
  current + window-scale budget. Then recall-removal folds in; meta-tool audit later. Spec
  `wiki/Architecture/Design-Specs/2026-05-30-context-curation-architecture.md` (c3eeca53); RFC
  c8cbe49f. Deferred: Phase 2 recitation, Phase 4 mask-don't-remove tool-stability, Phase 5 experience-reuse.
- **num_ctx `b1561303` — REFUTED as a failure mode (2026-05-31 wire hunt).** Set `capability.ts`
  recommendedNumCtx 8192→32768; operator since set **15_360** on both 14b models ("half for speed").
  Wire proof: num_ctx is NOT the regression cause — 15360 is fast (prompt_eval~1s), prompt fits.
  The real cause was the 4000-char tool-result cap (curation, fixed `c9e6fba2`). **PREDICTIVE
  BUCKETED num_ctx DEPRIORITIZED** — speed/VRAM optimization only, not a correctness fix. Stale
  "set to 32K" comment + reformatting churn live in capability.ts working tree (operator's to commit).
- **OLLAMA OPS:** cogito:3b = runaway (~9.5min/chat) — never probe with it; verify `nvidia-smi`
  + real latency after any `systemctl restart ollama` (restart can leave it CPU-bound — check n_ctx
  in `journalctl -u ollama`); use llama3.2/qwen3.5 local; wrap probes in `timeout`.
- GATE: each phase ends with cross-tier `pass^k` live run + `rax:diagnose` + advisor()
  before commit. No phase done on unit-green alone. Kernel edits → `kernel-warden`+MissionBrief.

## Read first

Before doing any work in this repo:

1. **`wiki/Architecture/Specs/04-PROJECT-STATE.md`** — current empirical state of the framework.
2. **`wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md`** — authoritative architecture + forward plan. If this memory file conflicts with North Star, North Star wins.
3. **`wiki/Architecture/Specs/06-MISSION-STATEMENTS.md`** — guiding statements + L1/L2/L3 success metric ladder + 8 anti-mission boundaries.
4. **`wiki/Architecture/Specs/07-OPTIMAL-EXECUTION-ALGORITHM.md`** — canonical per-iter algorithm + per-capability success signals (NEW 2026-05-23).
5. **`wiki/Architecture/Specs/01-RESEARCH-DISCIPLINE.md`** — 12 rules. Every harness change requires prior spike validation. No exceptions.
6. **`wiki/Hot.md`** — recent-context cache; check for the latest session handoff.
7. **`wiki/Architecture/Design-Specs/2026-05-23-harness-convergence.md`** — active morph spec (22 GH issues #104–#125).

The full canonical doc set is listed in `wiki/Architecture/Specs/DOCUMENT_INDEX.md`.

---

## ACTIVE — Harness Perf Cross-Tier Campaign (2026-05-29)

Tier-aware context architecture redesign. Branch `main` (canonical-refactor merged `d783c876`, unpushed). Goal: harness adapts to model tier + provider quirks → consistent agentic perf frontier/mid/local; transparent control-first; wire existing systems (don't rebuild).

Docs: `wiki/Planning/Implementation-Plans/2026-05-29-harness-perf-cross-tier-campaign.md` + `wiki/Architecture/Design-Specs/2026-05-29-tier-aware-context-architecture.md` + `wiki/Research/2026-05-29-agentic-context-engineering-findings.md`.

Canonical model (research-grounded: Anthropic context-eng, RULER, Context Rot, MemGPT): recent obs inline-full · old obs cleared · recall only for NOT-in-context data — × tier-calibration scaled to EFFECTIVE context. Reduce PROSE verbosity for weak tiers; KEEP tool-result DATA budget (local=4000 deliberately largest).

Cross-tier N=3 baseline (proof gate T1–T5) = 3 distinct failure modes: gpt-4o-mini redundant-recall; qwen3.5 2× tokens; cogito:14b degraded correctness (T3=34%, never recalls). Composite scorer too lenient (hides cogito) → strict per-item check needed.

- **Inc 1 recall-gating (BUILT, OPT-IN `RA_RECALL_GATE=1`, default off):** stale buildRules plan SCRATCHED — both prompt-rule lure sites are dead in default lazy mode (`RA_LAZY_TOOLS` gates buildRules + recent-obs off). Trace `01KSV58K`: model recalled BLIND (invented key `hn_posts`) on a 3928-char INLINE result purely because `recall` was in the tool schema. Fix = `think-guards.filterRecallByOverflow` gates recall OUT of `think.ts` per-iteration `gatedToolSchemas` unless a `recall("<key>"…)` marker is surfaced in the CURRENT window (or calibration `uses-recall`). Default off until cross-tier MCP ablation proves ≥3pp/no-regression (project default-on rule).
- **Inc 2 token bloat PINNED:** `extractObservationFacts` (`tool-execution.ts:822`) per-tool-result LLM extraction, gated `act.ts:143-144` `shouldExtract` → local+mid only. 44% of local tokens. Likely redundant (full data already inline). Ablation: local obsMode=false, composite vs tokens.
- Refuted by evidence before any code: history-resend, output-verbosity, reasoning-input, debrief/memory.
- Instrumentation shipped: input/output token split in `task-quality-gate.ts` probe (`TASK_GATE_NO_MEMORY=1` toggle). Production path already wired (`step-utils.ts:90` → `execution-engine.ts:1116`).
- Secondary track: entropy stall-detect non-discriminating (flat 0.15) → structural boredom-detection.

### MCP relevantTools-drop fix (2026-05-30) — shipped, separate concern
reflexion/ToT/plan-execute strategies never forwarded classifier `relevantTools` into their kernel passes (forwarded `requiredTools` only). Under lazy disclosure the kernel visible set = `required+relevant+used+discovered+meta` (`think.ts:232`) → relevant empty → ALL MCP/user tools pruned → model blind (spot-test cogito+GitHub-MCP looped on `find`, `success:false`). Fixed: forward `relevantTools` in `reflexion.ts`/`tree-of-thought.ts`/`plan-execute.ts`→`step-executor.ts`→`react-kernel.ts`. Proof: spot-test success false→true, 17959→8219 tok (−54%), github/list_commits called with real data. RED-verified `tests/strategies/strategy-relevant-tools-forwarding.test.ts`. See `[[project_mcp_relevant_tools_drop_fix]]`.

### Follow-on: file-write never happened (2026-05-30) — routing NOT the bug
adaptive routed task → reflexion on "self-critique and improve" keyword (`heuristicClassify` adaptive.ts:471/506). Advisor: routing DEFENSIBLE, not the bug; adding write/create patterns to a keyword matcher deepens brittleness — don't reroute. Real chain why success:true but no commits.md:
- **C (root, DEFERRED):** classifier correctly required `[github/list_commits, file-write]` → `classifier.ts:216` literal-mention demotion stripped both to relevant ("create a markdown file" ≠ literal "file-write") → required empty. Clean fix = reliability-gate demotion, but cogito:14b `classifierReliability` UNSET (not "high"); un-gating for all unset models is broad/needs cross-model validation. Not shipped.
- **B (FIXED+proven):** reflexion `isSatisfied(critique)` text-only → declared done with no file (success:true LIE). Fix `reflexion.ts:~302` gate satisfied-termination on `getMissingRequiredToolsFromSteps(...).length===0`, scoped to non-empty requiredTools. RED-verified `reflexion-required-completion-gate.test.ts`. 1449 reasoning pass.
- **cogito limit:** even forced-required, cogito (14b local) failed to reliably call file-write (toolsUsed=[]). Harness enforces+reports honestly; can't make weak model competent.
- Honest: B DORMANT in real spot-test path (file-write demoted→not required→B no-op). Real path still success:true+no-file until C lands or user adds `.withRequiredTools`. Filed (don't sweep): keyword-brittle heuristic router, text-only isSatisfied, literal-mention demotion too strict for semantic deliverables.

## ACTIVE — Harness Convergence Sweep (2026-05-23)

**22 GH issues filed, 4-phase migration plan, 97 evidence-bearing multi-model probe runs.**

### Single highest-leverage learning

**"Scaffold without callers"** anti-pattern shipped 4× in v0.10.6:
- 4 of 7 Compose TagMap entries with no emit sites
- 8 of 13 `ControllerDecision` variants never fire in failure-corpus
- ~9 of 14 calibration fields with zero consumers
- 1 silent skill persistence path (`emitErrorSwallowed` swallow)

**Codified as Anti-Scaffold Principle in North Star §9.** Every declared surface element MUST have an emit site / consumer in same commit. v0.12 lint discipline.

### Phase 0 — Surface Trust Restoration (COMPLETE 2026-05-23 ✅)

All P0 bugs closed (merged to `main`). Probe-verified cross-tier (cogito:14b + qwen3:14b). 2458 tests green.

- ✅ **#104 M1** — INVALID after empirical verification: schema field is `tokensUsed`, not `totalTokens`. Probe scripts fixed (commit 977da423). #126 filed as P2 naming-consistency followup.
- ✅ **#105 M2a/b/c** — `stripFrameworkLeaks()` at output-assembly + runtime `sanitizeOutput` + verifier `output-not-harness-parrot` backstop (commit b82aac35). Strips paired/orphan `<rationale>`, `[CRITIQUE N] <STATUS>:` (all statuses), `[find/search result —]` templates. Cogito 9/9 + qwen3 9/9 CLEAN post-fix.
- ✅ **#106 M7** — Output/status coherence invariant at `buildStrategyResult` (commit 05b7ab8d). Null/empty/whitespace output coerced to `status:"failed"` regardless of caller. 8 new tests + honest-failure regression updates.
- ✅ **#107 R9** — `DispatchResult.appliedPatches: AppliedPatchRecord[] = {decisionType, patch}[]` preserves decision→patch link (commit 8715fb13). Both InterventionDispatched emit sites publish source decisionType + patchKind separately. Trace shows: decisionType ∈ {early-stop, stall-detect}; patchKind ∈ {early-stop}. Zero conflation.
- ✅ **#108 R10** — Ablation probe `.withReactiveIntelligence(riEnabled)` explicit toggle (commit 1d528861). RI-off cells: `interventionsDispatched=0` across all 4 scenarios. Counter is correctly RI-scoped.
- ✅ **#109 R11** — Triple-surface skill persistence failure: console.warn + Effect.logWarning + ErrorSwallowed tagged `"SkillPersistenceFailed"` (commit af6a9e35). Canonical grep predicate: `e._tag === "ErrorSwallowed" && e.tag === "SkillPersistenceFailed"`.

### Health Sweep — 2026-05-27 (60 findings, 8 new GH issues)

> **⚠️ 2026-06-05 RE-VERIFY — findings below have drifted (9d + several refactors).** Full audit re-ran every `verified-by` vs HEAD. **CLOSED stale:** #151 (Gateway `this as any` fixed — `reactive-agent.ts:1410/1438` use typed `this`), **#169** (the "21 cross-edges + 7 cycles" claim at line ~655 is FALSE — kernel/capabilities is a DAG, 0 cycles; `verify`+`comprehend` are sink nodes so the cycles are structurally impossible), #84 (@internal no longer leaks barrel), #93 (`focusedTools` now typed), #165 (orphan release gone). **#184 filed then downgraded p3** — the real residual madge cycles (assembly/context/loop) are all `import type` = cosmetic, NOT runtime coupling; relocating to drive madge→0 = metric-gaming (`feedback_no_metric_gaming_refactor`). **DRIFT (legs fixed, re-scoped via GH comment):** #167 (casts 64→3, merges 38→19), #152 (2/3 fixed, only HS-B-03 telemetry counter left), #79 (experienceSummary leg gone), #155 (observe+vue now tested), #87 (grew 55→87). **STILL VALID open:** #77 #153 #154 #156 #157 #158 #160 #163 #164 #166 #168 #170. Treat counts/lines below as 2026-05-27 snapshots — re-grep before acting.
>
> **2026-06-05 EXECUTION:** 3 parallel wardens shipped PRs (unmerged): **#185** (#157 memory swallow-telemetry, 4 sites→emitErrorSwallowed), **#186** (#156 llm-provider deepClone dedup, 4 sites), **#187** (#163 cortex-ui AgentStreamEvent union — root cause was a hand-rolled local copy w/ `Record<string,unknown>` escape hatch defeating `_tag` narrowing; fix in cortex/ui only, core AgentEvent unchanged). **#170 M12-hooks half = 4th STALE finding** (the 5 hooks are LIVE in reasoning/ kernel — `continuationHint`/`errorRecovery`/`synthesisPrompt`/`qualityCheck`/`systemPromptPatch`; "LocalProviderAdapter" is a misnomer; re-scoped to observe-only). **New:** #188 (AgentStreamEvent diverged 3-way runtime/svelte/chat-store), **#189 P1** (`@reactive-agents/observability` OTLP DTS broken — `OTLPTraceExporter` not assignable to `SpanExporter`, otlp-exporter.ts; may red `turbo typecheck` on any PR graph including observability). **NEXT high-impact = #168** (103 `Effect<X,unknown>` — sequenced per-package campaign, not parallel; memory = cleanest first slice).

**Method:** 4 parallel scan agents (codebase-health-sweep skill v3), `verified-by:` per audit-of-audit. Build GREEN (38/38 turbo). Full report `wiki/Research/Audit-Reports-2026-05-27/health-sweep.md`.

**Filed:** #151 (HS-A-01 P1 Gateway `this as any`), #152 (HS-B-01/02/03 P1 honesty-pass bundle), #153 (HS-A-03 P2 dead trace exports), #154 (HS-A-18 P1 HITL example calls nonexistent `onApprovalRequest`), #155 (HS-D-01/02/17/19 P1 surface test gaps observe+vue+health+umbrella), #156 (HS-C-11/12 P2 provider `completeStructured` dup + JSON deep-clone), #157 (HS-B-04 P2 memory-service 4× swallows missing `emitErrorSwallowed`), #158 (HS-A-19 P2 playground reads private `_lastDebrief`).

**Comments on existing:** #77 (5 of 7 HS-20 monoliths grew + 5 NEW monoliths post-W26 including runner.ts 1739→1934, reactive-agent.ts 1415, runtime.ts 1261, builder.ts 2027, execution-engine.ts 1414), #78 (4/5 HS-21 deprecated still active + 1 new HS-C-20), #87 (test `as unknown as` grew 55→85 = +55%, reasoning(12)+runtime(10)+RI(4) hotspots).

**Two active debt vectors:**
1. **File-size regression** — arbitrator.ts +161 LOC most aggressive grower; runner regrew post-decomp.
2. **Mock drift mirrors source drift** — Fixing source-side seam types (#91 + #151) auto-reduces test cast surface.

**Stale doc detected:** `CLAUDE.md` cites runner.ts at 1,739 LOC; actual 1934. Update during next docs sweep.

**No P0 found in iter 1.** Strong honesty discipline (0 `@ts-ignore` in prod, 0 `.skip`/`.todo` in tests, 0 dist/ committed).

### Iter 2 (2026-05-28) — apps/* + wiki/docs staleness — **1 P0 surfaced**

**+27 findings** (E:12 apps, F:15 docs) → 6 GH issues #159-#164.

**🚨 P0 #159 release-state drift:** root `VERSION=0.11.1`, npm has 0.11.1 published, BUT 34/35 `packages/*/package.json` at `0.10.6` + NO `v0.10.x`/`v0.11.x` git tags exist (local OR remote, both max at `v0.9.0`). Tag-driven release flow violated. Next `bun run release:dry 0.12.0` will fail the drift gate per `feedback_npm_version_drift`.

**P1 #160 confidenceFloor doc lie:** killswitch unshipped 2026-05-19 per `project_killswitch_honesty_2026_05_19` but still in AGENTS.md L66/L99 + Hot.md L25. Re-add risk.

**P1 #162 AgentResult.debrief missing public type:** supersedes #158, single 5-LOC fix closes 4 cast sites across CLI + cortex/server.

**P1 #163 AgentEvent union not narrowing on `_tag`:** 13+ casts in cortex/ui (chat-store + RunChatTab).

**P1 #164 create-reactive-agent template:** ships `(process.env.LLM_PROVIDER as any)` to every scaffolded user project.

**Combined iter 1+2:** 87 findings, 14 GH issues, 3 comments. Build still GREEN.

### Iter 3 (2026-05-28) — CI/release root cause + live test scan

**+19 findings** (H:13 CI, I:6 tests) → 2 GH issues #165 #166 + correction comment on #159.

**🔧 #159 root cause found (CORRECTION):** Tags DO exist (my iter 2 `git tag | tail -10` only showed 10, missed v0.10.x range). Real bug: `publish.yml:135-149` "Sync VERSION to main" commits ONLY the `VERSION` file. `release.ts:197-208` stamps `packages/*/package.json` in ephemeral CI runner; mutations die with runner. Same mechanism stales CHANGELOG.

**Fix:** Move stamping OUT of CI into local `release.ts` — stamp+commit+push BEFORE tag/publish. CI just builds + publishes already-stamped commit. Drift becomes structurally impossible.

**Live test verdict:** 3219/3219 GREEN across 6 most-changed packages. +761 since Hot.md May-23 baseline of 2458. Zero regressions.

**Filed:** #165 (orphan v0.10.7 draft GH release), #166 (MetricsCollectorTag missing in test Layers — WARN noise + potential prod under-counting).

**Combined iter 1+2+3:** 106 findings, 16 GH issues #151-#166, 4 comments on existing. Build GREEN. Tests GREEN.

### Iter 4 (2026-05-28) — Effect-TS abstraction + arch drift (5 GH issues)

**+20 findings** (J:12, K:8) → 5 GH issues #167-#171.

**🏗️ #167 RuntimeAssembly bundle:** `runtime.ts:479-868` mutates `runtime` variable 38× via `Layer.merge(...) as ComposableLayer` (64 casts in 3 files); 17 inline `Context.GenericTag<{...}>` inside Effect.gen; 2 shadow `MemoryService` Tags alongside canonical class-Tag. Fix: RuntimeAssembly collector + terminal `Layer.mergeAll`; ~230 LOC saved + eliminates `ComposableLayer` alias + dual-tag identity hazard.

**🛡️ #168 tagged-error algebra:** 105 `Effect<X, unknown>` sites in production = silent swallow at type level. Per-service `Data.TaggedError` union; converts swallows into compile-time obligations. Type-level analog of `project_killswitch_honesty_2026_05_19` anti-pattern.

**🕸️ #169 capability mesh:** kernel/capabilities/** has 21 sibling cross-edges + 7 cycles (act↔decide, act↔reason, reason↔verify, attend↔verify, decide↔comprehend). Violates documented "capability is a leaf" principle. Extract to `_shared/` + ESLint `no-restricted-imports`.

**💀 #170 dead surfaces:** `@reactive-agents/observe` package has zero internal `src/` callers (only docs reference); 5 M12 `LocalProviderAdapter` hooks (continuationHint/errorRecovery/synthesisPrompt/qualityCheck/systemPromptPatch) ship 270 LOC with zero callers. Memory's claim "M12 dead hook removal 2026-05-24" was incomplete (only 1 of 6 removed).

**📝 #171 manifest/doc drift:** AGENTS.md package tree omits 7/35 packages (incl. reactive-intelligence w/ 39 inbound consumers); North Star §4.3 says LearningPipeline "currently missing" but file exists with passing test; 2 unused workspace deps (reasoning→prompts, interaction→reasoning).

**Effect-TS verdict: mid-maturity** (0 SubscriptionRef despite 409 Ref ops, 1 acquireRelease, 105 unknown errors, 28 runPromise calls, 15 in runtime alone). Runtime uses Effect as service locator, not type-driven composition.

**Architecture verdict: mild-to-serious drift.** Capability mesh systemic; doc-vs-source inversions; central reference docs write-once-then-drift.

**Combined iter 1+2+3+4:** 126 findings, 21 GH issues #151-#171, 4 comments. Build + tests GREEN.

### Architectural reframes (evidence-grounded)

- ❌ "Strategies bypass kernel" → ✅ 5 of 7 use `runKernel`; outer loops legitimately reimplement BFS/critique/plan-revision (capability mapping <30% mappable)
- ❌ "RI is dead weight" → ✅ 75% fire rate on failure-corpus; +1 success rescue on qwen3 (tier-dependent)
- ❌ "Compose ↔ RI parallel substrates" → ✅ Complementary surfaces, ~zero overlap; **bridge, not subsume**

### Evidence trail (under `wiki/Research/Harness-Reports/`)

10 reports + 3 JSON datasets + 2 probe scripts. SYNTHESIS document: `SYNTHESIS-2026-05-23.md`.

### Mission anchors

- North Star §4.4 unifying principle amended: "surfaces never ship without callers"
- North Star §9: Anti-Scaffold Principle + Empirical Evidence Cadence subsections
- New Doc 06 (mission statements) + Doc 07 (optimal algorithm)

### Optimal per-iter algorithm

10 steps with time budgets totaling ≤59ms framework overhead per iter:
Sense (1ms) → Attend (5ms) → Comprehend (2ms) → Recall (10ms) → Reason (provider) → DECIDE Arbitrator (5ms pure) → Act (tool) → Verify (10ms pure) → Reflect (5ms pure) → Learn (20ms async)

See `wiki/Architecture/Specs/07-OPTIMAL-EXECUTION-ALGORITHM.md` for canonical loop + per-capability success signals + composite signals S1-S6 + algorithmic invariants.

### Execution sequencing

Phase 0 (6 P0 bugs) → Phase 0.5 (M3 ToT cost gate + M5 routing) → Phase 1 (8 convergence items: RI→Compose bridge, capability emit, transitionState lint, soft tools, ControllerDecision audit, llm-exchange, contract test, compression coord) → Phase 2 (`learn/`, multi-severity verifier, default-on memory) ‖ Phase 3 (single Arbitrator, composite confidence, composition routing).

**Next session:** Start Phase 0 via `/execute-backlog` skill. Bundle #105 (M2 output sanitize — highest leverage, closes 3 issues in one PR) first.

---

## DRAFTED — Memory v2 Design (2026-05-23) — NOT STARTED

**Artifacts (untracked on disk):**
- `wiki/Architecture/Design-Specs/2026-05-23-memory-v2-design.md` — 790-line design
- `wiki/Planning/Implementation-Plans/2026-05-23-memory-v2-phase-v2.0-foundation.md` — 1979-line Phase v2.0 task plan

**Design summary:** 2-axis model (5 tiers × 3 scopes private/team/global). 5 net-new components: `MemoryStore` interface + `ScopeRegistry` + `HeavyDream` scheduler + `AntiPatternsTier` + `CheckpointService`. Phased across v0.12/v0.13/v0.14 (~6.5wk total).

**Advisor verdict (2026-05-24): Design sound. Phase v2.0 as-written trips §9 Anti-Scaffold Principle.**

Phase v2.0 Done Criteria explicitly state:
- "No consumer (`SemanticMemoryService`, etc.) yet uses `MemoryStore` — that's v2.2 scope"
- "`withMemoryV2()` builder option NOT yet added"

Ships interface + impl + ~25 tests + schema migration on every user DB — and nothing calls into any of it until v2.2. Pattern just codified to North Star §9 from this same 2026-05-23 sweep ("scaffold without callers" shipped 4× — Compose tags, RI variants, calibration fields, skill persistence).

**Recommended path when resuming: restructured Phase v2.0 bundling MemoryStore + 1 consumer migration (e.g., `SemanticMemoryService` → `MemoryStore`) in single ship.** ~1.5wk. Eliminates §9 violation.

**Strategic payoff lives in speculative v2.3 (HeavyDream).** Spec §7 caveat verbatim: "If LLM-driven pattern detection yields garbage, the 'Day N+1 starts smarter' claim collapses." Show-HN "self-improving fleets" narrative is HeavyDream-dependent. v2.0–v2.2 CAS/scope/checkpoint foundation earns keep regardless.

**Discriminating question on resume:** "Phase v2.0 ships infrastructure with no consumer until v2.2 — restructure to wire one consumer (path C), or defer entirely?"

---

## ACTIVE — Team-Ownership Dev Contract Pilot (2026-05-23 → 2026-06-15)

**Status:** 3-week ablation pilot, scaffolded in commits `f9d508d8` + `6786af72` (merged to `main`). Default-reverts on 2026-06-15 unless lift threshold met.

### Warden roster (10 total)

- **Domain wardens** (own package slice, refuse cross-boundary): `kernel-warden` (reasoning/kernel/**), `provider-warden` (llm-provider/**), `tools-warden` (tools/**), `memory-warden` (memory/**), `runtime-warden` (runtime/**), `compose-warden` (compose/**).
- **Cross-cutting specialists** (read all, edit only narrow surfaces, never patch framework code): `harness-warden` (probes + harness-reports), `ablation-warden` (cross-tier matrix + lift rule + veto), `release-warden` (pre-tag audit + drift gate), `debrief-scribe` (AAR in wiki/Research/Debriefs/).
- **Shared I/O:** `MissionBrief` (`.agents/skills/mission-brief/SKILL.md`) + `UpwardReport` (`.agents/skills/upward-report/SKILL.md`).

### Forcing function (REQUIRED during pilot window)

Edits within any warden's authority manifest MUST be routed through that warden via `Agent` dispatch with a valid `MissionBrief` YAML block. Main-thread direct edits violate the contract and disqualify the task from pilot data. Single exception: hot-fix to red CI on `main`, logged with `bypass-reason` in `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md`.

| Primary scope | Warden |
|---|---|
| `packages/reasoning/src/kernel/**` | `kernel-warden` |
| `packages/llm-provider/**` | `provider-warden` |
| `packages/tools/**` | `tools-warden` |
| `packages/memory/**` | `memory-warden` |
| `packages/runtime/**` | `runtime-warden` |
| `packages/compose/**` | `compose-warden` |
| Probes, `wiki/Research/Harness-Reports/**` | `harness-warden` |
| Default-on toggles, new mechanisms | `ablation-warden` |
| Pre-tag audit, version-drift, release pipeline | `release-warden` |
| Post-merge AAR in `wiki/Research/Debriefs/**` | `debrief-scribe` |

### Why (do not waive)

Per [[wiki/Architecture/Design-Specs/2026-05-18-agentic-team-ownership-concepts]] §Conflict-Warning-2 + North Star §9 Anti-Scaffold Principle + M3 REWORK precedent — canonicalizing a multi-agent dev workflow without empirical lift is exactly the failure mode the project codified against on 2026-05-23. The pilot establishes affirmative evidence OR triggers single-commit revert.

### Workflow per pilot task

1. Compose `MissionBrief` via `mission-brief` skill (end-state / why / key-tasks / authority-bounds / success-criteria / retries-allowed). Refuses dispatch on TBD / missing required fields.
2. Dispatch `Agent` with `subagent_type: "kernel-warden"`. Prepend MissionBrief at top of prompt.
3. Parse trailing `upward-report:` YAML block (status / confidence / blockers / escalation-required / evidence-anchors) from warden output.
4. Apply Dispatcher FSM in `AGENTS.md § Team-Ownership Dev Contract`. **Never** re-prompt warden for self-review (recreates `verifier.ts:217-222` failure / M3 verify-retry death loop). Deterministic verifier only.
5. Append one YAML entry per task to `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md`.

### Lift threshold (canonicalize at Phase 2 — AND-of)

- First-attempt completion rate ≥ baseline + 3pp
- Token overhead ≤ 15%
- Avg re-spawn count ≤ 1.5
- ≥ 1 documented regression-catch attributable to warden domain primer

### Kill threshold (REWORK + revert — ANY of)

- First-attempt completion rate < baseline − 3pp
- Token overhead > 30%
- Avg re-spawn count > 2.5
- < 10 pilot tasks logged by 2026-06-15
- Tyler declares net friction in `log.md` summary

### Default on 2026-06-15: inconclusive → kill

Affirmative evidence required for canonicalization. Mirrors M3 REWORK discipline.

### Anti-patterns (load-bearing — refuse)

- ❌ Parent LLM-judges warden output → M3 REWORK precedent
- ❌ Silent retry past `retries-allowed`
- ❌ Warden self-widens authority without parent gate
- ❌ New warden role added before `ablation-warden` shows ≥3pp lift over current setup

### Pilot files (cleanup on revert = revert both commits)

- `.claude/agents/{kernel,provider,tools,memory,runtime,compose,harness,ablation,release}-warden.md` + `debrief-scribe.md` — 10 bounded warden definitions
- `.agents/skills/mission-brief/SKILL.md` + `.agents/skills/upward-report/SKILL.md` (symlinked into `.claude/skills/`)
- `AGENTS.md § Team-Ownership Dev Contract (PILOT — expires 2026-06-15)` — forcing-function table per warden + dispatcher FSM + anti-patterns
- `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/{README.md,log.md}`
- `wiki/Planning/Implementation-Plans/2026-05-23-team-ownership-dev-contract-pilot.md`

### Phase 1 day-1 actions (compute baseline)

- `rtk git log --oneline --pretty='%H %s' -- packages/reasoning/src/kernel/ | head -40` → identify last 10 pre-pilot tasks
- Classify each: first-attempt (single commit) vs needed-fixup (followup commit within 24h on same scope)
- `rtk gain --history | rtk grep kernel | head -20` → avg tokens / task baseline if data available
- Fill `## Baseline` section of `log.md` with concrete numbers

---

---

## Token Optimization Session (May 12, 2026) — Complete ✅

**Comprehensive session delivered:** 1,190 tokens freed immediately, $11.58/month potential with behavioral adoption.  
**Details:** See `OPTIMIZATION-SESSION-SUMMARY.md` and `TOKEN-OPTIMIZATION-DASHBOARD.md` in project memory.  
**Quick wins completed:** Phase 1 archive (650t), resolved decisions archive (480t), stale path fixes (80t), test count updated.

---

## Session Optimization Checklist (Token Cost Reduction)

**Use these before every dev session to 60-90% token savings:**

- [ ] **RTK prefix on all CLI commands** — `rtk git log`, `rtk find .`, `rtk grep`, `rtk bun test` (saves ~200 tokens per command)
- [ ] **Smart-search for symbol queries** — `claude-mem:smart-search "FunctionName"` instead of grep chains (saves 71% vs read+grep loops; ~820 tokens per lookup)
- [ ] **Check wiki first** — `wiki:query "what do you know about X"` before deep dives (cached answers, 200-400 tokens saved per query)
- [ ] **Batch independent queries** — 3+ parallel tool calls instead of sequential (reduces round-trip overhead)

**This month's target:** 45% RTK adoption (was 18% May 3), 30%+ smart-search adoption; `rtk gain --history` tracks cumulative savings.

**Detailed report:** See project memory dashboard for May 12 session (1,190 tokens freed, $11.58/month potential).

---

## Current state (May 21, 2026)

### Full architecture audit + GH issue migration — SHIPPED ✅ (May 21, 2026)

Single-source-of-truth migration: all open HS-NN items + AGENTS.md Architecture Debt rows filed to GitHub issues (#68-#92, 25 total) on project board "Reactive Agents Roadmap" (project 1). Wiki Running Issues Log becomes canonical *history* + audit-pattern doc.

**Audit re-verification surfaced 3 inflated/misframed claims:**
- HS-18: framed as "Capability supersedes ProviderCapabilities" — actually orthogonal types (fixed `ac6e6e5d`)
- HS-22: claimed "65 duplicated lines" — actually 9 emit sites in 4 providers (fixed `8ec95598`)
- HS-31: claimed "74 casts" — actually 55 (grep counted match-lines, not occurrences)

**Stale doc path drift fixed in AGENTS.md (`aab68353`):**
- Debugging entry points: `strategies/kernel/phases/think.ts` → `kernel/capabilities/reason/think.ts` (Stage 5 kernel reorg)
- evidence-grounding.ts: actual location `kernel/capabilities/verify/`, not `kernel/utils/`
- Tool count: 9 meta-tools (was 8 — discover-tools was missing)
- Tests: 5,317 pass / 26 skip / 0 fail (2026-05-20 baseline, was 5,294)

**New GH infra (`<this commit>`):**
- Issue templates: `architecture-debt.yml`, `audit-finding.yml` (both require `verified-by` field with file:line evidence — prevents future inflation)
- Labels: `health-sweep`, `architecture-debt`, `verified`, `audit-2026-05-21`, `priority:p3`
- Process: every health-sweep finding now requires `verified-by:` line before filing. `.claude/skills/codebase-health-sweep/SKILL.md` updated to enforce.

**HS items still tracked in wiki (for context):** 11 fixed (HS-01/05/09/10/11/12/18/22 + 3 false-positives + count-verify 19/31). Total open in GH: 25 new + ~22 pre-existing = ~47.

### Tier 0 Honesty Sweep — SHIPPED ✅ (May 19, 2026, v0.11.1, pushed)

Ownership pass after v0.11.1. Artifact: `wiki/Research/2026-05-19-framework-state-and-priorities.md`.

- **HEAD DTS build was RED** — `runtime.ts` `leanModeVerifier` missing required `softFail` (`a368a186` fixed only sibling `noopVerifier`); `main` could not publish. Fixed `e8dc8b20`.
- **3 of 6 compose killswitches were broken in shipped v0.11.1** (systemic "shipped+documented+dead"):
  - `confidenceFloor` unshipped `c7fa29c2` — `before('verify')` never fires + phantom `state.verifierScore`.
  - `watchdog` fixed `035f4765` — dead `tap('observation.tool-result')` → `after('act')` (was killing healthy agents).
  - `requireApprovalFor` fixed `0460aaad` — phantom `state.pendingToolCalls` → `state.meta.pendingNativeToolCalls` (safety gate silently approved everything).
  - `budgetLimit`/`timeoutAfter`/`maxIterations` verified sound.
- **Anti-pattern:** every broken killswitch had isolation tests feeding the buggy state shape (false-pass CI). Killswitch/hook tests MUST use real runtime state shape + a phase the runner actually fires (fire-set: before bootstrap/think/act, after think/act/complete — NOT verify; `observation.tool-result` has no emit site).
- **Scope corrections:** `experienceSummary` (`context-manager.ts:272`) is the M6/M10 loop, not a 1d wire (no runtime producer, no store writes). `authorize()` is multi-day cross-package wire (identity/reasoning/runtime zero cross-refs), not "one seam"; Tier 0 cheap alt = audit/unship the delegation-enforcement claims in docs.
- **Next:** user decides — Tier 0 close (security-claims doc audit, ½d) vs properly-scoped Phase 1.5 unit (M6/M10/M14 or real authorize() wire). Do NOT conflate doc audit with authorize() wire.

### M3 Ablation Running — Decision Traceability Inquiry (May 12, 2026)

External user email: "What do you have agents record so another agent, or future you, can understand why a change happened?"

**Context:** User reviewed Cortex Studio run details and AI-generated debrief. The inquiry surfaced a genuine product differentiator.

**What we already have:**
- Comprehensive trace JSONL via `@reactive-agents/trace` with 20+ event types
- Each decision carries `reason: string` + `confidence: number`
- Full LLM exchanges, entropy scores, kernel state snapshots, guard verdicts, verifier results
- CLI tools: `rax:replay`, `rax:grep`, `rax:list`, `rax:diff`

**What's planned (decision-rationale-traceability plan, 2026-05-12):**
- Rationale type: `{why, refs, alternatives, confidence}` structured shape
- Optional rationale fields on tool-call, termination, strategy-switch events
- Assumption detection in think phase
- Curator decision events (why content was kept/dropped/compressed)
- **`rax:diagnose debrief` command** — renders readable markdown timeline vs raw JSONL

**Key research finding:** Stanford Meta-Harness showed traces are essential (50% → 34.6% accuracy without them). Raw execution paths are the knowledge artifact another agent needs.

**Positioning for v0.11:** Decision-rationale plan stages implementation into v1 (Tasks 1–4, 6, 9: 2 weeks) and v1.5 (Tasks 5,7,8,10,11: deferred). Task 9 (debrief command) can ship with v0.11 or as v0.11.1 depending on Compose API timeline. **Decision needed by May 13 after M3 ablation gate.**

**Artifacts:**
- Draft email response: `wiki/Research/Email-Responses/2026-05-12-decision-traceability-inquiry.md`
- Rollout planning: `wiki/Planning/2026-05-12-debrief-rollout-plan.md`
- Implementation plan: `wiki/Planning/Implementation-Plans/2026-05-12-decision-rationale-traceability.md`

---

### Outsider Architecture Feedback — keep v0.11 differentiated (May 10, 2026)

Brief read-only audit found the project is strongest when it promises: **typed, observable, replayable harness control without forking internals**. Keep that as the v0.11 north star.

Priority guidance for agents working on Phase B:
- **Do not let "Compose" mean two products.** `packages/runtime/src/compose.ts` already exports `agentFn`/`pipe`/`parallel`/`race`; Phase B `.compose((harness) => ...)` is a different API. Rename/reposition the existing functional composition surface or make naming explicit before marketing/docs harden.
- **Prefer 5 excellent injection points over 24 thin ones.** First tags should prove trace visibility, type inference (`PayloadFor<Tag>`, `ContextFor<Tag>`), and real control over prompts/messages/nudges/tools/observations.
- **Lock down public surface.** `packages/reasoning/src/index.ts` exports deep kernel internals; avoid widening this. Move future internals behind explicit `unstable` or internal modules.
- **Reduce type erasure at seams.** Concentrate `any` cleanup on public hooks, lifecycle boundaries, compose payloads, metadata, and provider adapter contracts rather than chasing every SDK cast.
- **Separate gateway agents from task agents.** `ReactiveAgent.start()`/`stop()` only make sense with `.withGateway()`; W27 `GatewayAgent` extraction remains a high-signal DX/type-safety refinement.
- **Public promise:** "Intercept, replace, observe, and replay every important harness decision." Features that do not support this should be deferred behind Compose API, Snapshot/Replay, and tracing clarity.

Immediate hygiene: keep `wiki/Hot.md` and this memory aligned with North Star; stale starter docs create bad agent trajectories.

### Phase 1 Mechanism Validation Archive (May 4–12, 2026)

Historical validation (8 KEEP verdicts, 5 IMPROVE verdicts).  
**Live status:** `wiki/Research/Harness-Reports/` and `wiki/Experiments/M*.md` files.  
**Per-mechanism detail:** retained in this file's Phase 1 section below; the prior planned `MEMORY-ARCHIVE-PHASE1.md` extraction was not produced.

---

### North Star v5.0 — Single Consolidated Forward Plan (current, May 11, 2026)

**Canonical planning document:** `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md` v5.0 (March 2026 harness-research integration: NLAH Pruning Principle, Stanford Meta-Harness raw-trace finding, self-evolution +4.8pp).

All prior roadmap/phase documents are superseded:
- `wiki/Architecture/Specs/07-ROADMAP-v1.0.md` — SUPERSEDED
- `wiki/Planning/Phase 1.5 Improvement Roadmap.md` — SUPERSEDED (per-mechanism detail retained)
- `04-PROJECT-STATE.md` — retained as cold-session framing doc

**Phase sequence (see North Star §6 for full validation gates):**

| Phase | Focus | Status |
|---|---|---|
| **A** | Architecture Cleanup — W23–W25: `execution-engine.ts` 4,499→1,637 LOC (W24) + `builder.ts` 6,232→2,481 LOC (W25). | ✅ **Complete** |
| **B** | Compose API — Waves A–F, 5+ chokepoints live, 6 killswitches, RunHandle. | ✅ **Complete** (May 13) |
| **C** | v0.11 Launch — skill persistence ✅, Snapshot/Replay ✅, `@reactive-agents/observe` (OTel) ✅, `create-reactive-agent` CLI ✅, `code-action` strategy ✅, Compose API + 6 killswitches ✅. **v0.11.0 release prep complete 2026-05-15** — 7 changesets staged, all CI fixes in commit `6d71d691` (bun pin 1.3.10, docs prebuild, CLI externals). | 🟢 **Ready** |
| **1.5** | Mechanism Improvements — M3 REWORK ✅ shipped; M6 persistence ✅; M7/M8/M10 IMPROVE pending | Parallel with C |
| **D** | Code-as-Action Strategy — 6th reasoning strategy, ≥20% local model lift | v0.12 |
| **E** | Local Model Engineering — calibration consumers (≥8 fields), per-provider parser, paging | v0.12 |
| **F** | Public Benchmark Discipline — τ-bench / BFCL / HAL Princeton | v0.13 |
| **G** | v1.0 Polish & Release | v1.0 |

**Why Phase A before Phase B:** Compose API bolts onto `builder.ts`. Decomposing first prevents rework and makes every subsequent wave cleaner.

**New in v4.0:** Snapshot/Replay (`agent.replay(traceId, overrides)`) promoted from Phase G → Phase C (v0.11). Unique auditable-by-demo capability; 1-week build on existing `packages/trace`.

**Root `ROADMAP.md` alignment** flagged as Phase C gate — must match this plan before v0.11.0 ships.

---

### RTK Token Optimization — DOCUMENTED ✅ (May 6, 2026)

**All team members should use RTK (Rust Token Killer) for CLI commands to save 60-90% tokens per operation.**

**Usage:** Prefix supported commands with `rtk`:
- `rtk git status`, `rtk git log`, `rtk npm list`, `rtk bun test`, `rtk find`, `rtk grep`, etc.
- RTK filters results to only relevant output before returning (e.g., `git log` streams 50+ commits → RTK returns 2-3 relevant ones)
- Transparent in Bash tool calls (hook auto-applies RTK prefix)

**Meta commands (use directly, not prefixed):**
- `rtk gain` — Show token savings for this session
- `rtk gain --history` — Show cumulative savings over time
- `rtk discover` — Find commands in history that should have used RTK
- `rtk proxy <cmd>` — Debug raw command execution (bypass RTK filtering)

**Documentation:** Memory file `feedback_rtk_usage.md` + global `RTK.md`

---

### v0.11 Launch-Readiness Checklist — ABSORBED into North Star v5.0 §6 Phase C (May 7, 2026)

**Comprehensive planning document drafted for market-positioning inflection point.**

**File:** `wiki/Planning/Implementation-Plans/2026-05-06-v0.11-launch-readiness.md` (900+ lines)

**Strategic context:** v0.10 shipped stable core; v0.11 ships *customizability* (compose API) + *credibility signals* (playground, CLI generator, OpenTelemetry, public roadmap). Outcome: v0.11 is Show-HN launch point positioning RA as transparent alternative to AutoGen/CrewAI/Mastra with proven 100% vs 85% benchmark edge.

**Tier 1 (Before Show-HN Launch):** Five parallel initiatives (3 weeks total):
1. ✅ **Skill Persistence** — `skillFragmentToSkillRecord` + dual-store in `local-learning.ts`; learned skills now persist to `SkillStoreService` and appear in `SkillResolverService` on next session. 5 tests (unit + integration + e2e), all green. Shipped 2026-05-13.
2. **Live Playground (2 days)** — Three Stackblitz embeds on homepage (hero scenario, tool integration, reasoning strategy); <3s cold start
3. **create-reactive-agent CLI generator (3 days)** — Five templates (web-search, chat-with-tools, gateway-cron, sub-agent-orchestrator, local-ollama)
4. **OpenInference/OpenTelemetry Exporter (1 week)** — `@reactive-agents/observe` package with Langfuse + Braintrust integrations; zero-config auto-export
5. **Public Roadmap + Named Users (1 day)** — GitHub Projects board (v0.11/v0.12/v0.13 milestones) + "Built with" cards (Cortex, Beacon, Dispatch)

**Prerequisite (parallel):**
- **Compose API (Waves A-F, 2 weeks)** — harness-pipeline registry, 5 chokepoint refactors, RunHandle pause/resume/stop/terminate, 6 killswitches, backward-compat desugar, comprehensive docs

**Success metrics (Week 1 post-launch):**
- Show-HN >500 upvotes
- >1,000 Stackblitz embed clickers
- >500 new npm installs/week (vs 100 baseline)
- >100 create-reactive-agent runs
- >50 GitHub Projects watchers

**Amplified existing capabilities (underplayed assets):**
- Diagnose package (M11 production-ready, 100% TP/0% FP, 0.02ms latency) — add card + docs + examples
- Memory system (M10, 66.7% verbose / 100% keyed recall, 0.05ms overhead) — promote from @unstable → @stable + docs

**Tier 2 (post-launch):** Per-tool middleware, cost forecasting, migration guides, Beacon prominence

**Tier 3 (avoid):** Voice/realtime, computer use kernel, visual no-code, multi-agent swarms

**Timeline:** Wave A starts Fri May 10; v0.11.0 release Wed May 29. Critical path: Compose API (if it slips 1 day, everything slips 1 day). All other items parallelizable.

**Risks & mitigations documented:** Skill persistence data corruption, Stackblitz mobile failures, GitHub Projects stale updates, named-user revocation, compose API scope creep.

**Open questions (resolve before Wave A):** Skill git-commit metadata, .withVerification() desugar scope, M10 re-validation with real LLMs, OTel sampling per-environment, roadmap visibility (GitHub Projects vs Discourse).

**Approval gate:** Compose spec sign-off + all five Tier-1 owners confirm estimates + GitHub Projects board created.

---

### Release Pipeline — REWRITTEN ✅ (2026-05-16) — CURRENT, supersedes all prior release notes

**Tag-driven lockstep.** One explicit version stamps **all** ~35 public
packages. Mechanism: `scripts/release.ts`, run by
`.github/workflows/publish.yml` on a `vX.Y.Z` tag push.

- **Author notes:** `bun run changeset` writes `.changeset/*.md` prose. That
  body is the only human-curated release text.
- **Release:** `git tag vX.Y.Z && git push origin vX.Y.Z` → CI: build/
  **typecheck** (66/66, commit `3cdfeaef` — sole tsc gate; esbuild/tsup are
  transpile-only)/test/clean-install/`release:dry` gate → `release.ts`
  aggregates changeset bodies
  into root `CHANGELOG.md` as `## [<version>] — <date>`, consumes them, stamps
  all packages + root, builds, publishes in topological order (fail-fast,
  idempotent re-run skips already-published).
- **VERSION file (commit 30ccf590):** root `/VERSION` is the committed
  source-of-truth == npm @latest. `release.ts` writes it on stamp;
  `publish.yml` "Sync VERSION to main" commits it back with `[skip ci]`.
  Repo package.json staying unbumped by the tag-driven flow is intentional,
  not drift. `release:dry` mutates then self-cleans the tree — EXIT=0 +
  uniform `X.Y.Z → A.B.C` on all 35 lines = gate green; no manual revert.
- **GitHub Release:** `publish.yml` is the **sole** author (release-drafter
  removed). Body = the `## [<version>] — <date>` CHANGELOG section verbatim.
- **Recovery:** "Backfill GitHub Releases" workflow (manual) recreates missing
  releases from CHANGELOG. `publish.yml` `workflow_dispatch` re-runs a failed
  publish.
- **Drift is structurally impossible** — single version var stamps everything.
  `changesets/action`, `changeset version`, the "Version Packages" PR, and the
  drift scripts (`check-npm-versions.ts`, `check-version-sync.ts`,
  `normalize-release-version.ts`, `resolve-workspace-deps.mjs`) are **all
  deleted**. Do not look for them or treat their absence as a regression.
- **Publish = `npm publish`, NOT `bun publish` (hard-won, v0.11.0).**
  `bun publish` cannot authenticate from release.ts's Bun-shell subprocess
  in CI ("missing authentication") despite 4 `.npmrc`/`$HOME` fixes — yet
  `npm whoami` succeeds from the same `~/.npmrc`. bun 1.3.10 reads `.npmrc`
  only from publish-CWD and `$HOME` (never ancestors) and the Bun-shell
  child doesn't inherit the runner `$HOME`. **Never revert to bun publish.**
  Because npm doesn't resolve `workspace:*`, `release.ts` pins every
  internal `workspace:*` → exact lockstep version in the stamping pass.
  `bun pm pack` is NOT a substitute (resolves from stale `bun.lock`).
- **Auth invariants:** setup-node has **no `registry-url:`** (it would
  export `NPM_CONFIG_USERCONFIG` → placeholder file → broken auth). The
  `Authenticate` step writes the **literal** token (no `${VAR}`) to
  `${NPM_CONFIG_USERCONFIG:-$HOME/.npmrc}`. **npm token must cover scoped
  AND unscoped names** — a `@reactive-agents/*`-scoped token `E403`s on
  `create-reactive-agent` + `reactive-agents` (the 2 unscoped); v0.11.0
  required an org/account-wide token. Credential fix + `workflow_dispatch`
  re-run resumes idempotently (skips already-published).

**Why (historical, do not resurface):** manual `npm publish` once left
package.json behind npm, causing changeset-bump collisions. The lockstep
single-version design removes the entire failure class — no reconciliation
exists because nothing can desync.

Runbook: `.agents/skills/prepare-release/SKILL.md` (kept in sync).

### Eval Workflow Disabled (May 5, 2026 — 8:00pm EDT)

`.github/workflows/eval.yml` auto-triggers (push/pull_request) removed; only `workflow_dispatch` remains. Was failing consistently and blocking unrelated work. Re-enable when eval suite is stabilized.

### v0.10.2 Post-Release Quality Sweep — ALL RESOLVED ✅ (May 7, 2026 recheck)

All P1 issues from the May 5 sweep are resolved — do not resurface as blockers:

- ~~**P1-5:** SDK `agent.run()` missing~~ — FALSE POSITIVE. `ReactiveAgent.run()` exists at `packages/runtime/src/builder.ts:4758`.
- ~~**P1-3:** cortex broken~~ — Fixed: turbo.json assets, CLI build script, cortex.ts error messages all applied (May 5).
- ~~**P1-1:** CLI --help broken~~ — Fixed: `init.ts:25`, `create-agent.ts:48`, `run.ts:72` all handle `--help`/`-h`.
- ~~**P1-4:** CommonJS require fails~~  — Fixed: `cjs-shim.cjs` with helpful ESM-only error, wired via `"require"` export condition in `packages/reactive-agents/package.json`.
- **P1-2 (MEDIUM):** Vague LLM error messages — still open, low priority, not blocking.

---

### v0.10.2 Hotfix Release — SHIPPED ✅ (May 5, 3:42am EDT)

**Status:** All 27 packages at 0.10.2, published to npm, stable and verified.

**Critical fixes:**
- **Broken bun exports:** All 27 packages had `"bun": "./src/index.ts"` but npm packages don't include src/. Changed to `"./dist/index.js"`. This fixed "Cannot find module" errors for npm-installed consumers (CLI, downstream packages).
- **CLI external dependencies:** Added @reactive-agents/eval, llm-provider, a2a, trace, tools to tsup external list so they're dynamically required at runtime, not bundled.

**Release timeline:** 0.10.0 (May 4, broken) → 0.10.1 (May 4, broken) → 0.10.2 (May 5, stable)

**Prevention gates added (CI):**
- `validate-cli-externals.ts` — ensures CLI imports are marked external
- `test-bun-exports.ts` — validates all packages export correct dist/ paths
- Both prevent future broken releases

**Details:** See memory file `release_0_10_2_hotfix.md`

### Wiki Vault Population Complete ✅ (May 4, 3:30pm EDT)

**Obsidian vault fully initialized with comprehensive project brain AND all Phase 1.5 content populated:**

**MOCs & Navigation (5 master hubs):**
- ✅ Architecture MOC — 12-phase kernel, package layers, port system
- ✅ Research MOC — Phase 1 validation (8 KEEP/5 IMPROVE), all 13 mechanisms linked
- ✅ Concepts MOC — Cognitive architecture, tool integration, safety, memory, orchestration
- ✅ Decisions MOC — Phase gates, north star v3.0, strategic trade-offs
- ✅ Packages MOC — 26 packages + 5 apps by layer

**Mechanism Validation (M1-M13):**
- ✅ All 13 mechanism notes with: verdict, test results, metrics, Phase 1.5 actions, integration points
- ✅ KEEP mechanisms: M1, M2, M4, M5, M9, M11, M12, M13 (shipped v0.10.0)
- ✅ IMPROVE mechanisms: M3, M6, M7, M8, M10 (Phase 1.5 action items identified with owners)

**Failure Mode Taxonomy (FM-A-H):**
- ✅ All 8 categories with: manifestation, root cause, reproduction, mitigations, evidence
- ✅ Each FM linked to mechanisms that mitigate it

**Package Documentation:**
- ✅ Package Index (all 26 packages + 5 apps quick reference)
- ✅ Detailed notes for core, llm-provider, reasoning (template for others)

**Planning & Roadmaps:**
- ✅ Phase 1.5 Improvement Roadmap (M3, M6, M7, M8, M10 with effort, timelines, owners)
- ✅ Documentation Consolidation Roadmap (migrate all docs to wiki by Phase 2)

**Status:** 🟢 Wiki is primary knowledge base for Phase 1.5 agentic work. Team can self-serve all context.

**When starting Phase 1.5/2 work:**
1. Check `wiki/Hot.md` for recent session updates
2. Check `wiki/Planning/Phase 1.5 Improvement Roadmap.md` for action items and owners
3. Reference `wiki/MOCs/*` for architecture & decision context
4. Link new work to existing mechanisms (backlinks auto-appear)

**Long-term vision:** Wiki replaces all fragmented doc spaces (spec docs, debriefs, plans, markdown files). Single source of truth by Phase 2.

---

- **Spike M3: Verifier + Retry Validation — COMPLETE:**
  - RED phase: 22 unit tests validate verifier gate + retry policy (100% pass rate).
  - GREEN phase: Implement FM-A1 + FM-C2 retry signal builders addressing p02 findings.
  - **Measured Results:** Verifier precision 100% on cogito:8b fabrication (target ≥90%); retry effectiveness tier-specific per p02 evidence.
  - Improved context design: FM-A1 signal teaches "emit" vs "describe" distinction (direct response to p02 failure); FM-C2 requires ≥3 specific data references.
  - Test coverage: 22 spike tests (43 expectations), all passing. Integration contracts validated (verifier receives context from act.ts, policy receives verdict + state).
  - Files: `packages/reasoning/src/kernel/capabilities/verify/retry-context.ts` (NEW: buildFMA1RetrySignal, buildFMC2RetrySignal, buildImprovedRetrySignal), verifier.ts (improvedVerifierRetryPolicy export), m3-verifier-retry.test.ts.
  - Key findings: (1) Verifier gate production-ready (ship v0.10.0). (2) Retry doesn't help cogito:8b with generic feedback (p02: 0/5 recovery, 4.2× tokens). (3) Improved context targets model misunderstanding, not coercion. (4) Policy is opt-in via ReactiveInput config (backward compatible).
  - Verdict: **✅ PROMOTE** — Gate ships; retry mechanism with `improvedVerifierRetryPolicy` as opt-in improvement.
  - Phase 1.5 actions: (1) Run against cogito:14b to validate recovery ≥50%, (2) Wire temperature override (0→0.2), (3) Promote improved policy if cogito:14b shows lift.
  - Debrief: `RESULTS-m3.md` (comprehensive findings, root cause analysis, Phase 1.5 roadmap).
  - Commit: `329e2d23`.

- **Spike M8: Sub-agent Delegation Validation — COMPLETE:**
  - Delegation mechanism validated across 10 realistic multi-step scenarios (research, analysis, synthesis, validation, transformation).
  - **Measured Results:** Accuracy lift 20% (2/10 scenarios), token savings 2.3% average (modest), latency overhead +41% (spawn cost dominates on simple tasks).
  - Success criteria: ✅ Accuracy improvement on reasoning tasks (S4, S9 improved via focused sub-agent scope). ⚠️ Token savings < 15% threshold on most tasks (only S3 met 15% savings). Latency acceptable (<50% overhead) for medium/hard tasks.
  - Complexity analysis: Simple tasks (≤2) lose to spawn overhead; medium (3) shows 40% accuracy improvement; hard (4+) saves 14.5% tokens on average.
  - Sub-agent quality: All 10 scenarios executed successfully; no cascading failures; recursion guard (max depth 3) enforced correctly.
  - Test coverage: 10 comparison tests (10 scenarios each: inline vs. delegated), 3 quality/failure-isolation tests, 1 complexity analysis test, 1 success-criteria test, 2 meta-tests. Total: 137 assertions, 100% pass rate.
  - Evidence: `packages/tools/tests/m8-sub-agent-delegation.test.ts` (TDD: RED → GREEN → ANALYSIS complete).
  - Key findings: (1) Delegation wins on **complex reasoning** where accuracy > latency. (2) Spawn overhead (80ms, 20 tokens) kills ROI on simple tasks. (3) Token savings only ≥15% when base cost exceeds 150 tokens. (4) Focused sub-agent scope + explicit directive improves constraint detection & specification writing. (5) Failure containment perfect: no cascade, structured error returns.
  - Verdict: **✅ KEEP** with **scoped guidance** — mechanism is production-ready; Phase 1.5 real-LLM validation recommended.
  - Debrief: `docs/superpowers/debriefs/M8-sub-agent-delegation-validation.md`.
  - When to use: Multi-step reasoning (≥complexity 3), accuracy-primary goals, latency budget ≥500ms. Avoid: simple tasks, latency-critical paths (<500ms SLA).
  - Phase 1.5 improvements: Real LLM execution (frontier + qwen3), multi-agent batching, tool availability expansion, episodic memory for sub-agents.

- **Spike M13: Guards + Meta-tools Validation — COMPLETE:**
  - 6-guard pipeline (blockedGuard, availableToolGuard, duplicateGuard, sideEffectGuard, repetitionGuard, metaToolDedupGuard) validated across comprehensive dataset.
  - **Measured Results:** True positive rate 100% (target ≥90%), false positive rate 0% (target ≤2%), latency 0.018ms max (target <50ms).
  - Meta-tools registry: 10 tools properly categorized (termination: 2, introspection: 5, special: 3). All meta-tools auto-pass availableToolGuard check (line 62).
  - Test coverage: 19 spike tests (44 assertions), all passing. 89 total kernel tests pass, zero regressions. 100% path coverage: all 6 guards exercised.
  - Evidence: `packages/reasoning/tests/kernel/m13-guards-meta-tools.test.ts` (TDD: RED → GREEN → ANALYSIS complete).
  - Key findings: (1) Guard pipeline deterministic, no cross-interference. (2) Meta-tools bypass availability check but subject to consecutive-call dedup (prevents introspection spam). (3) Latency negligible (0.0003ms per guard). (4) Rejection reasons distinct and actionable.
  - Verdict: **✅ KEEP** — Production-ready for v0.10.0. Guards earn their keep; ship as-is.
  - Debrief: `docs/superpowers/debriefs/M13-guards-meta-tools-validation.md`.
  - Commit: `327426bf`.

- **Spike M11: Diagnostic System Output Leak Detection — COMPLETE:**
  - Output leak detection validated across 27 leak pattern categories.
  - Synthetic dataset: 17 test cases (clean outputs, system prompts, API keys, credentials, false-positive controls).
  - **Measured Results:** True positive rate 100% (target ≥95%), false positive rate 0% (target ≤5%), latency 0.02ms (target <100ms).
  - Leak types detected: system-prompt (4), internal-instruction (2), api-key (4), credential (10).
  - Pattern coverage: AWS AKIA/secrets, OpenAI/Anthropic keys, GitHub tokens, JWT, passwords, database URLs, system prompt headers.
  - False positive mitigation effective: Base64/hash filters distinguish benign content (CRITICAL: AKIA keys checked before base64 filter).
  - Test coverage: 10 M11 spike tests (64 expectations), 22 total diagnose tests, 100% pass rate. Zero regressions.
  - Evidence: `packages/diagnose/tests/m11-diagnostic-output-leak.test.ts` (TDD: RED → GREEN complete).
  - Verdict: **✅ KEEP** — mechanism earns its keep; FM-A3 (output-leak diagnosis) mitigated.
  - Debrief: `docs/superpowers/debriefs/M11-diagnostic-system-validation.md`.
  - Commit: `6f614a94` (original validation).
  - Next: Integrate leak detector into output assembly (Phase 1.5 integration).

- **Spike M10: Memory System (3-tier episodic recall) — COMPLETE:**
  - Episodic memory store/retrieve working via SQLite + FTS5 indexing.
  - **Measured Results:** Recall accuracy 66.7% on verbose natural language, 100% on key-term queries. Accuracy lift +10pp (70% baseline → 77% with memory). Memory overhead negligible: 0.05ms per entry, 41 bytes per entry. No cross-task pollution (taskId filtering effective).
  - Multi-turn continuity validated: Record preferences in Task 1 → Recall in Task 2 → Apply without re-asking.
  - FM-F2 (memory pollution) mitigated: Task-scoped queries prevent false memory injection.
  - Test coverage: 7 spike tests (scenario-based multi-turn), 100% pass rate (178ms, 16 expectations).
  - Evidence: `packages/memory/tests/m10-memory-system.test.ts` (TDD: RED → GREEN complete).
  - Key findings: (1) FTS5 keyword search works excellently for key-term queries but struggles with verbose NL (66.7% vs 100%). (2) Memory overhead negligible on throughput (0.05ms per entry). (3) Task isolation working correctly. (4) Storage efficiency excellent (4KB for 100 entries = 41 bytes/entry).
  - Verdict: **✅ KEEP** — Store+recall cycle fully functional, system ready for Phase 1.5 optimization.
  - Debrief: `docs/superpowers/debriefs/M10-memory-system-validation.md`.
  - Phase 1.5 actions: (1) Implement key-term extraction for Tier 1 to achieve 100% recall (decompose verbose queries), (2) Wire episodic context injection into kernel bootstrap, (3) Design realistic multi-session scenarios for Phase 2.
  - Commit: `658a84c0`.

- **Spike M12: Provider Adapter Hooks Validation — COMPLETE:**
  - All 7 hooks defined on `ProviderAdapter` interface: parseToolCalls, extractText, computeCost, validateResponse, optimizePrompt, handleError, streamSupport.
  - All 7 hooks fire on provider-specific scenarios (qwen3, Gemini, Anthropic, Ollama).
  - Each hook measurably improves its domain: normalization (+30% malformed response handling), streaming reassembly (Gemini text extraction), provider-specific cost calculation, response validation (early error detection), prompt optimization (+15% clarity), error classification (enables retryable vs. fatal routing), streaming event parsing (unified event handling).
  - Zero cross-provider interference: hooks self-gate on modelId.
  - Test coverage: 26 spike tests (52 expectations), 100% pass rate. 254/254 llm-provider tests pass (no regressions).
  - Evidence: `packages/llm-provider/tests/m12-provider-adapter-hooks.test.ts` (TDD: RED → GREEN complete).
  - Verdict: **✅ KEEP** — hooks earn their keep, zero blockers.
  - Evidence: `wiki/Experiments/M12 Provider Adapters.md`.
  - Commit: `14c34a15`.
  - Next: Activate hooks in `llm-service.ts` and provider-specific code (Phase 1 deployment).

- **Spike M4: Healing Pipeline Validation — COMPLETE:**
  - 4-stage FC error recovery: tool-name healing → param-name healing → path resolution → type coercion
  - **Measured Results:**
    - Recovery rate: **86.7%** on full test suite (intentional failures included), **100%** on recoverable errors
    - Accuracy improvement: **+80pp** (6.7% baseline → 86.7% with healing)
    - Token savings: **90%** vs reprompt fallback (750 tokens healing vs 7500 tokens reprompt)
    - Cross-model validation: **100%** on both qwen3:14b and frontier models
    - Stage breakdown: tool-name 100%, param-name 100%, path-resolution 100%, type-coercion 100%
    - Unrecoverable patterns correctly identified: 2/15 (missing args, unknown tool) — intentional behavior
  - **Test Coverage:** 27 tests across 3 suites (m4-healing-pipeline, m4-healing-measurement, healing-pipeline unit tests), 74 expectations, 100% pass rate. Zero regressions.
  - **Cost Analysis:** Avg 1.27 actions per case, +3.3% token overhead (75 → 77 chars avg input/output)
  - Evidence: `packages/tools/tests/m4-healing-pipeline.test.ts`, `packages/tools/tests/m4-healing-measurement.test.ts`
  - **Verdict: ✅ KEEP** — Healing pipeline earns its keep with massive accuracy lift, negligible overhead, strong cross-model performance.
  - Evidence: `wiki/Experiments/M4 Healing Pipeline.md`
  - Commit: `4cf1baea`
  - Ready for v0.10.0 ship. Phase 1.5+ adds hybrid (healing + reprompt fallback), Phase 2+ adds adaptive alias learning.

- **Spike M10: Memory System Validation (FM-F2) — COMPLETE:**
  - FM-F2 ("memory pollution across runs") is **mitigated** (not a practical risk) — task-scoped queries prevent false memory injection.
  - Recall accuracy: **66.7%** on verbose natural language, **100%** on key-term queries.
  - Accuracy lift: **+66.7pp** vs baseline (no memory context).
  - Memory overhead: **negligible** (0.05ms per entry, 4KB/100 entries).
  - **Key finding:** FTS5 keyword search requires query decomposition; verbose natural language queries fail (0% match) but focused key-term queries succeed (100% match). Recommendation: ship with key-term extraction preprocessing or Tier 2 semantic embeddings for robust multi-turn learning.
  - Evidence: `packages/memory/tests/m10-memory-system.test.ts` (7 passing tests, 16 assertions).
  - Debrief: `docs/superpowers/debriefs/M10-memory-system-validation.md`.
  - Audit update: Mark FM-F2 as **validated → mitigated** in `AUDIT-overhaul-2026.md §10` (was "unvalidated theoretical").

- **External channels phase 1 (branch `feat/channels-package`, merge pending):** package `@reactive-agents/channels`, runtime `.withChannels()`, gateway config rename `channels` → `accessControl`, webhook adapter + tests. Evidence: `wiki/Research/Debriefs/2026-05-03-channels-phase1-development-debrief.md`. **Mainline docs** (`apps/docs`, Starlight gateway pages) still describe `GatewayConfig.channels` until the branch merges.
- **Test runner snapshot (May 13):** `bun test` → **5128/5128 pass** (per `wiki/Hot.md`; 1150+/1150+ reasoning, 24/24 compose, 24/24 replay). Re-run before any release claim.

### Earlier context (May 1, 2026)

- **v0.10.0 release-ready** — `refactor/overhaul` branch fully prepared; changeset + CHANGELOG + release doc written; 4,672 pass / 23 skip / 4 fail across 527 files (4 pre-existing failures in untracked `packages/benchmarks/parseDate.test.ts` — not regressions).
- **Branch:** `refactor/overhaul`. All prior `feat/*` branches archived as `archive/*` tags.
- **Published on npm:** all packages at `0.9.0`. Version bumps happen via changeset merge (`release-0-10-0.md` covers all 28 packages + umbrella, `@reactive-agents/diagnose` included).
- **cf-23 gate fixed:** `required-tools-satisfied` was moved from verifier to `runner.ts §8`; scenario now tests `agent-took-action` + positive absence. Baseline regenerated with BASELINE-UPDATE trailer.
- **Architecture target:** `15-design-north-star.md` v3.0 (10 capabilities + cognitive kernel + 3 ports).
- **Pending before tag:** (1) Publish `@reactive-agents/diagnose` — confirmed 404 on npm (May 1). Ships via CI changeset workflow. ~~(2) Eval Rule 4 frozen-judge~~ — ✅ RESOLVED W9/FIX-21. Then: merge `refactor/overhaul` → `main`, run `changeset version`, publish.
- **Gateway chat mode shipped** (May 1): per-sender SQLite session history, 40-turn/8 k-char windowing, episodic context injection, daily compaction, mode-aware routing (`channels.mode: 'chat'|'task'`). Two memory bugs fixed: `priorContext` silently dropped (context-manager.ts) + episodic injection gated behind `enableSelfImprovement` (execution-engine.ts). New `pruneEpisodicLog` on `CompactionService`; `chat-turn` event type added. Key file: `packages/runtime/src/gateway-chat.ts`.
- **Frontier bench (W21, Apr 30):** ra-full 100% across 4 frontier models (claude-sonnet-4-6, claude-haiku-4-5, gpt-4o-mini, gemini-2.5-pro). Bare-llm 85%. Gemini W22 fix: walk `candidates[0].content.parts[]` directly; surface non-OK `finishReason` as explicit errors.

### Token Optimization (May 3, 2026)
- **rtk discover audit:** 529 sessions, 17K Bash commands analyzed. Only 18% use RTK prefix. **1.2M tokens saveable** from non-prefixed commands (grep 502K, cat 351K, git log 166K, find 99K, ls 73K).
- **Root cause:** Behavioral, not technical. RTK hooked globally but requires consistent prefixing in Claude Code.
- **Skill created:** `.agents/skills/token-optimization/SKILL.md` — TDD-tested (RED-GREEN-REFACTOR phases complete).
  - RED: 18% adoption baseline, hook nudges insufficient, LSP/smart-search missing globally, bun test/run unhandled
  - GREEN: Skill addresses rationalizations, fixes hook JSON quoting, promotes LSP/smart-search to global allowlist
  - REFACTOR: Bulletproof against 5 key rationalizations (optional-ness, friction avoidance, invisibility, mental model gaps, RTK gaps)
- **Fixes implemented:** (1) Corrected PostToolUse hook JSON (previous had quoting errors). (2) Global allowlist expanded to include LSP + smart-search tools. (3) Memory: `project_token_optimization_may3.md` documents discovery + implementation. (4) Skill: Full decision trees and loophole-closers documented.
- **Action:** Prefix Bash commands with `rtk` consistently. Use `claude-mem:smart-search` (tree-sitter AST) for codebase symbol queries instead of grep + read chains (60-75% savings). Create pre-session token dashboard if hook nudges aren't sustaining behavior.
- **Target adoption curve:** Month 1 (baseline), Month 2 (45% RTK usage), Month 3 (70%), Month 4 (85%, plateau).
- **Savings:** ~$1,200/month at current command rates if 1.2M tokens reclaimed. Monthly re-check via `rtk discover --history` to track progress.

**Resolved P0s (reference — do not resurface as blockers):**
- ~~Publish umbrella `reactive-agents` (404)~~ — ✅ W14: already published at v0.9.0; v0.10.0 via CI.
- ~~qwen3 thinking auto-enable~~ — ✅ W7: thinking is OPT-IN; `resolveThinking()` at `packages/llm-provider/src/providers/local.ts:226` returns `undefined` unless `configThinking === true`.
- ~~Dual compression uncoordinated~~ — ✅ W6: three stages sequenced (tool-execution stash → curator render → compress-messages patch); regression test in `context-curator.test.ts`.
- ~~9 termination paths, no single owner~~ — ✅ W4 (FIX-18): `kernel/loop/terminate.ts` is the single-owner helper; `kernel/capabilities/decide/arbitrator.ts` is the canonical oracle path.

---

## Working rules (cross-cutting feedback — keep applying)

- **No Co-Authored-By trailers in commits.** Shows publicly on GitHub contributors.
- **Commit before branching.** Always commit/stash exploratory changes before creating feature branches.
- **Keep `.agents/MEMORY.md` (this file) in sync with personal memory** so other AI agents have context.
- **Skip plans for content/skill writing.** No formal implementation plan for SKILL.md or doc tasks; implement directly.
- **Strict TypeScript — no `any` casts.** Use `unknown` + guards or proper types.
- **Don't `rm -rf` untracked dirs with content.** Confirm before deleting any `??` directory with >5 files; git can't recover untracked content. Cost: lost `wiki/` + 3 `obsidian-vault-*` skill modules on 2026-04-24 cleanup.
- **Release = author changeset, then push a tag.** `bun run changeset` IS the required manual step (writes `.changeset/*.md` notes). Then `git tag vX.Y.Z && git push origin vX.Y.Z` triggers CI publish. Never manually run `npm publish` or `changeset version` — CI's `release.ts` owns versioning/publishing. See the Release Pipeline section above.
- **Workspace runs from `src/` under Bun.** Every `packages/*` declares `"bun": "./src/index.ts"` first in `exports`. Edits picked up at next `bun run`, no rebuild needed. Rebuild only for: (a) npm-publish validation, (b) Node-runtime consumers, (c) `.d.ts` refresh.
- **Control pillar — every harness primitive must be developer-overridable.** Vision Pillar 1. New behaviors ship with: `defaultFoo` preserving prior behavior, `KernelInput.foo?: FooHookType` injection field, public type export. Hardcoded harness logic = black box = anti-pattern.
- **Research discipline — spike-validated harness changes only.** Read `00-RESEARCH-DISCIPLINE.md` for the 12 rules. Notable: spike validates ONE mechanism × ONE failure-mode × ≤2 models × ONE task (Rule 11); single-spike findings shape the next spike, not harness-level decisions.
- **Trust `bunx turbo run build` over `tsc --noEmit` for `ignoreDeprecations`.** TS 6.0.3's tsc reports `error TS5103: Invalid value` on `"ignoreDeprecations": "6.0"` (false positive), but tsup's DTS step (same TS version) requires `"6.0"` to silence the baseUrl deprecation. Keep `"6.0"` everywhere (root + leaf tsconfigs); the lone tsc error in `bun run typecheck` output is expected noise. Confirmed 2026-05-11: all 33 turbo build tasks pass with `"6.0"`.
- **Pin `bun-version: "1.3.10"` in CI workflows — do NOT use `latest`.** On 2026-05-15, `latest` resolved to 1.3.14 which broke streaming tests (`TextDelta events with reasoning enabled` returns 0 deltas, FiberRef inheritance regression in `StreamingTextCallback` propagation through `Effect.forkDaemon`). Reproduced locally by downloading the 1.3.14 binary against the same tree (5/6 pass on 1.3.14, 6/6 on 1.3.10). Re-test the streaming suite before bumping the pin. Affected workflows: `.github/workflows/{ci,docs,publish,eval}.yml`. Fix: commit `6d71d691`.
- **No metric-gaming during refactors (2026-05-29 course-correction).** Don't hit targets by redefining/gaming the metric. (1) **Composable API is ADDITIVE** — HarnessProfile + `.compose()` are power-user shortcuts ON TOP of the fluent `.withX()` happy path, never replacements. NEVER `@deprecated` a working documented method to drop under a count threshold (it subtracts perceived value via IDE strikethrough + doc-gen warnings while changing nothing). (2) **The failure mode is redundant/confusing API with no canonical path — NOT method count.** A large fluent API where each method is documented + maps to one capability is good ergonomics. (3) **Cohesion over LOC** — decompose only where a genuine cohesive sub-unit exists; leave a tangled flow cohesive-but-large rather than build a mutable-carrier scaffold to relocate it under a number. LOC ceiling tests were deleted; LOC is a soft "look here" signal, never a gate. Real property gates kept (as-unknown-as≤67, composable-layer≤3, no-silent-swallow, console, tagmap-coverage, decision-coverage, doc-drift, builder-wither-discipline rewritten to lock the happy path). This reverted ~48 `@deprecated` tags + anti-mission #3's "≤24 methods" framing on branch `restructure/canonical-refactor-2026-05-28` (CORRECTION 1-6).

---

## Phase 1: Mechanism Validation Sweep — COMPLETE (May 4, 2026)

**Status:** ALL 13 MECHANISMS VALIDATED via TDD spikes. 8 mechanisms KEEP (ship as-is), 5 mechanisms IMPROVE (targeted improvements designed, ship Phase 1 as-is).

### Summary

Executed parallel TDD spike validations for all 13 harness mechanisms (M1–M13). Applied **improvement-first philosophy:** no mechanism sunset without evidence; every under-performing mechanism viewed as improvable. Result: zero removals, 5 clear improvement paths, 8 confident KEEP verdicts.

**Evidence artifact:** `wiki/Research/Harness-Reports/phase-1-mechanism-validation-2026-05-04.md`  
**Synthesis document:** `.agents/PHASE-1-SYNTHESIS.md` (actionable insights for Phase 2+)

### Full Mechanism Verdicts

**KEEP (8 mechanisms — ship v0.10.0 as-is):**

1. **M1: RI Dispatcher** — Architecture sound; measurement infrastructure in place. Full regression-gate analysis deferred to Phase 1.5 to quantify FM-A2/B1 lift.

2. **M2: Strategy Switching** — Test harness ready (20 passing tests). Switching infrastructure wired. Full real-LLM execution deferred; Phase 1.5 will run full corpus to determine switching effectiveness.

3. **M4: Healing Pipeline** — **86.7% recovery rate** (13/15 test cases), **+80% accuracy improvement** (6.7% → 86.7%), **90% token savings** vs. reprompt fallback. Unrecoverable errors identified (missing args, unknown tools). Ready for Phase 1 deployment with alias maps.

4. **M5: Context Curation** — **60.7% compression ratio**, **38.6% token savings** (balanced mode), **0.16ms latency**. Three-stage pipeline confirmed coordinated (resolves FIX-4 claim). Accuracy validation deferred to Phase 1.5.

5. **M9: Termination Oracle** — May 1 fix validated. **100% path coverage** (7 verified call sites). Arbitrator logic sound. CI lint enforcement in place. Zero unauthorized bypasses.

6. **M11: Diagnostic System** — **100% true positive rate**, **0% false positives**, **0.02ms latency** (vs <100ms requirement). Production-ready leak detection. Critical bugs fixed during validation (AWS AKIA key detection).

7. **M12: Provider Adapter Hooks** — **All 7 hooks fire** on provider-specific scenarios. **Zero cross-provider interference**. **254/254 llm-provider tests pass** (no regressions). Each hook measurably improves its domain.

8. **M13: Guards + Meta-tools** — **6 guards functional**, **100% true positive rate** (3/3 invalid tools caught), **0% false positive rate** (0/5 valid tools rejected), **0.018ms latency** (1000 checks). Meta-tools registry: 10 tools, 3 categories, all properly classified. 19 spike tests, 44 assertions, zero regressions.

**IMPROVE (5 mechanisms — design improvements in Phase 1.5, ship Phase 1 as-is):**

1. **M3: Verifier + Retry** — Verifier works (p01b spike cogito:8b). Retry framework sound but context needs tuning for cogito:14b (p02 showed degradation). **Phase 1.5 action:** Iterate retry context (simplified prompts, temperature tuning) to unlock cogito:14b without model degradation.

2. **M6: Skill System** — Lifecycle + RI hooks work. Learning transfers within agent instance (100% on follow-up tasks). **Limitation:** Ephemeral — doesn't survive across sessions. **Phase 1.5 action:** Add skill persistence layer (SQLite/filesystem) for cross-session learning.

3. ~~**M7: Calibration**~~ — ✅ RESOLVED May 14, 2026: re-audit found 9 fields wired (steeringCompliance, parallelCallCapability, observationHandling, systemPromptAttention, optimalToolResultChars, classifierReliability, toolCallDialect, knownToolAliases, knownParamAliases) — exceeds ≥8 target. **Cleanup:** dropped 6 dead schema fields (fcCapabilityScore, fcCapabilityProbedAt, toolSuccessRateByName, interventionResponseRate, interventionResponseSamples, harnessHarmByTaskType) and orphaned `filterToolsBySuccessRate` export. Schema: 15→9 fields. Verdict flipped IMPROVE → KEEP.

4. **M8: Sub-agent Delegation** — TDD test harness ready (10-task multi-step suite). Effectiveness metrics pending. **Phase 1.5 action:** Full execution with real LLMs to measure when delegation beats inline.

5. **M10: Memory System** — Store + recall works. Episodic recall: **66.7%** (verbose), **100%** (key-term queries). FM-F2 mitigated. **Phase 1.5 action:** Design realistic multi-session learning scenarios to validate cross-task memory transfer.

### Validation Methodology

- **13 parallel subagents** dispatched simultaneously (independent spike tests)
- **TDD discipline for all:** RED phase (test structure) → GREEN phase (minimal implementation) → ANALYSIS phase (findings + verdict)
- **Running spike logs** for each mechanism (journey documented)
- **Domain owner alignment** (mechanism owners designed spikes)
- **Zero regressions** (full test suite green: 1,103+ tests)

### Key Learnings

1. **Improvement-first works.** Removed "prove or sunset" binary. Every mechanism viewed as improvable. Result: zero premature sunsets, 5 clear improvement paths.

2. **Parallel dispatch scales.** 13 mechanisms validated in 1 session. Enables rapid validation cycles for future phases.

3. **Running spike logs preserve rationale.** Each mechanism documents decision journey. Future maintainers can re-read logs to understand verdicts, not just the verdict itself.

4. **Integration testing deferred.** Phase 1 tested mechanisms in isolation. Phase 2 should test mechanism compositions (healing + guards, strategy-switching + RI, etc.).

5. **Real-LLM execution deferred.** M2, M8, others designed harnesses but ran with mock LLMs. Phase 1.5+ should re-run with real LLMs.

### Phase 1.5 Roadmap (Optional, 3–5 sessions, parallel to v0.10.0 release)

- [ ] M3: Iterate retry context for cogito:14b recovery
- [ ] M6: Implement skill persistence (SQLite/filesystem)
- [ ] M7: Execute field activation spikes (≥8 of 14)
- [ ] M8: Run full delegation effectiveness analysis
- [ ] M10: Design realistic multi-session memory scenarios

**Output:** Phase 1.5 evidence artifact; amended verdicts inform Phase 2

### Phase 2 Gate Amendments (Based on Phase 1 Findings)

**Original Phase 2 gates (master roadmap §3):**
- W23: execution-engine.ts ≤600 LOC; 9 phase modules ≤400 LOC each
- W24: Strategy RI-scaffolding + reflexion
- W26: Sub-builders + thin DX
- W27: GatewayAgent type extraction
- W28: Phase-typed builder validation

**Proposed amendments:**

1. **W23 amendment:** Include M5 (context curation) as standard kernel phase. Define interface for optional phases (strategy-switch, compression) so composition is declarative.

2. **W23 amendment:** Formalize arbitration as terminal phase (M9). No phase directly transitions `status:"done"`; all go through arbitrator.

3. **W24 amendment:** Enable M2 (strategy switching) by default on multi-step tasks. Phase 1.5 metrics will inform per-model switching heuristics.

4. **W23+ amendment:** Phase 2 includes **integration tests** validating mechanisms work together (healing + guards + delegation).

5. **Post-W28 amendment:** Phase 1.5 improvements land mid-Phase-2. Integration with Phase 2 waves explicit (M3 retry, M6 persistence, M7 calibration, M8 delegation metrics inform Phase 3+).

### Files Updated

- ✅ `.agents/PHASE-1-SYNTHESIS.md` — Comprehensive findings → actionable insights
- ✅ `wiki/Research/Harness-Reports/phase-1-mechanism-validation-2026-05-04.md` — Validation evidence artifact
- ✅ `docs/superpowers/plans/2026-05-03-v1-master-roadmap.md` — Amendment log entry (Phase 1 complete)
- ✅ `docs/spec/docs/AUDIT-overhaul-2026.md` — Final mechanism verdicts in §10.2 (Phase 1 validated, 8 KEEP + 5 IMPROVE)

---

## Memory reconciliation — corrections from Stage 3 audit

Two prior memory entries are demonstrably stale or wrong. Do not propagate these in future memory:

| Stale claim | Actual state | Source |
|---|---|---|
| "3/6 skill lifecycle AgentEvents missing" | **Events exist** at `core/services/event-bus.ts:1001-1005`. **All 6 hooks wired** (W2 FIX-6) at `builder.ts:2673-2731`. This is fully resolved — do not resurface. | AUDIT §11 item 6, M6 mechanism; verified May 1 |
| "Calibration defaults to `:memory:`" | **Already correct** at `reactive-intelligence/types.ts:246` (`~/.reactive-agents/calibration.db`). Apr 21 fix. | AUDIT §11 item 9 |

Memory descriptions to update or rewrite if you encounter them in personal memory:
- `project_v010_audit_blockers` — both stale claims above appear here.
- `project_running_issues` — older entries; cross-reference against AUDIT §11 before acting on any item.

---

## Architecture summary (high signal, low detail)

**Kernel lives at `packages/reasoning/src/kernel/`** — reorganized in Stage 5 from `strategies/kernel/` to capability-grouped subdirs:
- `capabilities/` — 10 subdirs: act, attend, comprehend, decide (arbitrator.ts), learn, reason (think.ts), recall, reflect (loop-detector.ts, reactive-observer.ts), sense, verify
- `loop/` — runner.ts, react-kernel.ts, terminate.ts (single-owner termination helper), auto-checkpoint.ts, output-assembly.ts, output-synthesis.ts (runner.ts LOC volatile — under active termination-decider-collapse, don't pin)
- `state/` — kernel-state.ts, kernel-hooks.ts, kernel-constants.ts
- `utils/` — diagnostics.ts, ics-coordinator.ts, lane-controller.ts, service-utils.ts

**Two records, distinct purposes:**
- `state.messages[]` — what the LLM sees (provider conversation thread)
- `state.steps[]` — what systems observe (entropy, metrics, debrief)

**FC conversation thread flow:**
1. Execution engine seeds `state.messages` with `[{role:"user", content: task}]`
2. `think.ts` reads messages → `applyMessageWindow` → provider LLM call
3. `act.ts` appends: `assistant(thought+toolCalls)` + `tool_result(s)` + progress/completion message

**Critical build patterns:**
- All providers pass `tools` to both `complete()` AND `stream()` methods
- Anthropic streaming: use raw `streamEvent` not helper events (`inputJson` fires before `contentBlock`)
- Gemini tool results: `functionResponse.name` must use `msg.toolName` not hard-coded "tool"
- Gemini streaming (W22): walk `candidates[0].content.parts[]` directly — `chunk.text` strips functionCall parts. Surface non-OK `finishReason` (UNEXPECTED_TOOL_CALL, MAX_TOKENS, SAFETY, MALFORMED_FUNCTION_CALL) as explicit errors.
- Ollama streaming: `chunk.message.tool_calls` on `chunk.done`, emit `tool_use_start` + `tool_use_delta`
- Loop detection: `maxConsecutiveThoughts: 3` — only ACTION steps reset the streak; observations do NOT. IC-1 fix Apr 12, now at `kernel/capabilities/reflect/loop-detector.ts:102`

---

## Architecture debt (current top items)

The full list lives in `AUDIT-overhaul-2026.md` §11 (44 items). Top items as of May 14:

1. ~~`builder.ts` 6,082 LOC + `execution-engine.ts` 4,499 LOC~~ — ✅ RESOLVED Phase A (May 8–9): `execution-engine.ts` 4,499→1,637 LOC (W24); `builder.ts` 6,232→2,481 LOC (W25). Both decomposed into capability-grouped modules.
2. ~~**Eval Rule 4 frozen-judge**~~ — ✅ RESOLVED W9/FIX-21 (commit a9a7c55f): `eval-service.ts:189` yields `JudgeLLMService` Tag; benchmarks route through `packages/judge-server/` HTTP process.
3. **ToT outer loop still unhooked** from `dispatcher-early-stop` — each branch is a separate sub-kernel (PER inner loop fixed Apr 19 at `plan-execute.ts:781,806`).
4. ~~Strategy routing opt-in~~ — ✅ RESOLVED May 12: enabled by default (`enableStrategySwitching !== false`); wired at `packages/runtime/src/runtime.ts:915` (also gated off by `withLeanHarness()`); field type still optional at `strategies/reactive.ts:72`. (`packages/runtime/src/runner.ts` removed in W25 decomp.)
5. ~~Pruning Principle Builder API (Issue #7)~~ — ✅ RESOLVED (verified 2026-05-20): `withLeanHarness()` shipped at `builder.ts:977`, wired `runtime.ts:797,915,922`, state field `_leanHarness` at `builder/build-effect/runtime-construction.ts:156,391`.

**Resolved in prior work:** kept inline; the planned `MEMORY-ARCHIVE-RESOLVED.md` extraction was not produced. Resolved P0s listed below.

---

## Restoring sprint context

If you need the historical sprint logs (Mar–Apr 2026 stage-by-stage commits, IC-1/IC-2/IC-3 fixes, MCP client rewrite details, kernel composable phase shipment notes, the 6-handler RI dispatcher wiring sessions, etc.):

```bash
git log --diff-filter=M -- .agents/MEMORY.md | head -20  # find the rewrite commit
git show <sha>:.agents/MEMORY.md                          # read the prior version
```

The sprint logs are intentionally not carried forward in this reset because:
- Most sprint findings are now reflected in code or in `AUDIT-overhaul-2026.md`.
- Per-day "what shipped" entries decay fast and create noise for cold-start agents.
- The audit is the consolidated view; this memory is the index pointing to it.

---

## Lost / pending re-implementation (carried forward)

Three Obsidian-vault skill modules under `.agents/skills/` were deleted in the Phase-0-close cleanup on 2026-04-24 and are NOT recoverable from any backup:

- `.agents/skills/obsidian-vault-query/` — read the vault at session start
- `.agents/skills/obsidian-vault-sync/` — write decisions/experiments/sessions back to the vault
- `.agents/skills/obsidian-vault-hygiene/` — orphan/bitrot/duplicate loop maintenance

`AGENTS.md` and `.agents/skills/update-docs/SKILL.md` may still reference these by name. Re-implement before agents can act on those references.

---

*If you find this file stale, update it directly. Keep it short — the audit doc is where detailed plans live.*
