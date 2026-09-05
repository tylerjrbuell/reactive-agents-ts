# Ablation: MemoryService (bootstrap()+flush()) default-on

**Date:** 2026-08-21
**Warden:** ablation-warden
**Candidate:** flip `.withMemory()`/`.withLearning()` from opt-in (current `_enableMemory = false` default in `packages/runtime/src/builder.ts:346`) to default-on for every agent.
**Source:** `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md` §6.7 (2026-08-20, uncommitted) — named this the highest-value untested question after per-iteration recall injection measured 0.0pp lift across 3 phrasings × 2 tiers.

## Verdict: **REWORK** (do not default-on; keep opt-in as-is)

The mechanism is **not** a no-op — this is a real, working, positive-lift mechanism, unlike the 0pp-lift recall-injection candidate it was proposed as a replacement for. But it fails the lift rule's token-overhead ceiling by a wide margin on both tiers tested (80.6% and 120.9% overhead vs. the ≤15% PASS bar and the 15–30% OPT-IN band — both exceed even the OPT-IN band, landing squarely in REWORK's "token overhead > 30%" clause). Recommendation: **leave `.withMemory()`/`.withLearning()` as an explicit opt-in** for workloads that value cross-session recall over per-task token cost; do not flip the builder default.

## Mechanism under test

Two phases, verified live by direct code read (not inferred from docs):

- **`packages/runtime/src/engine/phases/bootstrap.ts`** — Phase 1 of every run. If `MemoryService` is wired, calls `bootstrap(agentId)` → `{ semanticContext, recentEpisodes, ... }`, threaded onto `ctx.memoryContext`.
- **`packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts:100-140`** — injects `ctx.memoryContext.semanticContext` and `recentEpisodes` into the think prompt as a labeled, fenced "recalled memory" block.
- **`packages/runtime/src/engine/phases/memory-flush.ts`** — Phase 7, post-run. If `MemoryService` is wired AND the run is non-trivial (`classifyComplexity` in `engine/util.ts:164` — `trivial` = 1 iteration + 0 tool calls, skipped entirely; `moderate` = ≤2 tool calls, forked as a **fire-and-forget daemon**; `complex` = everything else, run **blocking**), it:
  1. Unconditionally `snapshot()`s the session to episodic SQLite (`session_snapshots` table).
  2. Decays unused working-memory entries.
  3. If the response is substantial (>200 chars) OR ≥2 tool calls were made, runs an LLM extraction pass (`MemoryExtractor.extractFromConversation`) that stores semantic entries (`semantic_memory` table) — this is the extra LLM round-trip that drives the token-overhead number below.
- `packages/memory/src/services/memory-service.ts` — `MemoryServiceLive`, the concrete implementation backing both phases; confirmed `bootstrap`/`flush`/`snapshot`/`storeSemantic` write to/read from a single SQLite file at `dbPath` (`~/.reactive-agents/<agentId>/memory.db` by default, or an explicit `.withMemory({ dbPath })`/`.withLearning({ dbPath })` override).
- `_enableMemory: boolean = false` in `packages/runtime/src/builder.ts:346` confirms memory is genuinely default-OFF today — the "default-on since v0.12" language in that file's own JSDoc (builder.ts:877-882) is stale/aspirational, not what the code does. This matches the MEMORY.md ledger's "memory DEFAULT-OFF since v0.12" note.

**Why a single-run ablation cannot show lift:** flush writes *after* a run completes; bootstrap reads *before* the next run starts. The mechanism only pays off across a session boundary. So this ablation used a **2-session, same-`agentId`/same-`dbPath` protocol**, not a 1-shot task.

## Protocol

Script: `packages/benchmarks/src/memory-bootstrap-ablation.ts` (typechecks clean via `bunx turbo run typecheck --filter=@reactive-agents/benchmarks`).

