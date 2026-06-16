---
aliases: [Active Blockers, Known Issues]
tags: [issues, blockers, active-work]
---

# Running Issues Log

**Purpose:** Canonical tracking of active blockers, known problems, pending resolutions, and historical closure notes.

**Updated:** 2026-05-23 (harness-convergence sweep — 22 new issues filed)

---

## Active Sweep — Harness Convergence (2026-05-23)

**22 GH issues filed #104–#125** under labels `harness-convergence` + `sweep-2026-05-23`. Evidence basis: 97 multi-model probe runs (cogito:14b + qwen3:14b + gpt-4o-mini). Spec: `wiki/Architecture/Design-Specs/2026-05-23-harness-convergence.md`.

### Phase 0 — Surface Trust Restoration (P0, gates all else)

| GH | Title | Severity |
|---|---|---|
| ~~#104~~ | ~~`result.metadata.totalTokens=0` universal silent loss (M1)~~ — **REVERSED 2026-05-23**: probe-side bug, not framework. Closed as invalid. #126 P2 followup for naming consistency. | ❌ invalid |
| #105 | Output sanitize — rationale/CRITIQUE/find-result leaks (M2a/b/c) | 🔴 P0 |
| #106 | ToT `failed to produce output` → `success=true` (M7) | 🔴 P0 |
| #107 | 3 duplicate RI decision event-name pairs (R9) | 🔴 P0 |
| #108 | `interventionsDispatched` counter contamination (R10) | 🔴 P0 |
| #109 | Silent skill persistence failure (R11) | 🔴 P0 |

### Phase 0.5 — Cost / Quality Gates (P1)

| GH | Title | Severity |
|---|---|---|
| #110 | ToT tier + complexity cost gate (M3) | 🟠 P1 |
| #111 | Adaptive routing cost dimension (M5) | 🟠 P1 |

### Phase 1 — Convergence Foundations (P1)

| GH | Title | Severity |
|---|---|---|
| #112 | Bridge RI decisions through Compose tags (C1) | 🟢 P1 |
| #113 | Capability-scoped instrumentation (E2, F1) | 🟢 P1 |
| #114 | `transitionState()` discipline + lint rule (E4) | 🟢 P1 |
| #115 | Required-tool nomination from task text (I2, F4/F5) | 🟢 P1 |
| #116 | `ControllerDecision` union audit + prune/doc (R3) | 🟢 P1 |
| #117 | Wire `emitLLMExchange` at provider boundary (R8, F8) | 🟢 P1 |
| #118 | Plan-execute synthetic kernel state contract test (R5) | 🟢 P1 |
| #119 | Triple compression coordination (R6) | 🟢 P1 |

### Phase 2 — Structural (P2)

| GH | Title | Severity |
|---|---|---|
| #120 | Open `learn/` capability + LearningPipeline (I3, I7) | 🟡 P2 |
| #121 | Multi-severity verifier (I5) | 🟡 P2 |
| #122 | Cross-session skill persistence default-on | 🟡 P2 |

### Phase 3 — Compounding Intelligence (P3)

| GH | Title | Severity |
|---|---|---|
| #123 | Single Arbitrator (E1) | 🔵 P3 |
| #124 | Composite confidence signal (I1) | 🔵 P3 |
| #125 | Capability composition routing (I4) | 🔵 P3 |

**Sequencing:** Phase 0 gates everything. No higher comparison reads through lying API. Then Phase 0.5 → Phase 1 → (Phase 2 ‖ Phase 3).

---

## Known Issues (Monitoring)

### Issue #3: cogito:14b FM-A1 Retry Tuning — Closed (cleanup verified)

**Status:** ✅ CLOSED (2026-05-20)

**Closure summary:** Codebase health sweep 2026-05-20 (Agent C) empirically verified all orphan symbols are gone from `packages/*/src` and `apps/*/src`:
- `packages/reasoning/src/strategies/retry-context.ts` — file does not exist
- `defaultVerifierRetryPolicy`, `improvedVerifierRetryPolicy`, `VerifierRetryPolicy`, `VerifierRetryPolicyContext` — zero refs in src
- `KernelInput.verifierRetryPolicy` field — gone from `kernel-state.ts:286-440`

Only stale refs are vendored snapshots in `apps/stackblitz/*/node_modules/` (not source).

**Active FM-A1 mitigation:** `oracle-nudge.ts` (Pivot B, 2026-05-07) — "describe vs emit" example pair lifts cogito:14b T4 from 30% → 100% synthesized output.

**References:**
- [[Failure-Modes/FM-A Tool Engagement|FM-A1: No-Tool Fabrication]]
- [[Decisions/2026-05-12-m3-terminal-verifier-rework|M3 REWORK Decision]]
- Health Sweep 2026-05-20 (see below)

---

### Issue #4: ToT Outer Loop Doesn't Honor Dispatcher Early-Stop

**Status:** 🟡 KNOWN (Phase 2 work)

**Description:** Tree-of-Thought outer loop doesn't respect dispatcher-early-stop signal. Each branch is a separate sub-kernel with independent RI dispatch.

**Root Cause:** ToT branches created before early-stop wiring; early-stop unhooked at outer loop.

**Impact:**
- ToT may continue branching even after dispatcher recommends termination
- Token waste if RI detects task completion mid-tree
- Suboptimal for deadline-constrained tasks

