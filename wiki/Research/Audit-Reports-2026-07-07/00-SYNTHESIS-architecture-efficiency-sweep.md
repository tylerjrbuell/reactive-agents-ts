# Architecture Efficiency Sweep — SYNTHESIS (2026-07-07)

**Method:** 7 parallel read-only audits over the core agentic surfaces (loop/kernel, prompts/context, provider params, strategies, tool calling/governance, compression/grounding/verification, wiki-synthesis mapping). Full reports: `01-`…`07-` in this directory. Every claim carries file:line evidence in the sub-reports.

**Question answered:** before committing to the overhaul plan — where are the real inefficiencies and design shortcomings, what are the better canonical shapes, and does the 7-phase plan survive contact with the evidence?

**Verdict: the plan survives and sharpens.** The sweep found no reason to reorder the pillars — it found (a) a batch of LIVE BUGS that must not wait for the overhaul, (b) three cross-cutting diseases that unify ~40 findings, and (c) proof that the better shapes already exist inside the codebase as underused mechanisms.

---

## A. Live bugs (hotfix class — fix BEFORE/alongside overhaul, days not weeks)

1. **Harness guidance channel is a silent no-op** (CONFIRMED by direct read, think.ts ~432-500): `GuidanceContext` is fully assembled each iteration (required-tools pending, loop-detected nudge incl. pipeline transform, ICS guidance, oracle guidance, error recovery, act reminder, quality-gate hint, evidence gap) and `state.pendingGuidance` is read-and-cleared — then the object is NEVER passed to `buildThinkProviderRequest`/`project()`. Signals that ALSO travel as steps/messages still land (why B1's redirect worked); anything routed only via the guidance channel is dropped. The intended renderer (ContextManager guidanceSection) is dead code. **Fix: add a `guidanceStage` to `project()` and thread guidance through the request builder.** Likely bears on A3 #7 "wrong-remedy steering" — some remedies may never have reached the model at all.
2. **`{{from_step:sN:full}}` returns the compressed preview, not `fullResult`** (types/plan.ts:184) — the FM#3 sibling: the projection built for whole-content transfer hands back truncated data; `resolveStepReferences` cannot even reach `fullResult`.
3. **`ToolService.execute` never enforces `requiresApproval`/`riskLevel`** (tool-service.ts:319-409) despite its JSDoc `@throws ToolAuthorizationError`. Only the kernel HITL detach-mode gate enforces approval; plan-execute/direct callers bypass entirely. Governance hole.
4. **Semantic memory is fed compressed previews** (tool-execution.ts:613,743) — the memory of past tool calls persists lossy projections.
5. **Stream error paths bypass `mapProviderError`** in all four cloud providers (anthropic.ts:455, openai.ts:585, gemini.ts:638, litellm.ts:557) — the exact stack-leak shape the normalizer was built to kill.
6. **Dead code masses that actively mislead:** the entire ContextManager/APC prompt stack (~1,200 LOC: prompt-composer, prompt-sections-default, buildIterationSystemPrompt, buildConversationMessages chain) has NO live caller — an auditor reading it would believe it's the prompt. Also dead: `inferRequiredTools` (0 callers), two always-null arbitrator evaluators, `RA_MINIMAL_PROMPT`. Calibration steering fields (`steeringCompliance`, `systemPromptAttention`) are read only in dead code — per-model steering is stranded.
7. **Doc/flag drift:** trace/analyze.ts:219 claims post-conditions OFF; live arbitrator has them default-on with the flag deleted. Decision Index still names North Star v3.0 as arbiter (v6.0 + ratified adaptive-harness decision absent). FM taxonomy stale vs A3.

## B. The three diseases (what ~40 findings collapse into)

### Disease 1 — Authority scatter (no single owner per decision)
- **~22 imperative control actors + 2 termination oracles** that can disagree: verdict-driven `arbitrate()` vs imperative `terminate()`, each with its OWN post-condition gate (steer-and-continue vs hard-fail for the same unmet condition). Budget guard, grounded-terminal gate, and success-veto fire ONLY on arbitrator exits — every stall/loop/low-delta/oracle-forced termination bypasses all three. The controller veto exists twice with divergent triggers. Required-tools "missing" has two answers (raw vs effective) split across think vs loop.
- **Visibility computed in 4 sequential sites across 2 packages** (runtime 5-stage → kernel prune → gate-narrow → pressure-narrow) + a separate execution gate; `requiredTools` is the implicit visibility floor in ≥3 of them (the rw-9 regression patched ONE).
- **3 producers of "required tools"** (nominate heuristic, LLM classify, literal-mention fallback) merged incidentally.
- **Post-loop output ownership = 3 overlapping fallback blocks + 3 synthesis invocation sites.**

**Canonical shape:** one decision = one resolver. The arbitrator's evaluator-chain (confidence-ranked, short-circuit) is ALREADY the right structure — extend it from one decision (termination) to all control flow (`ControlSignal = continue | redirect | switch | terminate`), route every imperative actor through it, merge both oracles/vetoes/gates, and give tool visibility its own single compiler with per-tool reason strings. `pendingGuidance` (typed channel, exists) becomes the single guidance output — once bug A1 makes it actually render.

### Disease 2 — Representation duality (preview vs full, served to the wrong consumer)
A tool result lives in ≥6 stores in 2 representations; only ONE consumer (`buildEvidenceCorpusFromSteps`) resolves the full form correctly. Confirmed wrong-representation consumers: `:full` step refs (bug A2), semantic memory (bug A4), finalize's `collectToolData` (harvests from pre-projection messages — synthesis sees different data than the model saw). 5-6 uncoordinated compaction paths with inconsistent thresholds (0.75 / 0.80-0.95 / per-call bytes) and NO post-compaction outcome check anywhere. `compactHistoryStage` drops content with a ref-less pointer (unrecoverable), unlike ResultStore's preview+ref.

**Canonical shape:** the evidence ledger with entry `{full, preview, extractedFact, storedKey}` and every store becoming a projection. The pieces exist: `_tool_result_N` scratchpad IS the full store, `ResultStore.preview()` IS the honest projection, post-conditions already calls `steps[]` "the run LEDGER", `extractedFact` is a high-fidelity distilled projection that's underused. This is a rename-and-rewire, not a greenfield.

### Disease 3 — Parallel/dead systems (two implementations, one rotting)
Dead APC prompt stack vs live `project()`. Capability `toolCallDialect` dead vs live `ModelCalibration.toolCallDialect` duplicate. Two tier cap tables (`CONTEXT_PROFILES.toolResultMaxChars` vs `TIER_TOOL_RESULT_PRESERVE`, admitted mirror). Live `TrustReceipt` vocabulary vs offline honesty-label vocabulary grading the SAME run twice, disconnected. Legacy 9-evaluator chain vs intent resolver. blueprint/worker.ts hand-copying step-executor (comments cite the line numbers it copies) and dropping budget/calibration/requiredTools in the copy. Synthesis prompt triplicated with drift (blueprint's lacks the EVIDENCE RULE). RI/entropy block copy-pasted into 2 strategies (~240 LOC), absent from 3 others. 6 of 11 capability fields dead. Token accounting mixes estimated-/4 with real usage tokens — adaptive's cost heuristic compares incompatible units.

**Canonical shape:** the North Star's own anti-scaffold rule (F4/F5: producer+consumer same commit, no parallel systems) applied retroactively: for each pair, pick the live one, port any validated lessons, DELETE the other. The M12 adapter cleanup (6 of 7 hooks deleted as un-invoked) is the in-repo precedent.

## C. What the sweep proves about the substrate (keeps — the better shape is already here)

- `project()` staged assembly pipeline — IS the one prompt pipeline; needs guidanceStage + stable/dynamic cache partition.
- `ResultStore` + preview/materialize + `storedKey` scratchpad — IS the ledger's content store.
- `buildEvidenceCorpusFromSteps` — the reference full-resolution consumer; pattern to replicate.
- Arbitrator evaluator-chain + `Verdict`/`TerminationIntent` types — IS the control plane's shape.
- `verifyAndEmit` + severity rollup — IS the graded-verification boundary; the independent checker (P6b) plugs in as one more producer with zero runner changes.
- `buildKernelInput` + `CrossCuttingInput` Pick-pattern — compile-error-on-dropped-field; hand-typed subsets (StepExecutorInput, workerCtx) are exactly where FM-I fields leak.
- `computeTrustReceipt` — honesty label is a thin projection over data it already reads; merging makes honesty LIVE with no new instrumentation.
- ~83% of strategy LOC is plumbing (≈6,800 → ≈1,180 genuine policy). plan-execute + blueprint + reflexion are the SAME loop with 9 policy hooks (enumerated in report 04).
- `AssemblyTrace`, `RA_PROMPT_DUMP`, `HealingResult.actions[]`, killswitch idiom (`RA_*`) — ready-made measurement + rollout instruments for every phase.

## D. Amendments to the 7-phase plan

| Phase | Amendment from sweep |
|---|---|
| **NEW 0.5 — Hotfix batch** | Bugs A1-A5 + delete dead masses (A6) + doc fixes (A7). Days. Ships before/alongside everything; A1 (guidance render) may alone move bench steering quality. |
| 1 Gateway | ADD: `maxOutputTokens` capability clamp (replaces think.ts hardcoded 64k), cloud timeout chains (8 literals → 1 resolver), shared stopReason table + mapUsage, litellm thinking/capability parity, one buildBody per provider (3 method-bodies → 1). |
| 2 Tool Surface | RAISED PRIORITY (≥3 incidental floors, not 1). ADD: collapse 3 required-producers into compiler input with priority order; fold the act.ts exec gate so visible/callable resolve in one place; adopt healing-actions as reason substrate. |
| 3 Terminal Authority | BIGGER but better-defined: merge the TWO oracles, TWO vetoes, TWO post-condition gates; route ALL ~5 imperative terminations through `arbitrate()` (budget/grounded/veto uniformly applied); one required-tools function parameterized `{excludeFailed}`; one post-loop `assembleFinalDeliverable` + one finalize. |
| 4 Ledger | CONFIRMED shape `{full, preview, extractedFact, storedKey}`; ADD: memory writes full; finalize harvests via ledger; honesty label merges into receipt (live honesty); serialization gap fix (resume drops 6 live counters — kernel-state.ts:1023). |
| 5 Control Plane | The 16 in-loop actors become evaluator-chain entries (structure exists); `pendingGuidance` the single output channel; delete IterationCarrier/sync scaffold. |
| 6 Policy Compiler | ADD inputs discovered: calibration steering fields (stranded in dead code), `TaskShape` predicates (validated, host dead), tierMaxTokens+thinkingAllowance (inline → profile), degrade-to-reactive as first-class policy. |
| 7 Strategy→Policy | CONFIRMED: `runPlanLoop` with the 9 hooks from report 04 absorbs plan-execute+blueprint+reflexion (~4,000→~200 LOC); blueprint adopts step-executor (deletes worker copy); ToT keeps BFS as policy; unify token accounting on real usage. |
| NEW 1b — Assembly | Cache-stable partition (stable prefix / dynamic tail with breakpoint), guidanceStage (from 0.5), shared persona/synthesizer constants, collapse two tier tables, delete dead APC stack. Small; pairs with Phase 1. |

**Sequencing unchanged:** 0.5 immediately; 1∥1b∥2; 3 after 1; 4 after 3; 5 after 4; 6 after 2+3+4; 7 last. All bench-gated, lift rule + warden veto binding, falsified-levers blacklist honored (with the extractObservationFacts code-vs-lever nuance), no LATS/GoT.

## E. Leverage ranking (top 10 across everything)

1. Guidance channel no-op fix (A1) — correctness of ALL steering, trivial cost.
2. Terminal authority merge (Phase 3) — closes the bypass class: budget/grounding/veto uniform.
3. Tool Surface Compiler (Phase 2) — the regression class + 4-site scatter.
4. Evidence ledger (Phase 4) — kills representation duality + makes honesty live + fixes memory fidelity.
5. Gateway param resolution + capability clamps (Phase 1) — dead-signal revival, silent over-request.
6. Control-plane merge (Phase 5) — un-diagnosable veto/race class.
7. `runPlanLoop` policy hooks (Phase 7) — 4,000→200 LOC, invariants by construction.
8. Dead-mass deletion (0.5/1b) — ~1,500+ LOC of misleading surface gone.
9. Cache-stable prompt partition (1b) — cost, all providers with prefix caching.
10. Policy compiler (Phase 6) — the strategic payoff; everything above feeds it signal.