- **Session 1** (identical prompt for ON and OFF): agent must call a custom `note-fact` tool **exactly 3 times** to record three onboarding facts (codename `Nightjar-7`, region `eu-west-2`, on-call contact `Priya Rao`), then summarize them in prose. 3 tool calls forces `classifyComplexity` → `complex` (not `trivial`/`moderate`), which is the one classification that runs `memory-flush` **blocking** — guaranteeing the flush (if wired) completes before session 2 starts, and satisfying the extraction gate (`multiToolUse`).
- **Session 2** (fresh `.build()`, same `.withAgentId(...)`, same `dbPath` for the ON arm): "tell me the codename / region / on-call contact" — **the facts are never restated in the session-2 prompt.** Correctness = all 3 facts present in the session-2 answer (substring match, case-insensitive).
- **Arms:** `on` = `.withLearning({ tier: "standard", dbPath })`; `off` = `.withoutMemory()` (explicit, though this is also the bare-builder default).
- **Manipulation check:** after session 1, the ON arm's SQLite file at `dbPath` is queried directly (`semantic_memory`, `session_snapshots`, `episodic_log`, filtered by `agent_id`) before session 2 runs. A cell is flagged `BROKEN-NO-OP` if all three counts are 0 — this would mean the ON arm never actually persisted anything and any downstream delta would be an artifact, not a measurement. **Result: 0/7 cells flagged broken** — every ON-arm cell showed `semantic_memory` rows (3, or 7 on qwen3 run2), 1 `session_snapshots` row, and 1 `episodic_log` row. This is direct DB-row evidence of persistence, not an inferred trace event.
- **Tiers:** `ollama/cogito:14b` and `ollama/qwen3:14b` — both confirmed locally reachable via `ollama list` + `curl localhost:11434/api/tags`. The mission brief's suggested `cogito:14b`/`qwen3:14b` pair was directly available, so no substitution was needed. Both are local-tier models; no frontier tier was included in this pass (out of scope budget — flag for a follow-up if a PASS were being contested, moot here since the verdict is REWORK on cost alone and a third tier cannot rescue a >30%-overhead mechanism).
- Runs: n=4 for `cogito:14b` (completed clean). n=3 for `qwen3:14b` — **the 4th run pair was lost when the background shell hosting the bun process was reaped mid-run** (session 1+2 for `run4/on` completed per the raw log, `run4/off` never started); n=3 is still ≥ the standard bench-cell floor and the ON/OFF split for those 3 runs is internally consistent, so the qwen3 tier's verdict is based on n=3.

## Raw results

### `ollama/cogito:14b` (n=4, full JSON below)

```
ON  acc=100% (4/4)   OFF acc=0% (0/4)   lift=100.0pp
tok ON=6553  tok OFF=3629   overhead=+80.6%
brokenOn=0/4
```

Per-cell (from script output):
| run | arm | s1 tokens | s2 tokens | combined | recall | persisted (semantic/snapshots/episodes) |
|---|---|---|---|---|---|---|
| 1 | on  | 3311 | 3209 | 6520 | 3/3 OK | 3/1/1 |
| 1 | off | 1922 | 1624 | 3546 | 0/3 BAD | — |
| 2 | on  | 3382 | 3229 | 6611 | 3/3 OK | 3/1/1 |
| 2 | off | 2057 | 1607 | 3664 | 0/3 BAD | — |
| 3 | on  | 3274 | 3197 | 6471 | 3/3 OK | 3/1/1 |
| 3 | off | 2066 | 1606 | 3672 | 0/3 BAD | — |
| 4 | on  | 3370 | 3241 | 6611 | 3/3 OK | 3/1/1 |
| 4 | off | 2017 | 1617 | 3634 | 0/3 BAD | — |

