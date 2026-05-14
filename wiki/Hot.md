---
aliases: [Recent Context]
tags: [meta, session-start]
updated: 2026-05-14
---

# Hot (Recent Context Cache)

**Purpose:** Quick lookup of last session state. Read this first at session start.

---

## Latest Session (2026-05-14)

### Snapshot/Replay v0.11 — COMPLETE ✅

New `@reactive-agents/replay` package shipped. Phase C v0.11 differentiator landed.

**What shipped:**
- New package `packages/replay/` — full surface: `loadRecordedRun`, `replay`, `makeReplayController`, `makeReplayToolLayer`, `diffTraces`, `computeArgsHash`
- `ToolCallCompleted` event payload extended with `args` / `result` / `error` / `resultTruncated` (backward compatible)
- 3 emission sites updated: `kernel-hooks.ts`, `inline-act.ts` (runtime), `plan-execute.ts`
- Trace recorder (`trace/src/layer.ts`) projects new fields with 8KB truncation guard + JSON.stringify try/catch for unserializable
- `rax-diagnose replay-run <runId>` CLI subcommand (summary mode)
- Docs: `features/snapshot-replay.mdx` + index card + stability marker
- **25/25 replay package tests pass.** Gate test `layer-override.test.ts` pins `Layer.merge(live, replay)` priority — replay layer wins.

**Integration pattern:**
```typescript
const ctrl = makeReplayController(run.toolTable)
const layer = makeReplayToolLayer(ctrl, "strict")
new ReactiveAgentBuilder().withLayers(layer).build()
```
No new builder method needed — existing `.withLayers()` (`builder.ts:1895`) wired through `Layer.merge(runtime, options.extraLayers)` at `runtime.ts:1625`.

### Public ROADMAP aligned to North Star v5.0 ✅

`ROADMAP.md` rewritten for v0.10.6 reality. Phase A/B shipped, Phase C in flight. Phase C #3 closed.

---

## Previous Session (2026-05-13, late afternoon)

### Wave D — Killswitches Implementation — COMPLETE ✅

Committed. All tests pass (5128/5128 total, 1150+/1150+ reasoning, 24/24 compose).

**What shipped:**
- **Task 0 (BLOCKER)**: Wired `HarnessPipeline.collectPhaseHooks()` into kernel execution:
  - `runner.ts:616`: Added bootstrap hooks (fire once before loop)
  - `runner.ts:649–657`: Added before/after 'think' hooks (per-iteration)
  - `runner.ts:1410`: Added 'complete' hooks (fire once after loop exits)
  - `act.ts:1023+`: Added before/after 'act' hooks (per-tool-batch)
  - Helper function `runPhaseHooks()` handles abort signals properly

- **packages/compose**: New package with 6 prebuilt killswitches:
  - `maxIterations`: Stop/terminate after N iterations (number or options)
  - `budgetLimit`: Stop/terminate when token budget exceeded (maxTokens or maxCostUSD)
  - `timeoutAfter`: Stop/terminate after wall-clock time ('60s', '5m', milliseconds)
  - `watchdog`: Stop/terminate on no progress for duration (resets on tool-result)
  - `requireApprovalFor`: Gate specific tool calls with synchronous approver
  - `confidenceFloor`: Early exit when verifier confidence >= threshold

- **Test coverage**: 24 comprehensive tests for killswitches covering:
  - Normal abort paths (stop vs terminate)
  - Below-threshold paths
  - Options variants (custom onTrigger, custom onDeny)
  - Timer cleanup, progress reset, threshold checks
  - Registry completeness

**Architecture:**
- Killswitches are pure `(harness: Harness) => void` factories
- All use phase hooks (no new TagMap entries needed)
- Watchdog uses `.tap('observation.tool-result')` to reset progress timer
- Timeout uses `.before('bootstrap')` / `.after('complete')` for lifecycle
- All return `undefined` when condition not met (hook continuation)
- All return `{ abort: 'stop'|'terminate', reason: string }` when trigger

**Key insight:** Phase hooks unblock composition patterns. Before Wave D, hooks were registered but never called (zero call sites). Now killswitches can implement real guardrails on top of the core execution loop.

**Next:** Wave E (sugar desugaring) and Wave F (docs) previously shipped. Phase B (Compose API) complete. Phase C (v0.11 launch readiness) unblocked.

---

### Wave F — Compose API Documentation — COMPLETE ✅

Committed. Docs site builds successfully with all internal links valid.