**Workaround:** Manually set `maxDepth` lower for time-critical tasks

**Phase 2 Action:** Wire dispatcher signal to ToT outer loop coordinator

**Owner:** Orchestration team

**References:**
- `packages/reasoning/src/strategies/tree-of-thought.ts`
- [[Concepts/Reactive Intelligence|Reactive Intelligence (RI)]]
- [[Decisions/Phase 2 Orchestration Decomposition|Phase 2 Plan]]

---


### Issue #6: M3 Verifier Ablation

**Status:** ✅ CLOSED (2026-05-12)

**Description:** Ablation benchmark ran to produce verdict for the M3 verifier mechanism. 10 tasks × 3 models × 2 variants (initial run) + clean re-run (task b36gfxia2, 5 tasks × 3 models × 2 variants, fixed judge). Verdict filed 2026-05-12. REWORK implemented in commit `051c22be` (terminal retry loop disabled, pass/fail gate retained).

**Closure summary:**
- Clean re-run (b36gfxia2) verdict: **INCONCLUSIVE** — no pre-stated rule fires at ≥2/3 model threshold
- REWORK implemented in `051c22be` and **stands** — no reversion triggered by INCONCLUSIVE result
- gpt-4o-mini showed ra-full +5pp with only +15% token overhead — meets KEEP criteria for that model; worth monitoring post-v0.11
- Issue #3 re-scoped (terminal retry surface removed by REWORK; FM-A1 mitigation via `oracle-nudge.ts` already shipped)

**Owner:** Reasoning team

**References:**
- [[Experiments/M3 Healing Pipeline|M3 Verifier]]
- [[Decisions/2026-05-12-m3-terminal-verifier-rework|M3 REWORK Decision]]
- `wiki/Research/Harness-Reports/phase-1.5-m3-ablation-2026-05-12.md` (includes clean re-run section)

---

## Health Sweep — 2026-05-20

**Baseline (pre-sweep):** Build GREEN (38/38), Tests 5317 pass / 26 skip / 0 fail, branch `main` ahead 7.

**Method:** 4 parallel scan agents (Type Safety, Bug Patterns, Inefficiencies, Test Quality). 0 P0, 1 P0-equivalent (D-1), ~25 P1, ~80 P2 surfaced. Findings de-duplicated and triaged below.

**Fixed this sweep:** Issue #3 closed (cleanup empirically verified). No code fixes — all P1 fixes deferred for verification (Agent B `code-action.ts:96` confirmed false-positive: handler wrapped in `sandbox.ts:58-68` try/catch).

### Register (filed for planning)