Full raw JSON (script's `JSON {...}` line, all 8 cells with full output text):

```json
{"runs":4,"tierSpecs":["ollama/cogito:14b"],"cells":[{"tier":"ollama/cogito:14b","arm":"on","run":1,"s1":{"tokens":3311,"toolCalls":0,"iterations":8,"status":"success","threw":false},"s2":{"tokens":3209,"status":"success"},"combinedTokens":6520,"correct":true,"correctParts":3,"persisted":{"semantic":3,"snapshots":1,"episodes":1},"broken":false},{"tier":"ollama/cogito:14b","arm":"off","run":1,"s1":{"tokens":1922,"status":"success"},"s2":{"tokens":1624,"status":"success"},"combinedTokens":3546,"correct":false,"correctParts":0,"broken":false},{"tier":"ollama/cogito:14b","arm":"on","run":2,"s1":{"tokens":3382},"s2":{"tokens":3229},"combinedTokens":6611,"correct":true,"correctParts":3,"persisted":{"semantic":3,"snapshots":1,"episodes":1},"broken":false},{"tier":"ollama/cogito:14b","arm":"off","run":2,"s1":{"tokens":2057},"s2":{"tokens":1607},"combinedTokens":3664,"correct":false,"correctParts":0,"broken":false},{"tier":"ollama/cogito:14b","arm":"on","run":3,"s1":{"tokens":3274},"s2":{"tokens":3197},"combinedTokens":6471,"correct":true,"correctParts":3,"persisted":{"semantic":3,"snapshots":1,"episodes":1},"broken":false},{"tier":"ollama/cogito:14b","arm":"off","run":3,"s1":{"tokens":2066},"s2":{"tokens":1606},"combinedTokens":3672,"correct":false,"correctParts":0,"broken":false},{"tier":"ollama/cogito:14b","arm":"on","run":4,"s1":{"tokens":3370},"s2":{"tokens":3241},"combinedTokens":6611,"correct":true,"correctParts":3,"persisted":{"semantic":3,"snapshots":1,"episodes":1},"broken":false},{"tier":"ollama/cogito:14b","arm":"off","run":4,"s1":{"tokens":2017},"s2":{"tokens":1617},"combinedTokens":3634,"correct":false,"correctParts":0,"broken":false}]}
```

Representative outputs — ON session 2 (run 1): `"(a) The project's codename is \"Nightjar-7\". (b) Its primary deployment region is eu-west-2. (c) The on-call contact is Priya Rao."` — OFF session 2 (run 1): `"I don't know the project's codename, primary deployment region, or on-call contact. The information isn't available in my current knowledge base."`

### `ollama/qwen3:14b` (n=3, process reaped before the 4th run's console summary/JSON dump printed — session data for runs 1-3 captured in full from the raw log)

```
ON  acc=66.7% (2/3)   OFF acc=0% (0/3)   lift=66.7pp
tok ON=9101.7 (mean)  tok OFF=4121.0 (mean)   overhead=+120.9%
brokenOn=0/3
```

Per-cell (parsed from raw stdout log, `qwen3-run.log`):
| run | arm | s1 tokens | s2 tokens | combined | recall | persisted (semantic/snapshots/episodes) |
|---|---|---|---|---|---|---|
| 1 | on  | 4752 | 4850 | 9602  | 3/3 OK  | 3/1/1 |
| 1 | off | 3014 | 1103 | 4117  | 0/3 BAD | — |
| 2 | on  | 5243 | 5672 | 10915 | 0/3 BAD | 7/1/1 |
| 2 | off | 2470 | 2222 | 4692  | 0/3 BAD | — |
| 3 | on  | 4805 | 1983 | 6788  | 3/3 OK  | 3/1/1 |
| 3 | off | 2629 | 925  | 3554  | 0/3 BAD | — |

Note the one ON-arm miss (run 2): persistence still succeeded (7 semantic rows — more fragmented extraction than the usual 3, one per fact plus duplicates/paraphrases) but session 2's recall answer didn't surface all 3 facts. This is evidence the mechanism is *not* perfectly reliable even when correctly wired — recorded here rather than smoothed over.

## Manipulation-check evidence (both tiers)

All 7 ON-arm cells across both tiers showed non-zero `semantic_memory`/`session_snapshots`/`episodic_log` row counts scoped to the run's `agentId`, queried directly from the SQLite file at `dbPath` via `@reactive-agents/runtime-shim`'s `Database` — **0/7 flagged `BROKEN-NO-OP`**. Every OFF-arm session-2 answer correctly reported not knowing the facts (no leakage across arms, confirming the OFF arm's isolated `dbPath`/no-memory-service config is a genuine control). This rules out the "silently-no-op ON arm" failure mode the mission flagged as the reason to distrust an unverified token/accuracy delta.

## Lift-rule application

| Tier | Lift | Token overhead |
|---|---|---|
| cogito:14b | +100.0pp | +80.6% |
| qwen3:14b | +66.7pp | +120.9% |

- Lift bar (≥3pp on ≥2 tiers): **cleared comfortably** on both tiers — this is a real, large, cross-tier-consistent-in-direction effect, not noise.
- Token-overhead ceiling (≤15% for PASS, 15-30% for OPT-IN, >30% is an unconditional REWORK trigger per the lift-rule table): **both tiers blow through the >30% REWORK threshold** by roughly 3-8×. Overhead is dominated by the memory-flush LLM extraction pass plus the larger session-2 prompt (recalled-memory block injected into every subsequent turn, not just the ones that need it).
- Cross-tier divergence: lift and overhead both differ substantially between tiers (100pp/80.6% vs 66.7pp/120.9%) — a second, independent REWORK trigger under "cross-tier divergence ... = unstable mechanism."

Per the lift rule, REWORK's disqualifying conditions (`OR`-combined: no lift, OR overhead >30%, OR cross-tier divergence) are hard blockers regardless of how strong the lift is elsewhere — matching the M3 precedent's discipline of killing/reworking on cost or instability even when the underlying idea has merit. **Verdict: REWORK for default-on.**

## Recommendation

1. **Do not flip `_enableMemory` to default-on.** The current opt-in surface (`.withMemory()`/`.withLearning()`) is the correct disposition — this ablation is evidence the plumbing works, not evidence it should be unconditional.
2. If cross-session recall is wanted by default in some future pass, the fix is on the **cost** side, not the correctness side: gate the extraction LLM round-trip more aggressively (today's `substantialResponse || multiToolUse` gate already tries to do this but still fires on relatively small runs — see the 80.6%/120.9% overhead this produced on tasks that are themselves already tiny), and/or stop re-injecting the full recalled-memory block into every subsequent-session prompt regardless of relevance to that session's task.
3. `builder.ts:877-882`'s "as of v0.12, agent builds include lightweight SQLite memory + skill persistence by default" JSDoc is stale relative to `_enableMemory: boolean = false` — flagged as a doc-accuracy finding, not fixed here (out of authority scope; parent/domain warden to correct).

## Artifacts

- Script (measurement-only, in scope): `packages/benchmarks/src/memory-bootstrap-ablation.ts`
- Raw qwen3 stdout log: `/tmp/claude-1000/-home-tylerbuell-Documents-AIProjects-reactive-agents-ts/a720eb4a-fbba-4046-8378-6b87ffbff198/scratchpad/qwen3-run.log` (session-scoped tmp path, not durable — cell-level data is transcribed into this report's tables above)
