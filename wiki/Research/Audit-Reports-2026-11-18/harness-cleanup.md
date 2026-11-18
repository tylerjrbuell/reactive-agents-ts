---
type: audit
status: active
created: 2026-11-18
tags: [audit, harness, reasoning, reactive-intelligence, release, v0.19]
---

# Harness cleanup audit before v0.19.0

Read-only audit of `packages/reasoning` and `packages/reactive-intelligence` by kernel-warden, 2026-11-18. No source edits were made. The main thread filed it, because `wiki/*` is outside kernel-warden's manifest.

**Headline:** no ship-blocker with evidence. Today's terminal-path commits read correctly:
- The to-do wrap-up opt-in (`6a94f6eeb`) is gated at its single call site.
- The no-tools carve-out (`0ca931ae1`) is wired for all 8 strategies.
- The verifier wording change (`1ddf3b3b8`) changes wording only.

## Pre-launch polish

1. **An advisory verdict prints as a warning.**
   - **Where:** `runner-terminal-verify-gate.ts` `runTerminalVerifierGate`.
   - **What:** the advisory is emitted with `_tag: "warning"`, so a correct answer that is kept still shows "Advisory check on the model's answer (answer kept)…" on the TTY.
   - **Risk:** first-run noise that reads as distrust of a correct answer.
   - **Fix:** log `warn`-severity advisories at verbose/debug. Count how often it fires in traces first.
2. **A user stop before any answer reports the wrong cause.** Proven with a probe.
   - **Where:** `sense/finalize-result.ts` `finalizeStrategyResult`, the coverage re-mint. When `decisionRefused` or `userStopped` holds, it rebuilds from `params` and drops the earlier arms' `error`. Lost: the GH #206 `describeEmptyFailure` cause, and the fabrication-guard error with its failed checks plus `enforcedTerminalMetadata`.
   - **What:** a stopped run reads "no grounded answer could be produced from the available tools" instead of the real cause.
   - **Fix:** carry `gated.error` and gated's `extraMetadata` through the re-mint, and pin it with an empty-output user-stop test.
3. **A documented knob does nothing.**
   - **Where:** `ContextProfile.recentObservationsLimit` (`context/context-profile.ts`). It has zero readers (debt D-2026-10-13-W2F-1).
   - **Doc:** `reference/builder-api/limits-cost-resilience.md` documents it.
   - **Fix:** mark the JSDoc as a no-op or deprecated, and remove the docs row.
4. **The no-tools carve-out reads only the pruned tool set.**
   - **Where:** `strategy-run.ts` computes `offersDomainTool(seeded.availableToolSchemas)`.
   - **Risk:** if relevance pruning hides every domain tool while tools are still discoverable, a forced neutral answer could read as success.
   - **Fix:** add a pin test first. If it fails, also count `allToolSchemas` when discovery is on.
5. **`run-started.config` omits `todoWrapUp` and `writeCoverage`.**
   - **Where:** `packages/runtime/src/engine/execute-run-config.ts`.
   - **Risk:** a run with `RA_TODO_WRAPUP=1` can't be told apart in its trace.
   - **Fix:** add both, plus a drift test that every `ResolvedHarness` key is recorded.
6. **Formatting artifact.** `strategy-run.ts`: `const add =(s`.

## Post-release cleanup candidates

1. **Format re-synthesis is a default-on extra LLM call with no ablation.**
   - **Where:** `runner-output-quality-gate.ts` `runOutputQualityGate`.
   - **What:** a regex format cue in the task plus a lenient validator failing triggers a rewrite call.
   - **Next step:** spike how often it fires. The default changes only with ablation evidence.
2. **`finalizeStrategyResult` is about 500 lines.**
   - **Where:** `finalize-result.ts`, 933 LOC. That is 67 lines under the 1,000-line new-giant bar.
   - **What:** it reads the terminator three times, in different key orders, and calls `buildStrategyResult` up to 6 times per result. Polish item 2 comes from this.
   - **Fix:** one terminator resolver, with the arms moved into a seam module.
   - **Other files near the bar:** `exit-gate.ts` 953, `verifier.ts` 913, `reflexion.ts` 987.
3. **Default-on plan mechanisms still marked "ablation pending".**
   - **Where:** `harness-flags.ts`: `planBudget`, `autoTick`, `bookkeepingRefund` and `planToolCatalog`.
   - **Scope:** they only affect seeded-plan and plan-posture runs.
   - **Conflict:** `autoTick` contradicts the "never checks a row for the model" rule in `todo-wrap-up.ts`.
   - **Next step:** owner decision plus ablation-warden.
4. **The to-do wrap-up check runs with the flag off.** `exit-gate.ts` runs `todoWrapUpAwaitingReply` on every soft proposal even with the flag off. It has no effect, but it scans every step. Fix: gate it on `input.harness?.todoWrapUp`.
5. **Semantic-entropy path in Reactive Intelligence.**
   - **Stale comment:** `types.ts` says "priorThought is never populated", which is now false.
   - **Wasted work:** `entropy-sensor-service.ts` embeds both thoughts on every call, although the prior embedding is cached.
   - **Side effect:** it also mutates `kernelState.meta` in place.
6. **Curator trace events repeat every turn.** `think.ts` re-emits a `compressed` curator decision for every preview+ref result, every turn, so trace events grow as results × iterations. Fix: dedupe by ref.
7. **Adaptive fallback re-runs the task.** `adaptive.ts` re-runs the reactive strategy after a sub-strategy returns `partial` or `abstained`. That is opt-in, but it costs a second run and retries an honest abstention without measurement.
8. **Dead exports.** The scan was partial. About 16 exports have no external importer, but each is used in its own file, so the code is not dead. There are no stale TODO/FIXME markers.

## Primer drift (fixed by the main thread)

`kernel-warden.md` invariant 5 said strategy switching is default-on. It is opt-in (`packages/runtime/src/runtime.ts`).
