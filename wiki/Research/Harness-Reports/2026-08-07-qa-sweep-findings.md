# QA Sweep — 2026-08-07

## Methodology

- T0 deterministic bench (4/4 pass)
- 6 live probes: OpenAI gpt-4o-mini, Gemini 2.5-flash, Ollama gemma4:12b
- Trace mining of 8 large + recent traces via rax-diagnose CLI
- Source-code audit of entropy, verifier, memory-flush, and goalAchieved paths

## Findings & Fixes

### F1: Semantic abstention via final-answer tool — FIXED

**Root cause**: When a model calls the final-answer tool with abstention content (e.g. "I cannot access the database"), `terminatedBy` was set to `final_answer_tool` and `goalAchieved` reported `true`. The system had no path to reclassify a final-answer delivery as an abstention — that required the model to call the separate `abstain` tool, which models rarely use spontaneously.

**Fix**: Added `looksLikeSemanticAbstention()` detector in the arbitrator's `agent-final-answer` case. When the final-answer output is short (<500 chars) and matches narrow abstention patterns, `terminatedBy` is set to `"abstained"` instead of `"final_answer_tool"`. Two guards prevent over-reclassification:
1. **Deliverable guard**: if `hasSuccessfulSubstantiveToolCall(ctx.steps)` is true, skip reclassification — the "I cannot" is qualifying language on otherwise-delivered work, not a genuine abstention. Mirrors `decideForcedAbstention`'s `hasDeliverable` guard.
2. **Length guard**: outputs >500 chars are never reclassified (substantive content).
Auto-populates `abstention` metadata in `applyTermination` so the `AgentResult.abstention` contract is honored.

**Files**: `packages/reasoning/src/kernel/capabilities/decide/arbitrator.ts`
**Tests**: 6 new tests in `arbitrator.test.ts` (positive matches, false-positive guards, length guard, via-discriminator guard, deliverable guard)

### F2: Entropy hardcoded to 0.15 for short runs — FIXED

**Root cause**: `computeCompositeEntropy` returned a hardcoded `composite: 0.15` with `confidence: "high"` for all runs with ≤2 iterations. Stall-detect's local-tier window=2 evaluated entirely on this synthetic value, creating misleading "Model stalled" Grade B messages on runs that completed successfully in 1-2 iterations.

**Fix**: Three changes:
1. `composite.ts`: Compute a real weighted composite from available entropy sources for short runs, but mark `confidence: "low"` (was `"high"`). Also fixed missing spread on `WEIGHTS_WITH_LOGPROBS` that would mutate the module-level constant when `logprobsAvailable && semantic === null` (first iteration of any OpenAI/Anthropic run).
2. `stall-detect.ts`: Skip entries with `confidence: "low"` when checking for flat entropy, so preliminary data never triggers a stall decision.
3. `types.ts` + `service-utils.ts`: Added optional `confidence` field to `ControllerEvalParams` so stall-detect can read it.

**Files**: `packages/reactive-intelligence/src/sensor/composite.ts`, `packages/reactive-intelligence/src/controller/evaluators/stall-detect.ts`, `packages/reactive-intelligence/src/types.ts`, `packages/reasoning/src/kernel/utils/service-utils.ts`
**Tests**: Updated 2 existing composite tests, added 2 new stall-detect tests for low-confidence handling, added 1 module-constant mutation regression test

### F3: Memory-flush LLM extraction on local models (investigated, not a defect)

`spot-test.ts` explicitly enables memory via `.withMemory()` (line 64). The 12-15s extraction cost on local models is expected behavior for memory-enabled runs. Not a boundary defect — opt-out exists via `SPOT_NO_MEMORY=1`.

### F4: Gemini token inflation (investigated, deferred)

Gemini 2.5-flash reported 64k tokens for a simple task vs 4-5k for others. Likely thinking-token inflation. Requires provider-level investigation.

### F5: Curator budget swing (identified, deferred)

Same tool result within a single run sees budget swing from 1,400,000 to 800 (1750x). First-touch appears unbudgeted at full window scale; subsequent touches use a fixed per-result cap. Needs investigation at `packages/reasoning/src/assembly/capability.ts`.

### F6: Cascade B root — last reconstruction-divergent success authority unified onto the ledger — FIXED

**Context**: Systems-audit 2026-07-29 RC#1 ("fragmented, filesystem-blind success authority"). Move 2 (2026-07-31 → 08-06, commits `49a1c94f`/`7dbb270d`/`92dc591e`) already unified authorities #1 (post-condition terminal gate) and #4 (deliverable report → `goalAchieved`) behind `verifyDelivery` with disk ground-truth. The 88% false-failure data (rung 2026-07-28) predates that fix; the current-HEAD happy path was re-verified correct (kernel run, landed file → `success:true`, `goalAchieved:true`).

