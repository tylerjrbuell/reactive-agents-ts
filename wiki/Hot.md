---
aliases: [Recent Context]
tags: [meta, session-start]
updated: 2026-05-25
---

# Hot (Recent Context Cache)

**Purpose:** Quick lookup of last session state. Read this first at session start.

---

## Latest Session (2026-05-25) — execute-backlog HS-16 + PR #138

**Bundle: providers-retry-error-accumulation** (commit `f3728a90`, PR #138 open)

- ✅ #75 (HS-16) shipped — 5 LLM providers (anthropic, openai, gemini, local, litellm) now accumulate parse retry errors into `LLMParseError.attempts: ReadonlyArray<ParseAttemptError>` instead of overwriting `lastError = e`. `rawOutput` preserved for back-compat.
- Verified-by: `grep -c parseAttempts.push` → 10 (5 × 2 sites). Workspace gate: build 38/38 + 5648 pass / 0 fail / +3 tests.
- Drift report: all 5 cited line numbers drifted +58 to +190 lines; semantic pattern intact at every site.

**Backlog hygiene (verification-comment-only, no code):**
- #84 (4 `@internal` OpenAI exports leak) — barrel re-export only contains `OpenAIProviderLive`, doesn't leak the cited symbols. Recommended close pending reframe.
- #93 (`focusedTools` typecheck red) — original `RuntimeOptions` error not present; current `@reactive-agents/runtime` typecheck red is now in test files (`unknown→never`), unrelated to original claim. Recommended close or rescope.

---

## Latest Session (2026-05-23) — Phase 0 of Harness Convergence COMPLETE

**Phase 0 closure (5 P0 issues shipped + verified):**
- ✅ #105 M2 — output sanitization (commit b82aac35). Triple-layer: output-assembly + runtime sanitizeOutput + verifier backstop. Cogito 9/9 + qwen3 9/9 clean.
- ✅ #106 M7 — output/status coherence invariant at `buildStrategyResult` (commit 05b7ab8d). 8 new tests.
- ✅ #107 R9 — `DispatchResult.appliedPatches: AppliedPatchRecord[]` preserves decision→patch link (commit 8715fb13). Trace verification confirms zero conflation.
- ✅ #108 R10 — ablation probe `.withReactiveIntelligence(riEnabled)` explicit toggle (commit 1d528861). RI-off cells: disp=0.
- ✅ #109 R11 — triple-surface persistence failure signal: console.warn + Effect.logWarning + tagged ErrorSwallowed (commit af6a9e35).

**Regression: 1193 reasoning + 454 reactive-intelligence + 811 runtime = 2458 tests pass post-Phase-0.**

---

## Prior Sweep (2026-05-23 earlier) — Harness Improvement Loop / Multi-Model Sweep + Convergence Spec + 22 GH Issues

**Outcome:** Full harness audit campaign. 97 evidence-bearing runs across cogito:14b + qwen3:14b + gpt-4o-mini. 10 evidence reports + morph spec + mission statements + optimal algorithm spec landed. 5 North Star amendments applied. **22 GH issues #104–#125** filed under `harness-convergence` + `sweep-2026-05-23` labels.

### Key findings (cross-tier confirmed)

**🔴 P0 surface-trust bugs (Phase 0 of convergence spec):**
- **M1** ~~`result.metadata.totalTokens=0` universal silent loss~~ — **REVERSED 2026-05-23**: probe scripts read wrong field (`totalTokens` doesn't exist; canonical is `tokensUsed`). Framework was always correct. #104 closed as invalid; #126 filed as P2 naming-consistency followup.
- **M2a/b/c** Output leaks — `<rationale call=N>` XML (cogito), `[CRITIQUE N] SATISFIED:` (frontier reflexion), `[find result — compressed preview]` (frontier ToT). Verifier `output-not-harness-parrot` too narrow. (#105)
- **M7** ToT `failed to produce output` → `success=true` propagation bug, cogito + qwen3 + gpt-4o-mini (#106)
- **R9** 3 duplicate event-name pairs for same RI decisions (#107)
- **R10** `interventionsDispatched` non-zero on RI-OFF cells — counter contamination (#108)
- **R11** silent skill persistence failure via `emitErrorSwallowed` swallow (#109)

**🟠 2 cost/quality gates (Phase 0.5):**
- **M3** ToT 3-23× cost on trivial tasks all tiers (#110)
- **M5** Adaptive routing missing cost dimension (#111)

**🟢 8 convergence foundations (Phase 1):**
- 1.1 RI → Compose bridge lights 4 dead tags (#112)
- 1.2 Capability-scoped emit (closes F1) (#113)
- 1.3 `transitionState()` discipline + ESLint rule (170 → ≤10 mutations) (#114)
- 1.4 Required-tool nomination extraction (closes F4/F5) (#115)
- 1.5 ControllerDecision union prune/doc (8 of 13 dead) (#116)
- 1.6 Wire `emitLLMExchange` at provider boundary (#117)
- 1.7 Plan-execute synthetic kernel state contract test (#118)
- 1.8 Triple compression coordination (#119)

**🟡 3 structural (Phase 2):** Open `learn/` capability (#120), multi-severity verifier (#121), cross-session default-on (#122)

**🔵 3 compounding intelligence (Phase 3):** Single Arbitrator (#123), composite confidence signal (#124), capability composition routing (#125)

### Architectural reframe

| Old framing | Sharper framing (evidence-grounded) |
|---|---|
| "Harness needs improvement" | "60% of North Star v5.0 shipped, 40% drifted into 2 anti-patterns" |
| "Strategies bypass kernel" | "5 of 7 use runKernel; outer loops legitimately reimplement (BFS/critique/plan-revision)" |
| "RI is dead weight" | "75% fire rate on failure-corpus; +1 rescue on qwen3; tier-dependent" |
| "Compose ↔ RI parallel substrates" | "Complementary; ~zero overlap; gap = non-coordination (bridge, not subsume)" |

### Single highest-leverage learning

**"Scaffold without callers"** anti-pattern shipped 4× (Compose tags + RI variants + calibration fields + skill persistence). Codified as Anti-Scaffold Principle in North Star §9. Every declared surface element MUST have emit/consumer in same commit. **v0.12 lint discipline.**

### Docs produced this session

**Authoritative:**
- `wiki/Architecture/Specs/06-MISSION-STATEMENTS.md` — 8 pillar missions + 10 capability missions + 5 trait missions + L1/L2/L3 metric ladder + 8 anti-mission boundaries
- `wiki/Architecture/Specs/07-OPTIMAL-EXECUTION-ALGORITHM.md` — canonical per-iter algorithm (10-step) + per-capability success signals + composite signals (S1-S6) + algorithmic invariants
- `wiki/Architecture/Design-Specs/2026-05-23-harness-convergence.md` — 16-section morph spec with 22-issue manifest

**Evidence (all under `wiki/Research/Harness-Reports/`):**
- `sweep-2026-05-23-qwen3-14b.md` — baseline F1-F8
- `architecture-drift-analysis-2026-05-23.md` — initial drift framing
- `capability-mapping-2026-05-23.md` — Q2a: <30% capability-mappable
- `event-coverage-diff-2026-05-23.md` — Q1c: bridge not subsume
- `cross-strategy-matrix-analysis-2026-05-23.md` — Q2b + M1/M2/M3/M5/M7
- `ri-ablation-analysis-2026-05-23.md` — Q1a/b + R9/R10
- `m6-persistence-audit-2026-05-23.md` — R11
- `elegance-robustness-intelligence-audit-2026-05-23.md` — design lens, 22 candidate moves
- `SYNTHESIS-2026-05-23.md` — cross-tier synthesis
- `cross-strategy-matrix-2026-05-23-03:34.json` + `12:01.json` + `ri-ablation-2026-05-23-03:46.json` — raw data

### Probes written this session (reusable)

- `.agents/skills/harness-improvement-loop/scripts/cross-strategy-matrix.ts` — 5 tasks × N strategies × M models matrix probe
- `.agents/skills/harness-improvement-loop/scripts/ri-ablation.ts` — RI on/off ablation across failure scenarios

### What's next

1. **Phase 0 execution** via `/execute-backlog` skill — 6 P0 issues, can bundle into 3-4 PRs
2. M2-class issues (#105) are highest leverage — closes 3 distinct output-leak patterns in one PR
3. M1 (#104) closes universal API lie — single highest user-trust-impact fix
4. Phase 0 gates Phase 0.5/1/2/3 — until result surface tells truth, every higher comparison reads through lying API

### Anti-patterns codified for v0.12+

- Anti-mission #4: NOT a system that hides failure (M7 directly violates)
- Anti-mission #6: NOT advertised-surface-without-callers (R2/R3/R4/R11 violate)
- Anti-Scaffold Principle (North Star §9): every declared surface has emit/consumer in same commit
- Empirical Evidence Cadence (North Star §9): documents bend to reality OR reality bends to documents — never both silently

---

## Previous Session (2026-05-22, mid+2) — execute-backlog v9 + #102 PR + #103 flake issue

**Bundle:** `vue-smoke-tests` (closes #82 entirely alongside #100 + #101).

- **Coverage:** `packages/vue/tests/smoke.test.ts` — 12 tests, 3 surface + 9 behavioral via mocked `fetch`. Vue refs framework-agnostic (per v8 substrate classification).
- **Bug fixed (test+fix combo):** `packages/vue/src/use-agent-stream.ts:76-78` `StreamError` branch threw `new Error(cause)` inside inner JSON.parse try/catch → swallowed → status stuck at `"streaming"` forever. Fix mirrors svelte impl: direct `error.value`/`status.value` assignment. 2-line behavior fix; the failing test is now the regression check.
- **Verified-by recheck:** `find packages/vue -name '*.test.ts*'` → 1 (was 0). Suite: vue 12/0; build 38/38.
- **Branch:** `bundle/vue-smoke-tests`; **PR:** #102.
- **Filed follow-up:** **#103** — recurring `httpbin.org` external-network flake in `packages/tools/tests/builtin-handlers.test.ts`. Confirmed ≥2 occurrences (PR #99 initial CI, this session's workspace run). First instance of skill v7 "track recurring flakes in own issue" rule firing in practice.
- **Skill amendments (v9):** (1) Phase 4 test+fix combo bundles — when behavioral RED surfaces a real bug, fix lands same PR if ≤10 lines + mirrors existing-working sibling + same test acts as regression check; otherwise descope to separate issue. (2) Phase 1 cross-package consistency probe — diff equivalent files across sibling per-framework packages before locking the bundle; divergent behavior in equivalent APIs = latent defect signal.

### Session arc (6 bundles, 6 PRs queued, 1 issue filed)
- 2026-05-21 night → `bundle/harness-lifecycle-hook-errors` (#74 HS-14) → PR #97
- 2026-05-21 night+1 → `bundle/runtime-think-phase-typing` (#73 HS-08) → PR #98
- 2026-05-22 early → `bundle/tests-stale-m1-red-cleanup` (#80 HS-24) → PR #99
- 2026-05-22 mid → `bundle/react-smoke-tests` (#82 react) → PR #100
- 2026-05-22 mid+1 → `bundle/svelte-smoke-tests` (#82 svelte) → PR #101
- 2026-05-22 mid+2 → `bundle/vue-smoke-tests` (#82 vue, +bug fix) → PR #102 + filed #103 (flake)

Total ~3h wall clock for 6 bundles. Skill v3 → v9 across 6 PRs. CI on #97-#101 all green; #102 pending.

### Pattern this session
PRs alternated between two shapes: **typing/refactor bundles** (#97, #98, #99, #80 cleanup) and **test-coverage bundles** (#100/#101/#102 closing #82). Skill amendments specifically codify the shape differences:
- Local widening + boundary helper for typing (v5)
- Dead-code sweep + pure-deletion verified-by triad (v6)
- Substrate-aware test strategy + multi-package split (v7-v8)
- Test+fix combo + cross-package consistency probe (v9)

---

## Previous Session (2026-05-22, mid+1) — execute-backlog v8 + #101 PR

**Bundle:** `svelte-smoke-tests` (#82 partial, svelte portion).

- **Fix:** `packages/svelte/tests/smoke.test.ts` — 13 cases: 4 public-surface + 4 `createAgent` behavioral + 5 `createAgentStream` behavioral. Mock `globalThis.fetch` with `new Response(...)` (JSON + SSE bodies). State transitions captured via `subscribe`.
- **Substrate decision:** Svelte stores are pure JS factories (no render context). Behavioral coverage cheap — got 9 behavioral cases above the smoke ceiling. Stronger than react bundle (#100, 6 smoke only) because the substrate allowed it.
- **SSE happy-path covered;** chunked-buffer fuzz deferred (deltas split across read boundaries — needs multi-chunk fetch mock).
- **Verified-by recheck:** `find packages/svelte -name '*.test.ts*'` → 1 (was 0). Suite: svelte 13/0; build 38/38.
- **Branch:** `bundle/svelte-smoke-tests`; **PR:** #101 (companion to PR #100).
- **Skill amendment (v8):** Phase 3 PLAN — codify substrate-aware test strategy. Three substrate classes (render-bound / framework-agnostic / pure). Default coverage tier matches substrate. Picking wrong tier = scope creep or coverage gap. Bundle #100 vs #101 = case study.

---

## Previous Session (2026-05-22, mid) — execute-backlog v7 + #100 PR

**Bundle:** `react-smoke-tests` (#82 partial, react portion only).

- **Fix:** `packages/react/tests/smoke.test.ts` — 6 public-surface cases (export presence + `AgentStreamEvent._tag` + `AgentHookState` union + return-type shapes). Previously: 0 test files in `packages/react/`.
- **Strategy decision:** pure smoke (no React render). React hooks throw "Invalid hook call" outside render context; adding `@testing-library/react` + `happy-dom` for one smoke test = scope creep. `AgentStreamEvent._tag` assertion IS load-bearing — hook's SSE parser switches on these strings, so type drift surfaces at compile time before silent prod misses.
- **Cross-package descope:** issue cites 3 packages (react/svelte/vue); shipped react only. `bundle/svelte-smoke-tests` + `bundle/vue-smoke-tests` named as follow-ups in PR body.
- **Verified-by recheck:** `find packages/react -name '*.test.ts*'` → 1 (was 0). Suite: react 6/0; build 38/38.
- **Workspace test flake observed:** `packages/diagnose/` shows 2 fails in workspace `bun test` mode but 35/0 in isolation. Same flake class as #99 httpbin. Skill v7 codifies the protocol.
- **Branch:** `bundle/react-smoke-tests`; **PR:** #100.
- **Skill amendments (v7):** (1) Phase 5 workspace-test-flake protocol — accept workspace failures when isolation passes + failure isn't in touched package + not a verified-by recheck. Track recurring flakes in own issue. (2) Phase 2 multi-package test-infra split — same descope rule as typing applies to test-infra issues.

---

## Previous Session (2026-05-22, early) — execute-backlog v6 + #99 PR

**Bundle:** `tests-stale-m1-red-cleanup` (singleton, #80 HS-24).

- **Fix:** `packages/reactive-intelligence/tests/m1-dispatcher-validation.test.ts` — stripped 110-line `test.skip("RED phase…")` placeholder + `computeEntropyStdDev` helper + two dead interfaces (`RIDispatchMetrics`, `M1DispatcherValidationResult`). Kept two surviving smoke tests + `EntropyScore` import. Added top-of-file pointer to `harness-reports/phase-1-mechanism-validation-2026-05-04.md` (M1 ✅ KEEP evidence).
- **Pattern:** dead-code sweep — same instinct as v5 dead-cast sweep, broader application. M1 shipped KEEP per Phase 1 validation; RED placeholder was structurally obsolete.
- **Verified-by recheck:** `grep -n 'test.skip\|computeEntropyStdDev\|RIDispatchMetrics\|M1DispatcherValidationResult' …` → 0 (was 4). Skip count -1 (was 3 → 2).
- **Suite:** reactive-intelligence 455/0/2-skip; build 38/38. File LOC 257 → 77.
- **Branch:** `bundle/tests-stale-m1-red-cleanup`; **PR:** #99.
- **Skill amendments (v6):** (1) Phase 4 dead-code sweep generalized from dead-cast — applies to `test.skip`, helpers, interfaces, TODOs. (2) Phase 5 pure-deletion verified-by — strengthen with test-count delta + zero inbound refs + zero dangling imports.

---

## Previous Session (2026-05-21, night+1) — execute-backlog v4+v5 + #97/#98 PRs

**Two bundles shipped same session.**

### Bundle 1 — `harness-lifecycle-hook-errors` (#74 HS-14, v4) → PR #97

- **Fix:** `packages/runtime/src/builder.ts` — `withHook` harness wrappers at L794, L807 previously held `.catch(() => undefined)` + outer `try{}catch{}` with comment "Silently ignore handler errors". Replaced with `invokeUserHookSafely()` helper that catches sync throws + promise rejections and routes through `self._errorHandler` (when set) or `console.warn` fallback. Never silent.
- **Cross-package descope:** issue suggested `AgentEvent.HookFailed`; would touch `@reactive-agents/core`. Restricted to runtime-only; HookFailed event = follow-up.
- **Test discipline pivot:** initial integration tests with `withTestScenario` + `withReasoning()` never reached the wrapper — `withTestScenario` short-circuits the reactive loop, `runner.ts:683 runPhaseHooks` never fires. Probes confirmed registration ran but wrapper didn't. Rewrote 6 tests to drive wrappers directly via `RegistrationHarness._collected`.
- **Verified-by recheck:** `grep -c '.catch(() => undefined)' builder.ts` → 0 (was 3; the remaining L2050 site is a non-empty `.catch((e) => {...})` on Effect.runPromise, unrelated).
- **Suite:** runtime 798/0/1-skip (+6); build 38/38.

### Bundle 2 — `runtime-think-phase-typing` (#73 HS-08, v5) → PR #98

- **Fix:** new `packages/runtime/src/engine/phases/agent-loop/think-context.ts` defining `ThinkContext` = `ExecutionContext` + concrete `memoryContext`/`selectedModel` shapes, plus `asThinkContext()`, `getResponseModel()`, `getSelectedModelName()` boundary helpers. 9 `as any` casts in `inline-think.ts` (6) + `reasoning-think.ts` (3) collapsed to typed accesses.
- **Architectural call:** mirrored #71/#72 local-widening precedent — kept inside `@reactive-agents/runtime`. Core (`KernelContext`) and llm-provider (`LLMResponse`) untouched.
- **Dead casts found mid-migration:** `(c as any).selectedStrategy` was redundant — `selectedStrategy` already typed `string | undefined` on schema (2 sites deleted outright, not migrated). `} as any)` on `logEpisode` payload was also dead — service tag accepts `unknown`.
- **`ExecutionReasoningResult.metadata` extended** with `selectedStrategy?: string` to drop the L258 cast — adaptive strategy writes this field via `extraMetadata`, the type just hadn't tracked it. Single-line schema fix in `engine/util.ts`.
- **Verified-by recheck:** `grep -nF 'as any' inline-think.ts reasoning-think.ts` → 0 (was 9). Suite: runtime 805/0/1-skip (+13). Workspace: 5334/0/26-skip. Build 38/38.
- **Out-of-scope deferred:** `execution-engine.ts:956,1072` same pattern, sibling files; follow-up bundle `runtime-execution-engine-as-any-sweep`.

### Session pattern observation
Same-session two-bundle execution worked because each was a clean singleton off `origin/main` (no inter-dependency). Total ~1h45m wall clock for both, both shipped with passing CI gates locally.

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