**What shipped:**
- `compose-api.mdx` — Full API reference covering `.compose()`, harness transforms (`.on()`, `.tap()`), phase hooks (`.before()`, `.after()`, `.onError()`), pattern matching (wildcard, predicate), transform semantics, 12-phase pipeline, context fields, killswitches
- `harness-tags.mdx` — Complete 7-tag catalog (Wave A–D): `prompt.system`, `nudge.loop-detected`, `nudge.healing-failure`, `message.tool-result`, `observation.tool-result`, `lifecycle.failure`, `control.strategy-evaluated` with payloads, contexts, and usage examples
- `composition-recipes.mdx` — 9 production-ready patterns: compliance/PII redaction, localization, multi-tenant context, A/B testing, bare-LLM ablation, custom termination, healing transparency, cost-aware routing, OpenTelemetry export
- `stability.md` updated: `.compose()` and all harness methods marked `@stable`
- `index.mdx` updated: new "Compose API" section with links to all three docs + killswitches introduction

**Key milestone:** Phase B (Compose API) complete. Phase C (v0.11 launch readiness) unblocked.

---

### Wave E — Builder Sugar Desugaring — COMPLETE ✅

Committed. All tests pass (685/685 runtime, no regressions).

**What shipped:**
- `.compose()` method: exact alias for `.withHarness()` (line 407–415 builder.ts)
- `.withSystemPrompt()` desugared: now registers `h.on('prompt.system', () => prompt)` alongside `_systemPrompt` field
- `.withErrorHandler()` desugared: now registers `h.onError('*', ...)` handler alongside `_errorHandler` field
- `.withHook()` adapted: now registers as harness phase hook (`before`/`after`/`onError`) alongside Effect-based `_hooks` array
- **Backward compatible**: all old fields (`_systemPrompt`, `_errorHandler`, `_hooks`) continue to work; desugaring is purely additive
- Test coverage: 13 tests in `compose-desugar.test.ts` (equivalence + regression + backward compat)

**Key insight:** Wave E desugars the old builder API *through* the Wave A–C harness infrastructure without breaking existing code. No new public types, no builder-field removal. Desugar scope limited to methods with live harness infrastructure (`prompt.system`, `onError` hooks, phase hooks); skipped methods without TagMap entries (`withCustomTermination`, `withProgressCheckpoint`, `withVerificationStep`).

---

### RunHandle / RunController — COMPLETE ✅

Commit `10349187`. All tests pass (672/672 runtime, 1126/1126 reasoning).

**What shipped:**
- `RunController`: state machine (pause/resume/stop/terminate/markCompleted) with `checkpoint()` awaited at top of kernel while-loop in `runner.ts`
- `RunControllerRef`: `FiberRef<RunControllerLike|null>` in `@reactive-agents/core` (same pattern as `StreamingTextCallback`; set inside `forkDaemon` chain in `executeStream`)
- `RunHandle`: `AsyncGenerator<AgentStreamEvent> & { pause/resume/stop/terminate/status }` — fully backward-compatible
- `terminate()` fires existing `AbortController` → `StreamCancelled` path
- `stop()` sets flag; `checkpoint()` returns `{stop:true}` → kernel breaks loop → synthesis → `StreamCompleted`
- 21 tests: 14 RunController unit + 7 RunHandle integration
- Key FiberRef fix: `RunControllerRef.set` chained inside same `.pipe()` as `StreamingTextCallback.set` + `execute(task)`, so daemon inherits it

**Exported from `@reactive-agents/runtime`:** `RunHandle`, `RunStatus`, `RunController`, `RunControllerLike`

---

## Previous Session (2026-05-13, morning)

### Compose API Wave C — COMPLETE ✅

Commits `3ee63af7` → `16fa1ab4`. All tests pass (1879/1879).

**What shipped:**
- `fix(workspace)`: all 24 packages' `@reactive-agents/*` deps changed from pinned `"0.10.6"` to `"workspace:*"`. Shadow `node_modules/@reactive-agents/` dirs deleted. TS2322 DTS failure cannot recur. `bun.lock` updated.
- `fix(runtime)`: compose metadata types (`compositionType`/`stages`/`results`/`candidates`) added to `AgentResultMetadata`; all `as any` casts removed from compose.ts + tests.
- `feat(compose) Wave C`: two new live chokepoints:
  - `nudge.loop-detected` — `think.ts` calls `pipeline.transform()` when loop detected; result stored as `loopDetectedMessage` on `GuidanceContext`; `buildGuidanceSection` uses it when set.
  - `message.tool-result` — `act.ts` post-IIFE loop transforms each `tool_result` `KernelMessage`; merges result onto original to preserve `storedKey`.