**Remaining gap (authority #3)**: the missing-required-tool gate (`runner.ts` §8) — which fails the run and **nulls the output** — read `missingRequiredToolsForInput` from `state.steps` ONLY (+ one-level `delegatedToolsUsed`). But `isToolCalled` (authority #1) reads the run-scoped `RunLedger` `tool-result` entries, which merge a sub-agent's calls **including grandchildren** (Wave C.2). So a required tool satisfied 2+ delegation levels deep was CALLED per authority #1 but MISSING per authority #3 → the run false-failed and nulled a deliverable a deeper agent had produced. Two authorities, two definitions of "called", one blind — the exact Cascade B disease Move 2 left on the last authority.

**Root cause verification (data, not hypothesis)**: pulled all 45 rung cells. In **every** false-fail cell `file-write` WAS called (`fw_called=true`), refuting an initial "wrong tool name" (CT-3) hypothesis for authority #3. The genuine, structural gap is the delegation-depth substrate divergence, confirmed by grep: `buildSuccessfulToolCallCounts` steps-only vs `isToolCalled` ledger-first.

**Fix**: threaded the run-scoped ledger into `buildSuccessfulToolCallCounts` / `getMissingRequiredToolsFromSteps` / `getPermanentlyFailedRequiredTools` / `getEffectiveMissingRequiredTools` / `missingRequiredToolsForInput`. Passed `state.ledger` at the run-failing authorities on the kernel path: the post-loop §8 gate (`runner.ts`, the output-nulling one) + the in-loop required-tool redirect that fails the run after retries (`iterate-pass.ts:1561`) + the required-tool nudge counter (`loop-resolution.ts`). The `low_delta_guard` site (`iterate-pass.ts:836`) was deliberately NOT threaded — it feeds a run-*terminating* guard whose polarity inverts (fewer "missing" tools removes a reason the guard declines to fire), and that control-flow change was not measured.

Ledger tool-result successes are de-duplicated against local steps by `toolCallId` — the ledger entry's `toolCallId` is projected from the same `meta.toolCallId` the step-dedupe reads, so a local call and its ledger projection always agree (both present → deduped; both absent → the unlinked ledger entry is skipped). No quantity>1 double-count. It only ADDS successful-tool evidence, so on this "was the tool called" gate it can only relax a would-be `missing_required_tool` failure toward pass — the safe direction. (Unlike the `ArtifactProduced` path-matching authority, there is no stale-args false-MET analog for "was this tool called": a `tool-result{success:true, toolName:X}` is an unconditional fact.) Ledger omitted ⇒ byte-identical to prior steps-only behavior; a non-delegating single-agent run is unchanged.

**Reachability** (source-traced): `transitionState` (kernel-state.ts:1266) grows `state.ledger` from new steps via `projectStepsToLedger`→`stepToEntries`, which folds a spawn observation's `subAgentLedger` (step-projection.ts:168) verbatim — a grandchild rides in via the child's own merge. So on the reactive-kernel path the child/grandchild `tool-result` entries are present in `state.ledger` when §8 runs. An end-to-end kernel-delegation cell was attempted but is blocked by test-provider scripting limits (classifier turn-consumption + the tension of `required:[file-write]` on a parent that delegates rather than calls it) — the OB-3 "sub-agent merge on the kernel parent path is untested" area. Reachability therefore rests on the source trace + the wired call sites, not an e2e pin.

**Files**: `packages/reasoning/src/kernel/capabilities/verify/requirement-state.ts`, `packages/reasoning/src/kernel/loop/runner-helpers/state-queries.ts`, `runner.ts`, `iterate-pass.ts` (1 site), `runner-helpers/loop-resolution.ts`
**Tests**: 4 new red-on-cut tests in `requirement-state.test.ts` (grandchild-ledger credit, toolCallId dedupe / no quantity double-count, byte-identical-without-ledger, ledger clears locally-permanently-failed). Red-on-cut verified: mutating the ledger read to `entriesOfKind(undefined, …)` fails exactly 2 of the new cells.
**Scope note**: this closes the LAST reconstruction-divergent success authority (the substrate-unification half of Cascade B; the disk-ground-truth half shipped in Move 2). It is a mechanism fix + unit red-on-cut pin, addressing the DELEGATED-required-tool case specifically — a narrower class than the measured 88% (single-agent, already covered by Move 2 + the by-design authority-#2 honesty rule). A false-negative *rate* drop needs owner-gated live arms; not claimed here.

## Verification

- T0 bench: 4/4 pass (no baseline drift)
- reactive-intelligence: 474 pass, 0 fail (from my changes)
- reasoning: 1949 pass, 1 fail (pre-existing)
- runtime: 1184 pass, 0 fail
- Build: clean across all affected packages