| ID | Agent | Location | Sev | Description | Fix Direction |
|----|-------|----------|-----|-------------|---------------|
| HS-01 | D | `packages/runtime/src/execution-engine.ts:1365` | ✅ **FIXED** (`27bbdef0`) | Production branch on `process.env.NODE_ENV !== "test"` — test env couples to runtime path (TTY status-mode init) | Replaced with explicit `logging.disableStatusMode` field + `REACTIVE_AGENTS_DISABLE_STATUS_MODE` env fallback |
| HS-02 | A | `packages/llm-provider/src/adapter.ts:104,113,126,145,154` | P1 | `ProviderAdapter` M12 hooks declare `: any` on `response`/`parts`/`error`/`chunk` — 5 of 7 public hooks erase types across providers | Discriminated `RawProviderResponse`/`RawStreamChunk` |
| HS-03 | A | `packages/runtime/src/runtime.ts` (39 sites) | P1 | Layer composition pipeline uses `as any` on every `Layer.merge(...)`; loses R/E params runtime-wide (already commented as workaround at `runtime-construction.ts:165,400`) | Thread proper R-union or use `combineLayers` helper |
| HS-04 | A | `packages/cost/src/cost-service.ts:65` + 5 verification layers | P1 | Duplicate weak `LLMForX.complete: (req: any) => Effect<..., any>` declared 6× across cost + verification layers — type drift across LLM contracts | Centralize into one `LLMForX` and import |
| HS-05 | A | `packages/gateway/src/types.ts:10` | ✅ **FIXED** (`<commit>`) | Public `publish: (event: any) => Effect<void, never>` erases event taxonomy at gateway boundary | Added `TaggedEventLike = Readonly<{_tag: string}> & Readonly<Record<string, unknown>>`; publish requires it; structural match of core's AgentEvent without hard dep |
| HS-06 | A | `packages/reactive-intelligence/src/controller/handlers/*.ts` (7 sites) | P1 | All RI handlers reach into `(state as any)` for `currentOptions`, `tokens`, `activatedSkills`, `controllerDecisionLog`, `currentStrategy` — `ControllerState` missing these fields | Extend `ControllerState` interface or define `ExtendedControllerState` |
| HS-07 | A | `packages/runtime/src/builder/to-config.ts:98,109,122,135,150,161,172` | P1 | All 7 option-group readers (`_reasoningOptions`, `_toolsOptions`, etc.) read builder state via `as any` | Type builder state with `BuilderState` interface |
| HS-08 | A | `packages/runtime/src/engine/phases/agent-loop/inline-think.ts:83,94,105,218,248,285` + `reasoning-think.ts:73,84,258` | P1 | Central think phase casts `memoryContext`, `selectedStrategy`, `LLMResponse.model` via `as any` repeatedly | Type `KernelContext.memoryContext` and `LLMResponse.model` |
| HS-09 | A | `packages/runtime/src/builder/ri-wiring.ts:24-31` | ✅ **FIXED** (`<commit>`) | RI extension surface callbacks declare `: any` on `score`/`decision`/`context`/`skill` | Added `RiEntropyScore`, `RiControllerDecision`, `RiControllerDecisionContext`, `RiSkillDescriptor`, `RiDecisionVerdict`, `RiSkillConflictVerdict`; all 6 hook signatures concrete |
| HS-10 | B | `packages/runtime/src/agent-stream.ts:208,210,237,240` | ✅ **FIXED** (`<commit>`) | `throw new Error(error)` and `throw new Error("Stream ended without StreamCompleted event")` — leak raw strings without typed shape | Added `AgentStreamCollectError extends Error` (typed `_tag`, optional `streamCause`); all 4 throw sites construct it; exported from runtime |
| HS-11 | B | `packages/observability/src/logging/status-renderer.ts:192` | ✅ **FIXED** (`<commit>`) | `process.exit()` on Ctrl-C in renderer module | `cleanupKeyboard()` + `process.kill(pid, "SIGINT")` re-raise; restores host signal-handling autonomy |
| HS-12 | B | `packages/tools/src/mcp/mcp-client.ts:86` | ✅ **FIXED** (`<commit>`) | `process.exit(128+...)` in library-mode signal handler — unilateral exit from library code | Cleanup + deregister + `process.kill(pid, sig)` re-raise; restores host's signal-handling autonomy |
| HS-13 | B | `packages/llm-provider/src/calibration-runner.ts:329,357` | ❌ **FALSE-POSITIVE** | Agent B flagged exits as importable; verified `main()` is NOT exported (line 319 has no `export` keyword) and both exits are inside `main()` which only runs under `isMain(import.meta.url)` guard at line 354. Public exports (`runCalibrationProbes`, `majority`, `median`) do not invoke main. | No fix needed; closed |
| HS-14 | B | `packages/runtime/src/builder.ts:794,807` | P1 | Lifecycle hook errors swallowed by outer `try/catch` + `.catch(() => undefined)` — user hook failures invisible | Route to `_errorHandler` or emit observability event |
| HS-15 | B | `packages/reasoning/src/kernel/capabilities/act/tool-execution.ts:333` + `attend/tool-formatting.ts:233` + `loop/output-synthesis.ts:112` | ❌ **FALSE-POSITIVE** | Agent B flagged JSON.parse without try/catch; verified all three sites ARE wrapped (tool-execution try line 332→catch 406; tool-formatting try 232; output-synthesis try 102 + fenceMatch guarded at line 110 with `if (fenceMatch?.[1])`) | No fix needed; closed |
| HS-16 | B | Providers `anthropic.ts:346`, `openai.ts:486`, `gemini.ts:575`, `local.ts:691`, `litellm.ts:479-481` | P2 | Retry loops overwrite `lastError = e` — only the final attempt's error survives; original parse error lost | Accumulate `errors: unknown[]` with attempt index |
| HS-17 | B | `packages/runtime/src/execution-engine.ts:1365` | P0 (= HS-01) | Same as HS-01; flagged independently by Agent B | See HS-01 |
| HS-18 | C | `packages/llm-provider/src/index.ts` + `capabilities.ts` + `llm-service.ts:75` | ✅ **FIXED** (2026-05-21, commit `ac6e6e5d`, annotation-fix scope) — original framing wrong | `ProviderCapabilities`, `StructuredOutputCapabilities`, `Capability` were marked `@deprecated`/"superseded" but encode **orthogonal concerns** (per-provider API flags vs granular JSON-extraction flags vs per-model spec). Wiki HS-18 framed migration as "providers return Capability instead of ProviderCapabilities" — but `Capability` has no analogs for `supportsStreaming`/`supportsLogprobs`/`supportsStructuredOutput`. Removed false `@deprecated` annotations; added taxonomy doc clarifying the three types are permanent + orthogonal. No code migration needed. |
| HS-19 | C | `packages/runtime/src/builder.ts` (2481 LOC), `runtime.ts` (1997 LOC), `execution-engine.ts` (1656 LOC, +8 since 2026-05-20), `reactive-agent.ts` (1578 LOC) | P1 | Four files >1500 LOC; `execution-engine.ts` continues to drift (+116 LOC since W24 May 8). `runner.ts` removed in W25 decomp. **Re-verified 2026-05-21.** | Next decomposition wave (W26+) |
| HS-20 | C | `packages/reasoning/src/strategies/plan-execute.ts` (1554 LOC), `core/services/event-bus.ts` (1347 LOC), `reasoning/.../think.ts` (1283 LOC), `act.ts` (1137 LOC), `llm-provider/types.ts` (1063 LOC), `decide/arbitrator.ts` (992 LOC), `observability/exporters/console-exporter.ts` (895 LOC) | P2 | 7 single-files >800 LOC — secondary decomposition candidates | Plan post-W26 |
| HS-21 | C | `packages/llm-provider/src/llm-service.ts:75`, `llm-config.ts:143`, `kernel-state.ts:761-762`, `observability/telemetry/telemetry-schema.ts:37,43`, `tools/adapters/agent-tool-adapter.ts:30` | P2 | 5 `@deprecated` symbols/aliases pending removal — audit removal-target version on each (v0.11 already shipped) | Sweep next minor; amend stale `@deprecated v0.11` annotations |
| HS-22 | C | Providers — `tool_use_start` + `tool_use_delta` emit pattern across anthropic/gemini/local/openai | ✅ **FIXED** (2026-05-21, commit `8ec95598`) — original "65 duplicated lines" inflated; actual 9 emit sites in 4 providers | Extracted `streaming-helpers.ts` (`emitToolUseStart`/`emitToolUseDelta`/`emitToolCallComplete`); 4 providers updated; 6 co-emit lines collapsed to 3; `as const`/`as StreamEvent` casts removed. |
| HS-23 | C | `packages/runtime/src/engine/finalize/telemetry-emit.ts:201`, `execution-engine.ts:1232,1239`, `reasoning/src/context/context-manager.ts:271` | P2 | 4 `TODO` comments on live code paths (placeholder scoring, missing TaskResult metadata fields, unwired ExperienceSummary) | Address with Phase 1.5 M6/M10 work |
| HS-24 | D | `packages/reactive-intelligence/tests/m1-dispatcher-validation.test.ts:65` | ✅ **FIXED** (confirmed 2026-06-15) | `test.skip("RED phase: define measurement requirements…")` — stale placeholder contradicting shipped M1 KEEP verdict | test.skip block deleted since 2026-05-20 sweep |
| HS-25 | D | `packages/reactive-intelligence/tests/skills/skill-resolver.test.ts:248,269` | 🟡 **TAGGED** (`<commit>`) — root cause: resolver now returns +1 bundled default skill; assertions written before bundling shipped | Probed by un-skipping: both fail. Comments added in test file documenting drift + fix path. Still skipped; needs `excludeBundled` option or filtered assertions. |
| HS-26 | D | `packages/{react,svelte,vue}/` | P1 | Three UI packages have **zero `*.test.ts` files** — public hooks/stores ship untested | Add smoke tests via `@testing-library/react` (hook render), Svelte test, Vue composable test |
| HS-27 | D | `packages/runtime/tests/{gateway-start,gateway-status,abort-signal,builder-tracing,with-channels-gateway}.test.ts` + `apps/cortex/server/tests/ws-{ingest,live}.test.ts` + `compose/test/killswitches.test.ts` | P1 | ~30 `setTimeout` fixed-delay waits in tests — flake risk on slow CI; killswitches honesty memo flagged this surface specifically | Replace with `waitFor` / event-based assertions or `Effect.TestClock` |
| HS-28 | D | `packages/llm-provider/src/providers/openai.ts:37,115,133,180` | P2 | 4 `@internal Exported for testing only` exports leak through `src/index.ts` re-export | Move to `__internal__/` subpath or gate in `package.json` exports map |
| HS-29 | A | `packages/reactive-intelligence/src/controller/handlers/index.ts:16-24` | P2 | 9 different intervention handlers double-cast `as unknown as InterventionHandler` — implies interface ≠ implementation shape | Reconcile `InterventionHandler` signature with handler returns |
| HS-30 | A | `apps/examples/src/integrations/{25-nextjs-streaming,26-hono-agent-api,27-express-middleware}.ts` | P2 | Whole-file `@ts-nocheck` on three integration examples; `(agentInstance as any).dispose()` in 26+27 | Provide typed examples or convert to `.md` snippets |
| HS-31 | D | Cross-package — **55** `as unknown as` casts in test files (original "74" was inflated — grep match-line count, re-verified 2026-05-21); concentrated in `llm-provider`, `observability`, `reasoning` | P2 | Signature-drift sink — packages with most refactor velocity carry highest drift risk | Add lint rule warning above threshold per file; centralize mock factories |