**v0.12 deferred chokepoints** (registrations compile but transforms are pass-through):
- `nudge.healing-failure`, `observation.tool-result`

### Compose API Wave B — COMPLETE ✅ (earlier this session)

Commits `d8cec216` → `72bc3727`. `prompt.system` chokepoint live in both inline and reasoning paths. Example `apps/examples/src/advanced/20-compose-harness.ts` PASSES.

---

## Previous Session (2026-05-12, evening)

### M3 REWORK Implemented ✅

Commit `051c22be` — 1126/1126 tests pass.

- Removed terminal retry loop (runner.ts sites 1 + 2)
- Retained post-loop pass/fail gate (site 3, ~runner.ts:1547)
- Removed dead vars: `verifierRetries`, `maxVerifierRetries`, `verifierRetryPolicy`, `defaultVerifierRetryPolicy`
- Removed `DEBUG_VERIFIER` env-var logging (superseded by trace events)
- Updated Pivot A test to assert no-retry behavior
- Decision doc: `wiki/Decisions/2026-05-12-m3-terminal-verifier-rework.md`
- Issue #5 (strategy switching) closed; Issue #6 updated to REWORK IN PROGRESS

### Issue #7 Implemented ✅

Commit `4c3cdd1c` — `.withLeanHarness()` added to `ReactiveAgentBuilder`.
- Injects no-op verifier (always passes terminal gate) + disables strategy switching
- Wired through `runtime.ts` → `RuntimeOptions.leanHarness` → `KernelInput.verifier`
- All 1126+753 tests pass
- Empirical basis: NLAH §3 — full harness 13.6× tokens, −0.8pp on frontier models

### Issue #3 Re-scoped ✅

Commit `latest` — terminal retry surface removed by M3 REWORK; no tuning possible.
- `retry-context.ts`, `defaultVerifierRetryPolicy`, `improvedVerifierRetryPolicy` are orphaned public API
- Active FM-A1 mitigation: `oracle-nudge.ts` (Pivot B, already shipped)
- Before v0.11: clean up orphaned exports + `KernelInput.verifierRetryPolicy` (semver consideration)
- Stale verifier retry-budget comment in runner.ts removed

### Clean ablation re-run complete (task b36gfxia2) ✅

5 tasks × 3 models × 2 variants = 30 dispatches. Fixed judge (system prompt + JSON extraction). Verdict: **INCONCLUSIVE** — no pre-stated rule fires at ≥2/3 model threshold. REWORK stands (no reversion warranted). gpt-4o-mini reversal (+5pp ra-full, +15% tokens) is the one KEEP-qualifying signal — worth monitoring post-v0.11. **Issue #6 closed.**

---

## Previous Session (2026-05-12, afternoon)

### M3 Verifier Ablation — Complete ✅

**Verdict: 🔄 REWORK** — disable terminal retry loop; retain heuristic gate.

| Model | ra-full acc | noop acc | Δ | ra-full tokens | noop tokens |
|---|---|---|---|---|---|
| qwen3:14b | 10% | 11% | noop +1pp | 101,795 | 96,596 |
| cogito:14b | 17% | 18% | noop +1pp | 112,962 | 120,215 |
| gpt-4o-mini | 8% | 7% | ra-full +1pp | 162,955 | 176,675 |
| **All** | **12%** | **12%** | **0pp** | | |

Pre-stated REWORK rule fires (≥2/3 models noop ≥ ra-full). Token overhead absent or negative. Retry loop is not converting guard detections into accuracy improvements. Evidence: `wiki/Research/Harness-Reports/phase-1.5-m3-ablation-2026-05-12.md`.

**Caveat:** 84% judge parse failure rate — margins are within noise. Verdict provisional until judge upgraded to structured output (JSON schema via tool-use).

