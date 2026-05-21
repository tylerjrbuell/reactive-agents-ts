---
aliases: [Active Blockers, Known Issues]
tags: [issues, blockers, active-work]
---

# Running Issues Log

**Purpose:** Canonical tracking of active blockers, known problems, pending resolutions, and historical closure notes.

**Updated:** 2026-05-20 (stale-prune pass)

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
| HS-18 | C | `packages/llm-provider/src/index.ts` + `capabilities.ts` + `llm-service.ts:75` | ✅ **FIXED** (2026-05-21, annotation-fix scope) — original framing wrong | `ProviderCapabilities`, `StructuredOutputCapabilities`, `Capability` were marked `@deprecated`/"superseded" but encode **orthogonal concerns** (per-provider API flags vs granular JSON-extraction flags vs per-model spec). Wiki HS-18 framed migration as "providers return Capability instead of ProviderCapabilities" — but `Capability` has no analogs for `supportsStreaming`/`supportsLogprobs`/`supportsStructuredOutput`. | Removed false `@deprecated` annotations from `capabilities.ts`, `index.ts` re-exports, `llm-service.ts:75` (`getStructuredOutputCapabilities` "superseded by capabilities()" — granular vs coarse, not a replacement). Added taxonomy doc clarifying the three types are permanent + orthogonal. No code migration needed. |
| HS-19 | C | `packages/runtime/src/builder.ts` (2481 LOC), `runtime.ts` (1997 LOC), `execution-engine.ts` (1648 LOC), `reactive-agent.ts` (1578 LOC) | P1 | Four files >1500 LOC; `execution-engine.ts` drifted +108 LOC since W24 (May 8) completion. `runner.ts` removed in W25 decomp. | Next decomposition wave (W26+) |
| HS-20 | C | `packages/reasoning/src/strategies/plan-execute.ts` (1554 LOC), `core/services/event-bus.ts` (1347 LOC), `reasoning/.../think.ts` (1283 LOC), `act.ts` (1137 LOC), `llm-provider/types.ts` (1063 LOC), `decide/arbitrator.ts` (992 LOC), `observability/exporters/console-exporter.ts` (895 LOC) | P2 | 7 single-files >800 LOC — secondary decomposition candidates | Plan post-W26 |
| HS-21 | C | `packages/llm-provider/src/llm-service.ts:75`, `llm-config.ts:143`, `kernel-state.ts:761-762`, `observability/telemetry/telemetry-schema.ts:37,43`, `tools/adapters/agent-tool-adapter.ts:30` | P2 | 5 `@deprecated` symbols/aliases pending removal — audit removal-target version on each (v0.11 already shipped) | Sweep next minor; amend stale `@deprecated v0.11` annotations |
| HS-22 | C | Providers — `tool_use_start` + `tool_use_delta` emit pattern duplicated 65 times across anthropic/gemini/local/openai | P2 | Extract `emitToolCallStream(emit, id, name, argsJson)` helper into `llm-provider/src/streaming-helpers.ts` | Single helper, 4 callers updated |
| HS-23 | C | `packages/runtime/src/engine/finalize/telemetry-emit.ts:201`, `execution-engine.ts:1232,1239`, `reasoning/src/context/context-manager.ts:271` | P2 | 4 `TODO` comments on live code paths (placeholder scoring, missing TaskResult metadata fields, unwired ExperienceSummary) | Address with Phase 1.5 M6/M10 work |
| HS-24 | D | `packages/reactive-intelligence/tests/m1-dispatcher-validation.test.ts:65` | P1 | `test.skip("RED phase: define measurement requirements…")` contradicts shipped M1 ✅ KEEP verdict in MEMORY.md; placeholder is stale | Delete `test.skip` block (lines 65-174) + helper `computeEntropyStdDev` (lines 246-257) + dead interfaces |
| HS-25 | D | `packages/reactive-intelligence/tests/skills/skill-resolver.test.ts:248,269` | 🟡 **TAGGED** (`<commit>`) — root cause: resolver now returns +1 bundled default skill; assertions written before bundling shipped | Probed by un-skipping: both fail. Comments added in test file documenting drift + fix path. Still skipped; needs `excludeBundled` option or filtered assertions. |
| HS-26 | D | `packages/{react,svelte,vue}/` | P1 | Three UI packages have **zero `*.test.ts` files** — public hooks/stores ship untested | Add smoke tests via `@testing-library/react` (hook render), Svelte test, Vue composable test |
| HS-27 | D | `packages/runtime/tests/{gateway-start,gateway-status,abort-signal,builder-tracing,with-channels-gateway}.test.ts` + `apps/cortex/server/tests/ws-{ingest,live}.test.ts` + `compose/test/killswitches.test.ts` | P1 | ~30 `setTimeout` fixed-delay waits in tests — flake risk on slow CI; killswitches honesty memo flagged this surface specifically | Replace with `waitFor` / event-based assertions or `Effect.TestClock` |
| HS-28 | D | `packages/llm-provider/src/providers/openai.ts:37,115,133,180` | P2 | 4 `@internal Exported for testing only` exports leak through `src/index.ts` re-export | Move to `__internal__/` subpath or gate in `package.json` exports map |
| HS-29 | A | `packages/reactive-intelligence/src/controller/handlers/index.ts:16-24` | P2 | 9 different intervention handlers double-cast `as unknown as InterventionHandler` — implies interface ≠ implementation shape | Reconcile `InterventionHandler` signature with handler returns |
| HS-30 | A | `apps/examples/src/integrations/{25-nextjs-streaming,26-hono-agent-api,27-express-middleware}.ts` | P2 | Whole-file `@ts-nocheck` on three integration examples; `(agentInstance as any).dispose()` in 26+27 | Provide typed examples or convert to `.md` snippets |
| HS-31 | D | Cross-package — 74 `as unknown as` casts in test files; concentrated in `llm-provider`, `observability`, `reasoning` | P2 | Signature-drift sink — packages with most refactor velocity carry highest drift risk | Add lint rule warning above threshold per file; centralize mock factories |