### Themes (root causes — collapse multiple findings)

1. **`KernelState` / `KernelContext` / `MemoryContext` / `RunMetadata` are implicit shapes.** ~25 findings (HS-06, HS-08, parts of HS-04) read fields via `as any`. Defining canonical interfaces would collapse the largest cluster.
2. **Effect Layer R-union not threaded through `runtime.ts`** (HS-03). 50+ `as any` already commented as architectural workaround.
3. **Cross-package LLM contracts duplicated** (HS-04). 5 verification layers + cost redefine `LLMForX` instead of importing canonical.
4. **`ProviderAdapter` M12 hook signatures pin `: any`** (HS-02) on 5 of 7 hooks — public extension surface.
5. **Library-mode `process.exit()` in 3 sites** (HS-11/12/13) — library code should never `exit`.

### Top 3 P2 opportunities for next sprint

1. **HS-26:** Add at least one smoke test per UI package (react/svelte/vue) before v0.11 ships untested adapters.
2. **HS-21:** Audit remaining stale `@deprecated v0.11` annotations — sweep `llm-config.ts:143`, `kernel-state.ts:761-762`, `telemetry-schema.ts:37,43`, `agent-tool-adapter.ts:30` (`llm-service.ts:75` already fixed via HS-18).
3. **HS-16:** Retry-loop `lastError` overwrite — accumulate `errors: unknown[]` with attempt index across providers (anthropic.ts:346, openai.ts:486, gemini.ts:575, local.ts:691, litellm.ts:479-481).

