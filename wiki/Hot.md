---
aliases: [Recent Context]
tags: [meta, session-start]
updated: 2026-05-21
---

# Hot (Recent Context Cache)

**Purpose:** Quick lookup of last session state. Read this first at session start.

---

## Latest Session (2026-05-21, night) — execute-backlog v4 + #74 PR

**Bundle:** `harness-lifecycle-hook-errors` (singleton, #74 HS-14).

- **Fix:** `packages/runtime/src/builder.ts` — both `withHook` harness wrappers (lines 794, 807) previously held `.catch(() => undefined)` + outer `try{}catch{}` with comment "Silently ignore handler errors". Replaced with `invokeUserHookSafely()` helper that catches sync throws + promise rejections and routes through `self._errorHandler` (when set) or `console.warn` fallback. Never silent.
- **Cross-package descope:** issue's "Fix direction" hinted at `AgentEvent.HookFailed`; that would touch `@reactive-agents/core` (event-bus.ts union). Restricted to runtime-only per Phase 2 hard gate; HookFailed event = follow-up bundle.
- **Test discipline pivot (skill amendment trigger):** initial integration tests with `withTestScenario` + `withReasoning()` failed because `withTestScenario` short-circuits the reactive loop and `runPhaseHooks` at `runner.ts:683` is never reached. Probes confirmed `withHook` registration ran but the wrapper never fired. Rewrote 6 tests to drive the wrappers directly via `RegistrationHarness._collected` — unit-tests the swallow site rather than the full kernel.
- **Verified-by recheck:** `grep -c '.catch(() => undefined)' builder.ts` → 0 (was 3 — the remaining `.catch((e) => { ... })` at line 2050 is a non-empty Effect.runPromise handler, unrelated).
- **Suite:** runtime 798/0/1-skip (was 792/0/1, +6 new tests). Build 38/38.
- **Pre-existing red surfaced:** `tsc --noEmit` shows `focusedTools` error at `runtime-construction.ts:337` — already filed as #93. Not a regression; bundle proceeded per baseline rule (build is authoritative).
- **Branch:** `bundle/harness-lifecycle-hook-errors`; **PR:** #97.

---

## Previous Session (2026-05-21, evening) — execute-backlog v3 + #71 PR

**Bundle:** `ri-handlers-state-shape` (singleton, #71 HS-06).

- **Fix:** new `packages/reactive-intelligence/src/controller/handler-state.ts` defining `HandlerState = Readonly<KernelStateLike> & {currentOptions?, activatedSkills?, controllerDecisionLog?, currentStrategy?}` + `asHandlerState()` boundary helper. 7 untyped reads across 7 handler files migrated to typed accesses; single named cast at boundary.
- **Architectural call:** mirrored `PatchedState` precedent at `patch-applier.ts:4` — local widening keeps the change inside `reactive-intelligence`. `KernelStateLike` in `@reactive-agents/core` untouched (cross-package extension was the issue body's "OR" alternative).
- **`context-compress.ts` dead-cast:** `(state as any).tokens` was already on `KernelStateLike`. Removed the cast entirely instead of routing through widening.
- **Verified-by recheck:** `grep '(state as any)' …/handlers/` → 0 (was 3); `grep 'as unknown as {' …/handlers/` → 0 (was 4); total 7 sites → 1 named boundary cast.
- **Suite:** reactive-intelligence 455/0/3-skip; build 38/38.
- **Branch:** `bundle/ri-handlers-state-shape`; **PR:** #96.
- **Skill amendment (v3):** Phase 1 drift check expanded to grep semantic-equivalent patterns (`as any` ↔ `as unknown as`) before declaring drift — this pass would have false-positived without it (issue claimed 7 sites; primary grep found 3; the gap was the narrowing variant, not real drift).
- **Note on parallel PR #95:** previous bundle `providers-adapter-typing` (#68) is still open; this bundle branched off `origin/main` clean and does not depend on it.

---

## Previous Session (2026-05-21, late) — execute-backlog v1 + #72 PR

**Bundle:** `runtime-builder-state-typing` (singleton, #72 HS-07).

- **Fix:** `packages/runtime/src/builder/to-config.ts` — replaced 7 `as any` reads of `_*Options` with proper interface types (`ReasoningOptions`, `ToolsOptions`, `GuardrailsOptions`, `MemoryOptions`, `ObservabilityOptions`, `CostTrackingOptions`, `VerificationOptions`). Verified-by recheck `grep -c 'as any' …to-config.ts` → 0 (was 7).
- **Suite:** 5321 pass / 0 fail / 26 skip workspace-wide; build 38/38 green.
- **Branch:** `bundle/runtime-builder-state-typing`; PR pending.
- **Skill amendment (per user feedback this session):** `execute-backlog` now mandates Phase 3.5 BRANCH (clean tree off `origin/main`) and Phase 6a per-bundle PR with `Closes #N` (no direct-to-main pushes).
- **Pre-existing red flagged:** `runtime-construction.ts:337` passes `focusedTools` to `RuntimeOptions` literal that doesn't declare it. Was hidden by `as any` widening. Follow-up issue filed.
- **Descoped from bundle:** #73 (cross-package; needs `LLMResponse.model` + kernel context type edits — spawn `kernel-context-typing` bundle next). #68/#69/#71 also deferred per per-package anti-pattern rule. #83 has no `verified-by`; commented requesting evidence.

---

## Previous Session (2026-05-21) — Full architecture audit + GH issue migration

**Outcome:** Single-source-of-truth migration to GitHub. 25 new issues filed (#68-#92) covering all open HS-NN items + AGENTS.md Architecture Debt rows + 1 known issue. All added to "Reactive Agents Roadmap" project board (project 1).

**Stale-claim corrections committed (`aab68353`):**
- HS-18/HS-22: misframed, re-verified and marked FIXED in Running Issues Log
- HS-19: execution-engine.ts 1656 LOC (was 1648 — drift +8)
- HS-31: 55 `as unknown as` casts in tests (was 74 — grep counted match-lines)
- AGENTS.md kernel paths: `strategies/kernel/phases/` → `kernel/capabilities/` (Stage 5 reorg)
- AGENTS.md evidence-grounding: `kernel/utils/` → `kernel/capabilities/verify/`
- AGENTS.md tool count: 9 meta-tools (was 8 — discover-tools was missing)
- AGENTS.md tests: 5,317 (was 5,294)

**New GH infra:**
- `.github/ISSUE_TEMPLATE/architecture-debt.yml` — structural problem template
- `.github/ISSUE_TEMPLATE/audit-finding.yml` — REQUIRES `verified-by` line
- Labels: `health-sweep`, `architecture-debt`, `verified`, `audit-2026-05-21`, `priority:p3`

**Pattern detected (3/31 inflation):** HS-18/22/31 each shipped with bad framing — grep-without-semantic-verify. **Process fix:** `codebase-health-sweep` skill requires `verified-by:` line citing file:line evidence on every finding.

**Where to go next:** the GH project board (https://github.com/users/tylerjrbuell/projects/1) is now the canonical backlog. Filter by `audit-2026-05-21` label for the migration batch; by `health-sweep` for all sweep findings; by `priority:p1` for next-milestone work.

---

## Previous Session (2026-05-19) — Tier 0 honesty sweep

Ownership pass after v0.11.1. Artifact: `wiki/Research/2026-05-19-framework-state-and-priorities.md` (state + priority tiers + verified scope corrections).

**Shipped (10 commits unpushed → push pending):**
- `e8dc8b20` **build-unblock** — HEAD DTS was RED (`runtime.ts` `leanModeVerifier` missing required `softFail`; `a368a186` fixed only the sibling `noopVerifier`). `main` could not publish. Full build now 38/38 green.
- **Killswitch honesty sweep — 3 of 6 killswitches were broken in shipped v0.11.1:**
  - `c7fa29c2` `confidenceFloor` **unshipped** — `before('verify')` never fires + `state.verifierScore` phantom; fix = mechanism change (N=3-gated), unship was in-scope.
  - `035f4765` `watchdog` **fixed** — progress reset rode dead `tap('observation.tool-result')` (no emit site) → froze at construction, killed healthy agents → re-targeted to `after('act')`.
  - `0460aaad` `requireApprovalFor` **fixed** — read phantom `state.pendingToolCalls` (real: `state.meta.pendingNativeToolCalls`) → safety gate silently approved everything.
  - `budgetLimit`/`timeoutAfter`/`maxIterations` verified sound.
- **Lesson:** every broken killswitch had isolation tests feeding the buggy shape (false-pass). Killswitch tests must use real runtime state shape + real fire path.

**Scope corrections (verified, in artifact §4b):**
- `experienceSummary` (`context-manager.ts:272`) is **not a 1d wire** — `materializeExperienceSummary` never called at runtime, no `ToolCallObservation` ever written to store. It IS the M6/M10 loop → Phase 1.5, N=3-gated.
- `authorize()` is **not "one seam"** — identity/reasoning/runtime zero cross-refs; real multi-day cross-package wire + coupling decision. Tier 0 cheap alt = audit/unship the delegation-enforcement *claims* in docs/README.

**Next:** push 10 commits; then user decides — finish Tier 0 with the security-claims doc audit (½ day) vs open a properly-scoped Phase 1.5 unit (M6/M10/M14 or the real authorize() wire — each its own approval). Do NOT conflate the doc audit and the authorize() wire.

---

## Previous Session (2026-05-14, night+2)

### Phase D — `code-action` strategy — COMPLETE ✅

6th reasoning strategy: LLM generates TypeScript IIFE, runs in Worker-thread sandbox.

**What shipped:**
- `packages/reasoning/src/strategies/code-action.ts` — full `executeCodeAction` Effect function with plan→execute→observe→reflect loop
- `code-action/tool-binding.ts` — `generateToolBindings(ToolSpec[])` → TS function signatures for LLM prompt
- `code-action/sandbox-worker.ts` + `sandbox.ts` — Worker thread sandbox; tool calls route back via postMessage round-trips
- `code-action/code-action-plan.ts` — `buildPlanPrompt` + `extractCodeBlock`
- `code-action/code-action-observe.ts` — `formatObservationMessage`
- `code-action/code-action-reflect.ts` — `shouldTerminate(verdict, iteration, maxIterations)`
- `"code-action"` added to `ReasoningStrategy` union in `@reactive-agents/core`
- `strategy-registry.ts` — registered as 7th strategy
- **32/32 tests pass** across 6 test files; 1143/1143 reasoning tests pass (no regressions)
- Docs: `features/code-action.mdx` (sidebar order 16, `@experimental`)
- **9 commits**: `62f1c5a4` → `<latest>`

**Key design decisions:**
- Bypasses kernel entirely — no `runKernel`/`reactKernel` used; own plan→execute loop
- ToolService is optional (`Effect.serviceOption`) — code-action works without tools (pure computation)
- Tool handlers bridge via `Effect.runPromise(toolSvc.execute(...))` from Worker postMessage callbacks
- Uses `noopVerifier` by default (code-action is its own judge); caller can inject custom verifier via `CodeActionInput.verifier`
- Token efficiency validated: 11/11 offline tasks pass; code-action beats reactive token estimates on 10/10 pure-compute cases

**Deferred to v0.11.2:** Real LLM benchmark vs reactive on qwen3:14b, ToolService fiber context safety audit for `Effect.runPromise` in Worker callback.

---

## Previous Latest Session (2026-05-14, night)

### `@reactive-agents/observe` — COMPLETE ✅

New `packages/observe/` ships v0.11 OTel exporter (Phase C item).

**What shipped:**
- New package `@reactive-agents/observe`, v0.11.0. Bridges `EventBus` `AgentEvent` stream → OpenInference-compliant OTel spans.
- `OpenInferenceTracerLayer` — Effect `Layer.scopedDiscard` subscribing to EventBus. Maps 5 event pairs: `AgentStarted/Completed` (workflow span), `LLMRequestStarted/Completed` (LLM child span), `ToolCallStarted/Completed` (tool child span).
- Uses `otelApi.ROOT_CONTEXT` (not `context.active()`) as parent base — correct in Effect fiber context.
- `setupOpenInferenceExporter(config)` + `autoConfigureExporter(config)` — OTLP HTTP; zero-config when `OTEL_EXPORTER_OTLP_ENDPOINT` set.
- Deps: `@opentelemetry/api`, `@opentelemetry/sdk-trace-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/resources`.
- **8/8 tests pass** (in-memory exporter, verifies span hierarchy + parent IDs + attributes + token estimates).
- Build clean: ESM 27.78 KB, DTS 1.44 KB.
- Changeset: `.changeset/observe-initial.md` (minor).
- Docs: `apps/docs/src/content/docs/features/observe.mdx` (sidebar order 21). Docs build: 78 pages, all links valid.
- **NOT added to `reactive-agents` umbrella** — standalone opt-in like `@reactive-agents/replay` and `@reactive-agents/diagnose`.
- **Deferred to v0.11.1:** LangfuseExporter, BraintrustExporter, sampling, `ReasoningStepCompleted` nesting.

**Files:** `packages/observe/package.json`, `tsconfig.json`, `src/{index,tracer,otlp}.ts`, `tests/tracer.test.ts`, `.changeset/observe-initial.md`, `apps/docs/.../observe.mdx`.

### `create-reactive-agent` docs + verification — COMPLETE ✅

New `packages/create-reactive-agent/` ships v0.11 onboarding multiplier. `npm create reactive-agent my-app` (or bun/pnpm) scaffolds a Reactive Agents starter.

**What shipped:**
- New package, zero runtime deps (readline-based prompts). Built via tsup; `bin: { "create-reactive-agent": "./dist/cli.js" }`.
- 3 templates: `minimal` (single-file agent), `with-tools` (built-in tools layer), `streaming` (`agent.runStream()`).
- 4 providers: `anthropic`, `openai`, `google`, `ollama`. Each emits correct env-var check, default model, and `.withProvider()` wiring.
- 4 package managers detected from `npm_config_user_agent`: bun/npm/pnpm/yarn. npm path uses `tsx`; bun path uses `bun run`.
- Interactive + non-interactive flags (`--template`, `--provider`, `--pm`, `--yes`).
- 34/34 tests pass. Build clean (dts + cli). Smoke-tested via `bun src/cli.ts` and `node dist/cli.js`.
- Changeset: `.changeset/create-reactive-agent-initial.md` (minor).

**Files:** `package.json`, `tsconfig.json`, `src/{cli,index,types}.ts`, `src/lib/{prompts,scaffold,provider-config}.ts`, `src/templates/{index,shared,minimal,with-tools,streaming}.ts`, `tests/scaffold.test.ts`, `README.md`, `CHANGELOG.md`.

### Pushed 16 backlog commits to origin/main

`git push origin main` — main now in sync.

---

## Previous Session (2026-05-14)

### Snapshot/Replay v0.11 — COMPLETE ✅

New `@reactive-agents/replay` package shipped. Phase C v0.11 differentiator landed.

**What shipped:**
- New package `packages/replay/` — full surface: `loadRecordedRun`, `replay`, `makeReplayController`, `makeReplayToolLayer`, `diffTraces`, `computeArgsHash`
- `ToolCallCompleted` event payload extended with `args` / `result` / `error` / `resultTruncated` (backward compatible)
- 3 emission sites updated: `kernel-hooks.ts`, `inline-act.ts` (runtime), `plan-execute.ts`
- Trace recorder (`trace/src/layer.ts`) projects new fields with 8KB truncation guard + JSON.stringify try/catch for unserializable
- `rax-diagnose replay-run <runId>` CLI subcommand (summary mode)
- Docs: `features/snapshot-replay.mdx` + index card + stability marker
- **24/24 replay package tests pass.** Gate test `layer-override.test.ts` pins `Layer.merge(live, replay)` priority — replay layer wins.
- **Deferred to v0.11.1:** full end-to-end determinism integration test (builder + TestLLMServiceLayer + replay layer → assert `outputDiff.equal === true`). Layer-override mechanism + tool-result freezing are pinned today; full-loop determinism manually verified, not gated.

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

**Last Updated:** 2026-05-14 (evening)
**Current Phase:** C (v0.11 Launch) — Compose API + Snapshot/Replay + Skill Persistence + `create-reactive-agent` CLI shipped; remaining: Playground, `@reactive-agents/observe` OTel, GH Projects board
**Next Review:** After v0.11.0 ships
