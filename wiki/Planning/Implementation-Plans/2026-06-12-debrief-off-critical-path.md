# Debrief Off Critical Path — fork the post-answer LLM debrief

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development OR inline TDD. Checkbox steps.

**Goal:** Stop the post-answer debrief LLM call from blocking `run()`'s return. Measured: 4.7s of a 9.8s frontier run (48%) is debrief synthesis *after the answer is ready*; ~6s local (#143). Return the answer immediately; synthesize the rich debrief in a background fiber.

**Approach (user-chosen Option C — fork persistence + store async; keep the rich debrief obtainable, lazily):**
- `run()` returns the instant the answer + a deterministic fallback debrief are ready (no LLM block).
- The rich LLM debrief synthesizes in a **forked fiber** on the agent's `ManagedRuntime`; persistence (`DebriefStore.save`) + `DebriefCompleted` event ride inside that fiber (off critical path).
- `result.debrief` stays a valid `AgentDebrief` synchronously = the deterministic **fallback** (contract holds: never null on memory runs).
- New `result.debriefRich(): Promise<AgentDebrief | undefined>` awaits the forked fiber for the LLM-rich version ("await only when the caller reads it"). Resolves to the fallback if no LLM debrief was scheduled (trivial/no-memory/no-LLM).
- `agent.getLastDebrief()` is upgraded to the rich version once the fiber resolves; `agent.dispose()` **awaits pending debrief fibers** so short-lived `run(); dispose()` never drops the persist.

**Why correct:** `forkDaemon` ties the fiber to the runtime scope (survives the run pipeline), not the local scope. dispose() joins pending fibers before closing the runtime. Long-lived agents (gateway/server) + multi-turn chat hide the debrief entirely (completes during idle / next turn); fire-and-forget scripts pay it at dispose() instead of run() but still get `result.output` ~5s sooner.

**Token honesty:** `result.metadata.tokensUsed` no longer includes debrief tokens at return (they're background/post-answer). This is MORE honest about the *answer's* cost. The forked fiber surfaces debrief tokens via `debriefRich()`'s resolved value metadata + telemetry. Update GH #143 comment accordingly.

---

## File Structure

| File | Change |
|---|---|
| `packages/runtime/src/engine/finalize/debrief-synthesis.ts` | SPLIT: `prepareDebrief(deps)` (sync: signals + fallback + FinalAnswerProduced event) + `synthesizeRichDebriefAndPersist(deps, debriefInput)` (LLM + DebriefCompleted + store.save). |
| `packages/runtime/src/execution-engine.ts` | Call `prepareDebrief` inline; `result.debrief = fallback`; `Effect.forkDaemon` the rich path; attach `Fiber` to result internal field `_debriefFiber`. |
| `packages/runtime/src/builder/types.ts` | `AgentResult.debriefRich?: () => Promise<AgentDebrief \| undefined>`. |
| `packages/runtime/src/reactive-agent.ts` | Map `_debriefFiber` → `result.debriefRich()`; track pending fibers; `dispose()` awaits them; `getLastDebrief()` updated by fiber completion. |
| `packages/runtime/tests/debrief-fork.test.ts` | NEW. run() returns before rich debrief completes; debriefRich() resolves rich; dispose() awaits persist; trivial path unaffected. |

**Out of scope:** local-learning fork (lever #2 — smaller DB writes; separate follow-up if measured worth it). qwen3 decode / numCtx (#3/#4).

---

## Tasks

### Task 1: Split debrief-synthesis into prepare + forked-rich
RED: a test that `prepareDebrief` returns a fallback debrief + signals without making an LLM call (test provider call-count==answer-only).
GREEN: extract. `prepareDebrief` emits FinalAnswerProduced, computes toolStats/errorsFromLoop/executionDurationMs/debriefInput/isTrivial/fallbackDebrief. `synthesizeRichDebriefAndPersist` does the LLM call (non-trivial+memory+LLM) → DebriefCompleted → store.save; returns `{debrief, tokensUsed}`.

### Task 2: Fork in execution-engine
RED: test asserting run() wall-clock excludes the debrief LLM latency (mock a slow debrief LLM; assert run() returns fast; debriefRich() awaits it).
GREEN: inline `prepareDebrief`; `result.debrief = fallbackDebrief`; if shouldSynthesizeLLM → `const fiber = yield* Effect.forkDaemon(synthesizeRichDebriefAndPersist(...))`; attach to `result` as non-enumerable `_debriefFiber`. errorsFromLoop/executionDurationMs come from prepare (unchanged downstream).

### Task 3: Surface debriefRich() + lifecycle on the agent
RED: `result.debriefRich()` resolves to the LLM-rich debrief; `agent.getLastDebrief()` returns rich after await; `dispose()` after `run()` persists the debrief (DebriefStore has the row).
GREEN: reactive-agent maps `_debriefFiber`→`debriefRich = () => runtime.runPromise(Fiber.join(fiber))`; push fiber to `this._pendingDebriefs`; on resolve set `this._lastDebrief = rich`; `dispose()` awaits `Promise.allSettled(this._pendingDebriefs.map(join))` before `runtime.dispose()`.

### Task 4: Verify + docs
Full runtime suite (ignore as-unknown-as-ceiling). Re-measure with the probe pattern: run() returns ~answer-time; debriefRich() ~+4.7s. Update execution-engine:1059 comment (now TRUE), GH #143 token comment, CHANGELOG, durable/debrief docs if any.