**Next M3 action:** Disable retry at `runner.ts:568` (0.5 day). Separate: cogito FM-A1 retry prompt tuning (Issue #3) is unrelated — still open.

### Other fixes shipped (2026-05-12)
- `fix(judge-server): extract JSON from LLM response before parsing` (`989bee1a`)
- Strategy switching now **on by default** (`enableStrategySwitching !== false`)
- Issues log updated: #1/#2 closed, #5 split, #7 (Pruning Principle gap) added
- `test.ts` moved to `examples/spot-test.ts`

---

## Previous Session (2026-05-11)

### Harness Research Integration — Three Papers Verified ✅

Four March 2026 papers reviewed; all quantitative claims verified against primary sources before any changes were made.

| Finding | Source | Impact |
|---|---|---|
| Verifier gates net-negative: -0.8pp SWE, -8.4pp OSWorld | Tsinghua NLAH (arXiv:2603.25723) | M3 ablation-gated in Phase 1.5 roadmap; kernel heuristic verifier already correct (finding applies to LLM-as-judge, not our guard) |
| Self-evolution most consistent positive module: +4.8pp SWE, +2.7pp OSWorld | Same | M14 added to Phase 1.5 as Compose API hook |
| File-backed state also positive: +1.6pp SWE, +5.5pp OSWorld | Same | Confirms SQLite session history (gateway-chat) was correct |
| Adding full harness costs 13.6× tokens and is 0.8pp *worse* | Same | Pruning Principle added to North Star §9 |
| Raw traces essential: 50% → 34.6% accuracy without them | Stanford Meta-Harness (arXiv:2603.28052) | `@reactive-agents/trace` + Snapshot/Replay are critical path |
| Harness transfers across 5 models (+4.7pp avg) | Same | Strengthens M7 calibration consumer priority |

### North Star v5.0 Promoted ✅

Canonical doc: `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md`
Design spec: `wiki/Architecture/Design-Specs/2026-05-11-harness-research-integration.md`

### v0.10.6 Shipped ✅

All packages on npm. All P1 issues resolved.

---

## What's Next

### Pre-Phase-B Gate: M3 Ablation (1 day)

Run the M3 ablation before starting Compose API Wave A. Temporarily pass a `noopVerifier` via `KernelInput.verifier` in a dev test harness, run gate corpus (20+ tasks), measure accuracy delta. Note: the NLAH finding is for LLM-as-judge gates; our `defaultVerifier` is a heuristic guard — ablation determines whether the same pattern holds here. Result informs Phase 1.5 M3 priority.

### Immediate: Phase B — Compose API Wave A

**Start with Wave A** — `harness-pipeline.ts` registry + resolver, generated tag catalog, `TagMap`/`PayloadFor`/`ContextFor`, and `.compose()` on the builder.

**Why first:** Phase A W23/W24/W25 decomposed the runtime enough for clean injection points. Compose API is the v0.11 differentiator and critical path.

Before implementation, decide how to handle the existing `runtime/src/compose.ts` functional composition API so naming does not collide with harness composition.

### Parallel: Phase 1.5

M3/M6/M7/M8/M10 can run concurrently with Phase A — different files, no conflicts.

---

## Authoritative Document Hierarchy

| Order | Doc | What it tells you |
|---|---|---|
| 1 | `00-VISION.md` | Eight pillars. Stable anchor — never amended. |
| 2 | **`05-DESIGN-NORTH-STAR.md` v4.0** | **Architecture + full forward plan (Phases A–G). Read this.** |
| 3 | `01-RESEARCH-DISCIPLINE.md` | 12 rules for any harness change |
| 4 | `02-FAILURE-MODES.md` | Failure mode catalog |
| 5 | `03-IMPROVEMENT-PIPELINE.md` | How discoveries flow into harness changes |
| 6 | `04-PROJECT-STATE.md` | Cold session framing |
| — | `2026-05-06-compose-harness-api.md` | Compose API design spec (Phase B detail) |
| — | `2026-05-06-v0.11-launch-readiness.md` | v0.11 tactical rollout (Phase C detail) |

---

## Key Decisions (May 7, 2026)

1. **North Star v4.0 is the single forward-planning document** — no more sprawl across roadmap + improvement roadmap + launch checklist
2. **Phase A (decomposition) before Compose API** — bolting new API onto 6K-line builder creates debt in every subsequent wave
3. **Snapshot/Replay promoted to v0.11 (Phase C)** — unique auditable-by-demo capability, 1-week build on existing `packages/trace`
4. **`04-PROJECT-STATE.md` retained** — different framing purpose from §2 of North Star
5. **Root `ROADMAP.md` alignment is a Phase C gate** — public roadmap must match this plan before v0.11.0 ships

---

## How to Update This Note

At session end: replace "Latest Session" with new date + key updates, update "What's Next," add decisions. Keep it under 120 lines.

**Last Updated:** 2026-05-13
**Current Phase:** B (Compose API) — Waves B + C + E complete; 5/5 Wave A–E tasks done; builder desugaring complete
**Next Review:** After v0.11 launch readiness validation