### Final state (post-sweep + follow-up fix loop)

- **Build:** GREEN (38/38) — unchanged
- **Tests:** 5317 pass / 26 skip / 0 fail — unchanged
- **Fixes applied (7 commits):**
  - ✅ HS-01 — `NODE_ENV !== "test"` replaced with `logging.disableStatusMode` config field
  - ✅ HS-05 — `EventBusLike.publish: (event: any)` → `TaggedEventLike`
  - ✅ HS-09 — RI hook payloads typed (`RiEntropyScore`, `RiControllerDecision`, `RiSkillDescriptor`, …)
  - ✅ HS-10 — `AgentStreamCollectError` typed class replaces 4 `throw new Error(string)` sites
  - ✅ HS-11 — status-renderer Ctrl-C → re-raises SIGINT instead of `process.exit`
  - ✅ HS-12 — mcp-client SIGINT/SIGTERM → re-raises instead of `process.exit`
  - ✅ HS-18 — annotation-fix (2026-05-21): removed false `@deprecated` from `ProviderCapabilities`/`DEFAULT_CAPABILITIES`/`getStructuredOutputCapabilities`; documented as orthogonal types (not replacements). Original "Capability supersedes" framing reverted as design error.
  - ✅ HS-22 — extracted `streaming-helpers.ts` (`emitToolUseStart`/`emitToolUseDelta`/`emitToolCallComplete`); 4 providers updated; 6 co-emit lines collapsed to 3; `as const`/`as StreamEvent` casts removed. Original "65 duplicated lines" count audited to 9 actual emit sites.
  - 🟡 HS-25 — undocumented `it.skip` calls tagged with drift root cause + fix path