### Themes (root causes — collapse multiple findings)

1. **`KernelState` / `KernelContext` / `MemoryContext` / `RunMetadata` are implicit shapes.** ~25 findings (HS-06, HS-08, parts of HS-04) read fields via `as any`. Defining canonical interfaces would collapse the largest cluster.
2. **Effect Layer R-union not threaded through `runtime.ts`** (HS-03). 50+ `as any` already commented as architectural workaround.
3. **Cross-package LLM contracts duplicated** (HS-04). 5 verification layers + cost redefine `LLMForX` instead of importing canonical.
4. **`ProviderAdapter` M12 hook signatures pin `: any`** (HS-02) on 5 of 7 hooks — public extension surface.
5. **Library-mode `process.exit()` in 3 sites** (HS-11/12/13) — library code should never `exit`.

### Top 3 P2 opportunities for next sprint

1. **HS-22:** Extract provider tool-call streaming emit helper — single PR collapses 65 duplicated emit lines.
2. **HS-26:** Add at least one smoke test per UI package (react/svelte/vue) before v0.11 ships untested adapters.
3. **HS-21:** Audit remaining stale `@deprecated v0.11` annotations — sweep `llm-service.ts:75` (now fixed via HS-18), `llm-config.ts:143`, `kernel-state.ts:761-762`, `telemetry-schema.ts:37,43`, `agent-tool-adapter.ts:30`.

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
  - 🟡 HS-25 — undocumented `it.skip` calls tagged with drift root cause + fix path
- **False-positives closed:** HS-13, HS-15 (Agent B's claims contradicted by code: both sites already had try/catch or `isMain` gate)
- **Filed for planning (remaining):** 21 items (HS-02/03/04/06/07/08/14/16/17/19/20/21/22/23/24/26/27/28/29/30/31)

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

**Last Updated:** 2026-05-20 (stale-prune)  
**Total Open:** 1 (#4 — 0 critical, 1 known; #3/#6/#7 closed)  
**Health Sweep 2026-05-20:** 31 findings filed; 7 fixed (HS-01/05/09/10/11/12 + HS-18 annotation amend), 2 partials (HS-18 migration, HS-25 tagged), 2 false-positives closed (HS-13/15), 1 stale (HS-19 file list — runner.ts removed)  
**Resolved in Phase 1:** 8