- **False-positives closed:** HS-13, HS-15 (Agent B's claims contradicted by code: both sites already had try/catch or `isMain` gate)
- **Filed for planning (remaining):** 20 items (HS-02/03/04/06/07/08/14/16/17/19/20/21/23/24/26/27/28/29/30/31)

---

## Resolved Issues (History)

### ✅ RESOLVED: Pruning Principle Builder API (Issue #7)

**Status:** ✅ Resolved (pre-2026-05-20 stale-prune verification)

**Issue:** North Star §9 Pruning Principle (NLAH arXiv:2603.25723) not surfaced in builder; users paid 13.6× tokens with −0.8pp accuracy on frontier.

**Resolution:** `withLeanHarness()` shipped on builder.
- `packages/runtime/src/builder.ts:977` — `withLeanHarness(): this { this._leanHarness = true; ... }`
- `packages/runtime/src/builder.ts:357` — `_leanHarness: boolean = false` state field
- `packages/runtime/src/builder/build-effect/runtime-construction.ts:156,391` — threads `leanHarness` into runtime options
- `packages/runtime/src/runtime.ts:797` — `leanHarness?: boolean` on options
- `packages/runtime/src/runtime.ts:915,922` — wires lean mode: forces `strategySwitching: false` and swaps in `leanModeVerifier`

**References:**
- North Star §9 (Pruning Principle)
- `packages/runtime/src/builder.ts:977`
- `packages/runtime/src/runtime.ts:797,915,922`

---

### ✅ RESOLVED: Strategy Routing Opt-In (Issue #5)

**Status:** ✅ Resolved 2026-05-12

**Issue:** Strategy switching (M2) required explicit opt-in via `withReasoning({ strategySwitching: { enabled: true } })`. Disabled by default.

**Resolution:** Gate flipped to `!== false` in `packages/runtime/src/runtime.ts` — strategy switching is now opt-OUT (enabled by default). Test updated to match.

**References:**
- `packages/runtime/src/runtime.ts`

---

### ✅ RESOLVED: Rule 4 Frozen Judge Validation

**Status:** ✅ Resolved v0.10.6

**Issue:** `packages/eval/src/runtime.ts` used same-model judge instead of a separate frozen judge instance, blocking any published benchmark claim.

**Resolution:** `packages/judge-server/` implements a separate frozen judge via `JudgeLLMService`. Runs as an HTTP RPC on port 8910, isolated from the SUT model. Benchmarks wire via `--judge-url http://localhost:8910`.

**References:**
- `packages/judge-server/`
- `packages/benchmarks/` — `--judge-url` flag

---

### ✅ RESOLVED: @reactive-agents/diagnose Publication

**Status:** ✅ Assumed resolved v0.10.6 — verify with `npm view @reactive-agents/diagnose version`

**Issue:** `@reactive-agents/diagnose` showed 404 on npm (confirmed May 1). Package `packages/observability` (name: `@reactive-agents/observability`) exports `DiagnosticService` but the scoped diagnose package was unpublished.

**Resolution:** Published via changeset CI at v0.10.6. Note: `packages/observability/package.json` name is `@reactive-agents/observability` — confirm the scoped `diagnose` package name is correct before treating as fully closed.

**References:**
- `packages/observability/package.json`
- CI changeset workflow

---

### ✅ RESOLVED: Dual Compression Uncoordinated

**Status:** ✅ Resolved (May 2, 2026)

**Issue:** Message compression and context curation were separate passes that could conflict.

**Resolution:** Three stages sequenced: stash → curator → patch
- `messages.stash` happens first (episodic memory)
- `applyContextCuration` happens second (compression)
- `patchMessageWindow` happens third (windowing)
- Regression test: `context-curator.test.ts` validates composition

**References:**
- `packages/reasoning/src/kernel/capabilities/attend/context-utils.ts`

---

### ✅ RESOLVED: 9 Termination Paths, No Single Owner

**Status:** ✅ Resolved (Apr 30, 2026)

**Issue:** Multiple code paths could terminate loop; no single decision maker.

**Resolution:** Single-owner arbitrator pattern
- `kernel/loop/terminate.ts` — single-owner helper (validates only arbitrator can terminate)
- `packages/reasoning/src/kernel/capabilities/decide/arbitrator.ts` — the authority
- All other paths defer to arbitrator
- Test: 100% path coverage enforced

**References:**
- `packages/reasoning/src/kernel/loop/terminate.ts`
- Arbitration tests

---

### ✅ RESOLVED: qwen3 Auto-Enable Thinking

**Status:** ✅ Resolved (May 1, 2026)

**Issue:** qwen3:14b thinking mode was auto-enabled globally, breaking other models.

**Resolution:** Thinking is now OPT-IN
- `resolveThinking()` at `packages/llm-provider/src/providers/local.ts:226`
- Returns `undefined` unless `configThinking === true`
- No side effects on non-qwen3 models

**References:**
- `packages/llm-provider/src/providers/local.ts:226-251`

---

### ✅ RESOLVED: RI Dispatcher Budget Zeroed

**Status:** ✅ Resolved (May 3, 2026)

**Issue:** Reactive intervention budget counters appeared dead-zeroed (stale claim).

**Resolution:** Budget counters live and accumulating
- `packages/reasoning/src/kernel/capabilities/reflect/reactive-observer.ts:283-321`
- Accumulates `riBudget` on each intervention
- Verified in Phase 1 M1 validation

**References:**
- `packages/reasoning/src/kernel/capabilities/reflect/reactive-observer.ts`

---

## How to Report Issues

1. **Is this blocking release?** → Add to Critical Path Issues with deadline
2. **Is this a known limitation?** → Add to Known Issues with Phase assignment
3. **Is this already resolved?** → Verify in Resolved Issues before reopening
4. **Do you have a fix?** → Reference the PR or commit that resolves it

---

## Triage Process

| Priority | Action | Owner | Deadline |
|----------|--------|-------|----------|
| 🔴 Blocking release | Fix immediately | Team lead | Before tag |
| 🟡 Known limitation | Phase gate assignment | Domain owner | Phase gate date |
| 🟢 Low impact | Monitor, defer | Observer | Next review |

---

## Next Review: Phase 1.5 Checkpoint (May 15, 2026)

At that point, we expect to see:
- ✅ Rule 4 frozen judge resolved
- ✅ @reactive-agents/diagnose published
- ✅ Strategy routing opt-in flipped to default-on (#5)
- ✅ cogito:14b FM-A1 closed via `oracle-nudge.ts` Pivot B (#3, closed 2026-05-20)
- ✅ M3 REWORK implementation complete — terminal retry loop removed (#6, closed 2026-05-12)
- ✅ Pruning Principle builder API shipped (#7, `withLeanHarness()`)
- 🔄 Phase 2 plan finalized
- 🟢 Any new issues discovered during Phase 1.5 work

---

**Last Updated:** 2026-06-15 (health sweep 2026-06-15: HS-32 fixed, HS-33/34/35 filed, HS-24 confirmed fixed)
**Total Open:** 1 (#4 — 0 critical, 1 known; #3/#6/#7 closed)
**Health Sweep 2026-05-20:** 31 findings filed; **9 fixed** (HS-01/05/09/10/11/12/18/22 + count-verify HS-19/31), 1 partial (HS-25 tagged), 2 false-positives closed (HS-13/15)
**Resolved in Phase 1:** 8

---

## Migration to GitHub Issues (2026-05-21)

**All open HS-NN + AGENTS.md `## Architecture Debt` rows migrated to GitHub issues** with existing label taxonomy (`area:*`, `phase:*`, `type:*`, `priority:*`) plus new labels `health-sweep`, `architecture-debt`, `verified`, `audit-2026-05-21`.

### HS → GH issue map

| HS-NN | GH Issue | Title (truncated) |
|-------|----------|-------------------|
| HS-02 | #68 | ProviderAdapter M12 hooks declare `: any` on 5 of 7 hooks |
| HS-03 | #69 | Layer composition uses `as any` on every Layer.merge (~39 sites) |
| HS-04 | #70 | `LLMForX` duplicated 6× across cost + verification |
| HS-06 | #71 | RI handlers reach into `(state as any)` (7 sites) |
| HS-07 | #72 | 7 option-group readers read builder state via `as any` |
| HS-08 | #73 | Central think phase casts memoryContext/selectedStrategy/LLMResponse.model |
| HS-14 | #74 | Lifecycle hook errors swallowed |
| HS-16 | #75 | Provider retry loops overwrite lastError |
| HS-19 | #76 | Four runtime files >1500 LOC need W26+ decomposition |
| HS-20 | #77 | Seven secondary files >800 LOC |
| HS-21 | #78 | Sweep 5 stale `@deprecated` annotations |
| HS-23 | #79 | 4 `TODO` comments on live code paths |
| HS-24 | #80 | Stale `test.skip("RED phase…")` contradicts M1 KEEP |
| HS-25 | #81 | skill-resolver tests drift on bundled-default skill |
| HS-26 | #82 | Zero tests in @reactive-agents/{react,svelte,vue} |
| HS-27 | #83 | ~30 fixed-delay setTimeout calls in tests |
| HS-28 | #84 | 4 `@internal` OpenAI exports leak through barrel |
| HS-29 | #85 | 9 intervention handlers double-cast as InterventionHandler |
| HS-30 | #86 | Three integration examples use whole-file @ts-nocheck |
| HS-31 | #87 | 55 `as unknown as` casts in tests (was 74) |

### AGENTS.md Architecture Debt → GH issue map

| Debt row | GH Issue | Title |
|----------|----------|-------|
| Loop vs switch | #88 | Loop-detector streak logic masks duplicate-tool patterns |
| Sub-agent dup | #89 | `.withAgentTool` vs `.withDynamicSubAgents` overlap |
| Strategy dup | #90 | `direct.ts` + `reactive.ts` collapse into `coreReactive()` |
| Coupling hotspot | #91 | `runtime/types.ts` + `builder/types.ts` 360+ inbound imports |

### Known issues (Wiki #N → GH issue map)

| Wiki ref | GH Issue | Title |
|----------|----------|-------|
| Issue #4 | #92 | ToT outer loop doesn't honor dispatcher-early-stop |

**Why migrated:** single source of truth for issue tracking; frees local wiki context for *immediate* current-state. GH supports project boards, automation, cross-references, and external contribution discovery.

**Why:** single source of truth for issue tracking; frees local wiki context for *immediate* current-state, not backlog. GH supports project boards, automation, cross-references, and external contribution discovery.

**Convention going forward:**
- New issues file directly to GitHub via templates at `.github/ISSUE_TEMPLATE/`
- This file becomes canonical *history* — closed issues + audit pattern + retrospective notes
- Health sweeps cite GH issue numbers, not HS-NN
- Hot.md links to active GH milestone, not Running Issues Log

### Inflation pattern (audit-of-audit, 2026-05-21)

3/31 HS items shipped with bad framing across 2 sweeps:
- **HS-18:** framed as "Capability supersedes ProviderCapabilities" — actually orthogonal types (per-provider API flags vs JSON-extraction flags vs per-model spec)
- **HS-22:** claimed "65 duplicated lines" — actually 9 emit sites in 4 providers
- **HS-31:** claimed "74 casts" — actually 55 (grep counted match lines, not occurrences)

**Process fix:** every future health-sweep finding requires a `verified-by:` line citing concrete file:line evidence before filing. `.claude/skills/codebase-health-sweep/SKILL.md` updated to enforce this.

---

## Health Sweep — 2026-05-27 (pointer)

**60 NEW findings** filed to `wiki/Research/Audit-Reports-2026-05-27/health-sweep.md`. Method: 4 parallel scan agents (codebase-health-sweep skill v3), all `verified-by:` per audit-of-audit protocol. Build was GREEN at baseline.

**Counts:**
- A — Type Safety / Dead Exports: 20 (1 P0, 8 P1, 11 P2)
- B — Runtime Bug Patterns: 10 (0 P0, 3 P1, 7 P2)
- C — Dead Weight / Inefficiency: 20 (0 P1, 16 P2, 4 P3)
- D — Tests / Coverage: 20 (7 P1, 13 P2)

**Top P0 / P1 (12):** see *Execution Priority* table in audit report. Top item: **HS-A-01** — `ReactiveAgent` Gateway helpers cast `this as any` (public API contract lie, single-class fix).

**5 recommended /execute-backlog bundles** drafted in the audit report (honesty-pass, public-API-honesty, provider-helper-extraction, surface-coverage-gap, deferred-arch-debt-epic).

**Cross-checked**: none of the 60 are open in GH #29-#149 or in this log above.

---

## Health Sweep — 2026-06-15

**Baseline (pre-sweep):** Build GREEN (38/38), Tests 6199 pass / 38 skip / 2 fail (pre-existing: benchmarks env + Docker shell-execution). `bun install` required (fresh container). Branch `main`, v0.11.2.

**Method:** 4 parallel scan agents (A: Type Safety, B: Bug Patterns, C: Inefficiencies, D: Test Quality) + Phase 1.5 verification of each finding before triage. Agent B completed with incomplete output; targeted manual verification substituted.

**Fixed this sweep:** HS-32 (stale path banner). Status update: HS-24 confirmed fixed (test.skip block deleted since 2026-05-20 sweep).

### Register

| ID | Agent | File | Severity | Description | Status | Fix-Direction |
|----|-------|------|----------|-------------|--------|---------------|
| HS-32 | C | `packages/reasoning/src/kernel/capabilities/verify/quality-utils.ts:1` | P2 | Stale file path banner: `// File: src/strategies/kernel/quality-utils.ts` — file moved to `src/kernel/capabilities/verify/` in Stage-5 kernel reorganisation | ✅ **FIXED** | 1-line comment corrected |
| HS-33 | C | `packages/reasoning/src/types/config.ts:32` | P2 | `patchStrategy` field in `PlanExecuteConfigSchema` declared + exported but never consumed in any source file (YAGNI). Zero reads confirmed: `grep -rn patchStrategy packages/reasoning/src` → only declaration. Already listed in AGENTS.md debt table as Open. | FILE | Plan removal in a minor version bump (exported type — breaking for TS consumers who annotate with `PlanExecuteConfig`) |
| HS-34 | A | `packages/reactive-intelligence/src/runtime.ts:49,50,56,65` | P1 | 4 `Layer.merge(...) as any` sites — same root cause as HS-03 but in reactive-intelligence package, not previously counted in HS-03 scope. `verified-by: grep -n "as any" packages/reactive-intelligence/src/runtime.ts` → 4 matches. | ✅ **FIXED** (2026-06-16) | 4 `Layer.merge(...) as any` replaced by typed `widen` helper in `runtime.ts` |
| HS-35 | A | `packages/reasoning/src/kernel/capabilities/reflect/reactive-observer.ts:95,154` | P2 | 2 remaining `as any` casts in reasoning src: line 95 `kernelState: s as any` (cross-package KernelStateLike boundary); line 154 `entropyHistory[last] as any` (entropy history element). `verified-by: grep -n "as any" packages/reasoning/src/kernel/capabilities/reflect/reactive-observer.ts` → 2 matches. Already in AGENTS.md debt table as Open. | ✅ **FIXED** (2026-06-16) | 2 stale `as any` removed from `reactive-observer.ts` |

### Verified non-issues (not re-filed)

- **process.exit** — All 14 sites confirmed: 11 are CLI entrypoints/templates (appropriate), 2 are HS-11/HS-12 (already fixed, comments retained), 1 is `sigterm.ts:39` (graceful shutdown handler, appropriate). No new library-mode exits.
- **Effect.runPromise without .catch** — Reviewed 15 sites: `observable-logger.ts:144` is fire-and-forget `Ref.update` (infallible Effect), `a2a/http-server.ts:198,215` wrapped in outer try/catch, remaining sites in top-level runners or already have `.catch`/`catchAll`. No new violations.
- **Skipped tests** — 3 grep matches all false positives: 2 are asserting `.skip!` method exists (engine-phases test), 1 is `test.skipIf(!OLLAMA_E2E)` (conditional E2E, appropriate).
- **Packages with no tests/ dir** — compose/test, scenarios/__tests__, trace/__tests__ all confirmed present.
- **HS-24** — `packages/reactive-intelligence/tests/m1-dispatcher-validation.test.ts` — `test.skip` block no longer present. ✅ FIXED since 2026-05-20 sweep.

### Top 3 P2 opportunities for next sprint

1. **HS-34:** Extend HS-03 (Layer.merge-as-any) fix to include `packages/reactive-intelligence/src/runtime.ts` (4 sites) — same pattern, same solution, small add-on to any HS-03 PR.
2. **HS-33:** Remove `patchStrategy` from `PlanExecuteConfigSchema` — YAGNI field never consumed; stage for v0.12.0 minor bump as a clean-up item.
3. **HS-35:** Fix 2 remaining `as any` casts in `reactive-observer.ts` via kernel-warden — only 2 left in all of reasoning src; finishing this closes the reasoning-package clean-types gap completely.

### Final state (post-sweep)

- **Build:** GREEN (38/38) — unchanged
- **Tests:** 6199 pass / 38 skip / 2 fail — unchanged (both failures pre-existing; no regressions)
- **Fixes applied (1 commit):** ✅ HS-32 — stale path banner corrected in quality-utils.ts
- **Filed for planning (4 new items):** HS-33 / HS-34 / HS-35 (new), HS-03 scope update (HS-34)
- **Status updates:** HS-24 → ✅ FIXED

**Update 2026-06-16:** HS-34 + HS-35 both ✅ FIXED (C-track clean-types sweep). HS-34: 4 `Layer.merge(...) as any` → typed `widen` helper in `reactive-intelligence/src/runtime.ts`. HS-35: 2 stale `as any` removed from `reactive-observer.ts`. Both governance ceilings green; full suite 6463 pass / 0 fail. HS-33 (`patchStrategy` YAGNI removal) still open — staged for the v0.12.0 minor bump.

---

### Iter 2 update — 2026-05-28 (apps/* + docs)

**+27 NEW findings** (E:12 apps, F:15 docs). Filed as #159-#164 (6 GH issues).

**🚨 P0 release-state drift (#159):** Root VERSION=0.11.1 + npm has 0.11.1 published, BUT 34/35 workspace package.json files at 0.10.6 AND no v0.10.x/v0.11.x git tags exist locally OR on remote. Tag-driven release flow violated; next `release:dry` will fail drift gate.

**P1 supersedes #158:** #162 (`AgentResult.debrief` missing from public type) is the root-cause fix that closes #158 and erases 4+ casts across CLI + cortex/server in one PR.

**Cross-app pattern:** 2 missing public types account for 17 casts in apps — `AgentResult.debrief` (#162) and `AgentEvent` discriminated union (#163).

**Doc systemically lags code:** 04-PROJECT-STATE.md (the AGENTS.md-mandated "READ FIRST" doc) is 30+ days stale, says "v0.10.0 deferred". confidenceFloor killswitch unshipped 2026-05-19 but still in AGENTS.md killswitch list (#160 — re-add anti-pattern risk).
