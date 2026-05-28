---
tags: [audit, health-sweep, 2026-05-27]
date: 2026-05-27
---

# Health Sweep — 2026-05-27

**Method:** 4 parallel scan agents (codebase-health-sweep skill v3). Per-finding `verified-by:` per audit-of-audit protocol. Cross-checked against GH #29-#149 and `Running Issues Log.md`. No fixes applied.

**Baseline:** Build GREEN (38/38 turbo tasks), 27 cached. Branch `main`. v0.11.1.

**Counts:** 60 NEW findings — A:20 type, B:10 bugs, C:20 dead/inefficiency, D:20 tests.

---

## Execution Priority (top 12)

Sorted: severity × leverage × bounded-fix-fit.

| Rank | ID | Sev | Action | Why now |
|---|---|---|---|---|
| 1 | HS-A-01 | P0 | Type Gateway helpers; drop `this as any` at reactive-agent.ts:1385,1413 | Public API contract lie; single-class fix |
| 2 | HS-B-01 | P1 | Delete leftover `DEBUG_VERIFIER` console.error at runner.ts:1740-1742 | Hot.md says removed; reality says no; 3-line fix |
| 3 | HS-B-02 | P1 | Fix lying comment + add obs.log at gateway-bootstrap.ts:236 | Gateway init failures invisible in prod |
| 4 | HS-A-18 | P2→P1 | Implement `onApprovalRequest` on ReactiveAgent (or remove example) | Example calls nonexistent method; ship-blocker for HITL story |
| 5 | HS-A-03 | P1 | Remove `validateRationale`/`isRationale`/`Rationale` from trace/src/index.ts | Zero consumers; public API bloat; 1-line delete |
| 6 | HS-B-04 | P2 | Add `emitErrorSwallowed` at memory-service.ts:113,118,123,194 | Honesty-debt; matches established convention (108/141/156) |
| 7 | HS-C-11 + HS-C-12 | P2 | Extract shared `completeStructured` schema-clone helper; replace `JSON.parse(JSON.stringify())` with `structuredClone()` across 3 providers | Bounded ~50 LOC consolidation; perf + correctness |
| 8 | HS-A-19 | P2 | Add public `getLastDebrief()` accessor; drop `(agent as any)._lastDebrief` in playground | Private-access via cast; encapsulation breach |
| 9 | HS-C-14 | P2 | Drop `MAX_RECURSION_DEPTH` deprecated export from tools/src/index.ts; migrate test to `resolveMaxRecursionDepth()` | Single test caller; bounded fix |
| 10 | HS-A-04 | P1 | Reuse `adaptHandler` pattern (3 sites at reactive-agent.ts:204,346,375) | Typed solution already exists locally |
| 11 | HS-D-17 + HS-D-19 | P1 | Surface tests for `@reactive-agents/health` + `reactive-agents` umbrella exports | API surface gaps; small per-file effort |
| 12 | HS-A-15 | P1 | Type Builder options exactly (runtime.ts:854,921-923) | 4 casts at single seam; public Builder surface |

---

## Full Finding Tables

### A — Type Safety + Dead Exports (20)

See `/tmp/sweep-2026-05-27-scan-A.md` for full table. Highlights:
- **HS-A-01 P0** Gateway helpers cast `this as any`
- **HS-A-02 P1** `createReactiveIntelligenceLayer` 4× `Layer.merge as any` — Layer<unknown,unknown,unknown>
- **HS-A-03 P1** Dead trace exports `validateRationale`/`isRationale`/`Rationale`
- **HS-A-04 P1** 3× ToolService Tag casts; `adaptHandler` unused
- **HS-A-05 P1** `metadata.reasoningSteps` + `lastDialectObserved` untyped on RunResult
- **HS-A-06 P1** `toolResults.slice()` discarded to `as any[]` (2×)
- **HS-A-07 P1** Double `as any` on `completeStructured` calls (runtime.ts:323,327)
- **HS-A-08 P2** BusLike adapter erases AgentEvent
- **HS-A-09 P1** `LLMMessage` missing `tool_calls`/`tool_call_id` variants (validation.ts 4×)
- **HS-A-10 P2** Ollama chunk untyped (3 sites)
- **HS-A-11 P2** Gemini `cfg as any` (7 sites)
- **HS-A-12 P2** Calibration `tools as any`
- **HS-A-13 P2** SQLite params `as any[]`
- **HS-A-14 P2** `KernelStateView` interface missing → cross-pkg `as any`
- **HS-A-15 P1** Builder options 4× `as any` at runtime.ts:854,921-923
- **HS-A-16 P1** `buildToolInitLayer` returns `Layer<never,unknown,unknown>`
- **HS-A-17 P2** `with-session-persistence` example 3× builder cast
- **HS-A-18 P1** HITL example calls nonexistent `onApprovalRequest`
- **HS-A-19 P2** `playground.ts` reaches into private `_lastDebrief`
- **HS-A-20 P2** Strategy registry mutates fn objects via double-cast

**Theme totals:** 80 `as unknown as` + ~490 `as any` matches in production. Zero `@ts-ignore` (HS-30 win). Concentration: runtime/agent-facade seam (≈30 sites).

### B — Runtime Bug Patterns (10)

See `/tmp/sweep-2026-05-27-scan-B.md`. Highlights:
- **HS-B-01 P1** Leftover `DEBUG_VERIFIER` console.error at runner.ts:1740-1742 (Hot.md says removed)
- **HS-B-02 P1** Lying "propagate" comment at gateway-bootstrap.ts:236; actually `.catch(() => {})`
- **HS-B-03 P1** Telemetry `fetch.catch(() => {})` — sink health invisible
- **HS-B-04 P2** 4× memory-service bootstrap swallows missing `emitErrorSwallowed`
- **HS-B-05 P2** `process.stdout.write` ANSI in sub-agent hot path
- **HS-B-06 P2** `Effect.runPromise` in agent-stream getter no `.catch`
- **HS-B-07 P2** `void Effect.runPromise` should be `Effect.runFork`
- **HS-B-08 P2** Gateway obs.log `.catch(() => {})`
- **HS-B-09 P2** llm-provider `console.warn` bypasses ObservabilityService (2 sites)
- **HS-B-10 P2** `pricing-fetch.ts` `console.warn` bypass

**No P0** — no data races, no swallow in LLM/tool critical paths, no rogue `process.exit`.

### C — Dead Weight + Inefficiency (20)

See `/tmp/sweep-2026-05-27-scan-C.md`. Highlights:
- **HS-C-01** runner.ts regrew 1739→1934 LOC (CLAUDE.md stale)
- **HS-C-02..10** 9 files >1000 LOC: builder, reactive-agent, execution-engine, event-bus, think, runtime, act, arbitrator, llm-provider/types
- **HS-C-11/12 P2** Provider `completeStructured` duplication + JSON deep-clone (3 files, ~50 LOC consolidation, use `structuredClone`)
- **HS-C-13..16** 4 stale `@deprecated` aliases (kernel-state.ReActKernelInput, MAX_RECURSION_DEPTH, ModelTier, llm-config Phase1 S1.3)
- **HS-C-17/18** 2 `// legacy` comments on active branches
- **HS-C-19** `fs.existsSync`/`writeFileSync` in calibration service tier (Effect leak)
- **HS-C-20** Stale `@deprecated v0.10.0 — Removed in v0.11.0` comment for reverted symbol

**0 dist/ committed; 0 redundant Array.from; 0 fully-dead public exports.**

### D — Tests + Coverage (20)

See `/tmp/sweep-2026-05-27-scan-D.md`. Highlights:
- **HS-D-01 P1** `observe`: `setupOpenInferenceExporter` + `autoConfigureExporter` zero coverage
- **HS-D-02 P1** `vue` package zero tests (marked @unstable)
- **HS-D-03..06** 4 test mega-files (1385/995/961/911 LOC); D-05 is near-duplicate across reasoning+tools
- **HS-D-07/08/09 P1** Mock-type drift hotspots: reasoning (12 casts), runtime (10), RI (4) — LLMService internal shape diverged from public
- **HS-D-10..16** 7 fixed-millisecond `setTimeout` sites (5/10/20/50/200ms) → flake-prone (compose acknowledges)
- **HS-D-17 P1** `health` 1 test for 5 public exports
- **HS-D-19 P1** `reactive-agents` umbrella has single integration test
- **HS-D-20 P2** `scenarios` test at non-standard `__tests__/`

**Clean:** 0 `.skip`/`.todo`/`xit`/`xdescribe`/`@ts-nocheck`/`dist/` imports across tests; 100% files have `expect()`.

---

## Patterns Observed

1. **Runtime / agent-facade seam is the type-debt epicenter** — ~30 of 80 `as unknown as` cluster in 4 files at the Builder→Runtime→ReactiveAgent boundary. Suggests a missing seam interface (`ReactiveAgentGatewayView`, `BuilderOptionsResolved`).
2. **Mock drift mirrors source drift** — D-07/08/09 cast clusters are downstream of the same Builder/Runtime/LLMService shape that A-04/A-07/A-15 cast around. Fixing source types automatically reduces mock casts.
3. **Honesty-debt is consistent NOT silent** — B-04 is the *outlier* among memory-service swallows; B-02 lies, B-03/B-08 acknowledge tradeoff. Convention (`emitErrorSwallowed`) exists but is unevenly applied.
4. **Decomposition target list grew** — 9 files now >1000 LOC; HS-20 (May 21) only tracked 7 secondary files. runner.ts regrew post-decomp.
5. **Provider duplication is the cheapest structural win** — HS-C-11/12 single helper extraction removes ~50 LOC + 3 deep-clone anti-patterns + 1 perf delta.

---

## Recommended Bundles (for /execute-backlog)

**Bundle 1 — honesty-pass (P1, ~30 LOC across 3 files):**
- HS-B-01 (delete DEBUG_VERIFIER console.error)
- HS-B-02 (gateway-bootstrap loopPromise.catch propagate)
- HS-B-03 (telemetry-client failedReports counter)

**Bundle 2 — public-API-honesty (P0+P1, ~80 LOC across ~5 files):**
- HS-A-01 (Gateway view typing)
- HS-A-03 (delete trace dead exports)
- HS-A-18 (HITL example: implement or remove)
- HS-A-19 (getLastDebrief accessor)

**Bundle 3 — provider-helper-extraction (P2, ~50 LOC):**
- HS-C-11 + HS-C-12 (shared completeStructured + structuredClone)

**Bundle 4 — surface-coverage-gap (P1):**
- HS-D-01 (observe exporter coverage)
- HS-D-17 (health surface tests)
- HS-D-19 (umbrella re-export verification)

**Bundle 5 — DEFER as `architecture-debt` epic (planning, not fix):**
- HS-A-15 + HS-A-04 + HS-A-07 (Builder→Runtime→LLMService seam re-typing)
- HS-D-07/08/09 cluster (collapses once Bundle 5 ships)
- HS-C-01..10 monolith decomp (W26+ planning)

---

## Verification protocol — confirmed

Every finding row carries a `verified-by:` clause naming exact grep/wc command and matched count or file:line. Per audit-of-audit (2026-05-21) inflation guard, occurrence counts use `grep -ro pattern | wc -l` not `grep -c`.

Staged finding tables at `/tmp/sweep-2026-05-27-scan-{A,B,C,D,E,F}.md`.

---

## Iter 2 — apps/* + Wiki/Docs Staleness (2026-05-28)

**Counts:** 27 NEW findings — E:12 apps, F:15 docs.

### Filed GH issues iter 2

| # | Sev | Title | Source |
|---|---|---|---|
| #159 | **P0** | Workspace version drift + missing v0.10.x/v0.11.x git tags — release-flow broken | HS-F-04 + new |
| #160 | P1 | confidenceFloor killswitch documented but unshipped 2026-05-19 | HS-F-08 |
| #161 | P2 | Doc-drift bundle: AGENTS/README/CLAUDE/Hot/04-PROJECT-STATE/North Star | HS-F-01/02/05/06/07/09/10/11/12/13/15 |
| #162 | P1 | AgentResult.debrief missing from public type — 4+ casts; supersedes #158 | HS-E-20/21 + HS-A-19 |
| #163 | P1 | AgentEvent union not narrowing on `_tag` — 13+ casts in cortex/ui | HS-E-22/23 |
| #164 | P1 | create-reactive-agent template ships `as any` to users | HS-E-24 |

### 🚨 P0 release-state drift (issue #159)

Three artifacts contradict each other:
- Root `VERSION` = `0.11.1`
- `npm view @reactive-agents/core version` = `0.11.1` (published)
- All 35 `packages/*/package.json` = `0.10.6` (or `0.9.5` for judge-server)
- Local + remote git tags max at `v0.9.0` (no v0.10.x or v0.11.x tags)

Per memory `feedback_npm_version_drift`: next `bun run release:dry 0.12.0` will fail the drift gate. Per `project_release_flow`: tag-driven flow was bypassed. Either tags were created+deleted, or releases were done via manual `npm publish` (memory says "never do this").

### Cross-app pattern: 2 missing public types

**Root 1:** `AgentResult.debrief` not declared → 4+ casts across CLI + cortex/server (HS-A-19, HS-E-20, HS-E-21). Single 5-LOC fix in `packages/runtime/src/types.ts` resolves all 4 sites + closes #158.

**Root 2:** `AgentEvent` union not discriminated on `_tag` → 13+ casts in cortex/ui chat-store + RunChatTab. Single union refactor resolves the wall.

### apps/* health verdict

| App | State | Notes |
|---|---|---|
| apps/cli | 🟢 mostly healthy | 1 shipped-template lie (#164), 2 P2 internal casts |
| apps/cortex/server | 🟠 needs root-fix (#162) | 11 ts casts; 6 trace to AgentResult.debrief gap |
| apps/cortex/ui | 🔴 type-lie cluster | 14 ts + 11 svelte casts; AgentEvent narrowing fix needed |
| apps/meta-agent | 🟢 healthy | clean baseline |
| apps/examples | 🟠 multiple issue spurs | HS-A-17/18, HS-E-29/30/31 |

### Load-bearing doc lies (HS-F)

1. **HS-F-04 + new** (P0 #159) — release-state drift
2. **HS-F-08** (P1 #160) — confidenceFloor still documented; fresh agents will re-add
3. **HS-F-11** (P2 #161) — `04-PROJECT-STATE.md` (the "READ FIRST" doc per AGENTS.md L:145) says "v0.10.0 deferred"; v0.11.1 actually shipped, 30+ days stale

### Iter 2 totals

- **6 new GH issues** (#159-#164)
- **0 comments on existing** (no overlap)
- **Build still GREEN** (no regression introduced)

### Combined iter 1+2 totals

- **87 NEW findings** (60 iter 1 + 27 iter 2)
- **14 new GH issues** (#151-#164)
- **3 comments on existing** (#77, #78, #87)
- **1 P0** (#159 release-state)
- **8 P1**, **5 P2**

---

## Iter 3 — CI/Release Root Cause + Live Test Scan (2026-05-28)

**Counts:** 19 findings — H:13 CI/release flow, I:6 test scan.

### Filed GH issues iter 3

| # | Sev | Title | Source |
|---|---|---|---|
| #165 | P2 | Orphan v0.10.7 draft GH release (release-drafter residue) | HS-H-03 |
| #166 | P1 | MetricsCollectorTag missing in test Layers (WARN noise; potential prod under-counting) | HS-I-02 |

**Comment on #159 (correction + root cause):** Tags DO exist (my iter 2 `git tag | tail -10` only showed 10 entries, missed v0.10.x). Real bug per H: `publish.yml:135-149` "Sync VERSION to main" commits only `VERSION`, not stamped `packages/*/package.json` files. Drift is structural, not accidental.

### #159 Root Cause (per H audit)

`release.ts:197-208` stamps pkg.jsons in ephemeral CI runner; mutations die with runner. Same mechanism stales CHANGELOG. Recommended structural fix: move stamping OUT of CI into local `release.ts` — stamp+commit+push BEFORE tag. CI publish just builds + publishes the already-stamped commit. Drift becomes structurally impossible.

### Live test verdict (I)

**3219/3219 tests GREEN** across 6 most-changed packages (reasoning, runtime, llm-provider, RI, memory, compose). Net +761 since Hot.md's May-23 baseline of 2458. **Zero regressions.** Strongest signal: HS-I-02 MetricsCollectorTag (filed #166); HS-I-06 runtime suite 41s wall (flake risk on slow CI).

### Combined iter 1+2+3 totals

- **106 findings** (60 + 27 + 19)
- **16 GH issues** (#151-#166)
- **4 comments on existing** (#77, #78, #87, #159)
- **1 P0** (#159 + corrected root cause via H)
- **11 P1, 8 P2**
- **Build GREEN + tests GREEN (3219/3219)**

---

## Iter 4 — Effect-TS Abstraction + Architecture Drift (2026-05-28)

**Counts:** 20 findings — J:12 Effect-TS, K:8 arch drift.

### Filed GH issues iter 4

| # | Sev | Title | Source |
|---|---|---|---|
| #167 | P1 | runtime.ts uses Effect as service locator — RuntimeAssembly + Layer.mergeAll eliminates 38 Layer.merge + 64 ComposableLayer casts | HS-J-01/02/03 |
| #168 | P1 | 105 `Effect<X, unknown>` sites — silent swallow at type level; tagged-error algebra needed | HS-J-06 |
| #169 | P1 | Kernel capabilities form mesh with 21 cross-edges + 7 cycles — violates "leaf" principle | HS-K-01 |
| #170 | P1 | Dead surfaces: @reactive-agents/observe + 5 M12 LocalProviderAdapter hooks (no internal callers) | HS-K-02 + HS-K-08 |
| #171 | P2 | Manifest/doc drift: AGENTS.md tree omits 7/35 + 2 unused deps + North Star §4.3 stale | HS-K-03/04/06/07 |

### Effect-TS Verdict (J)

**Mid-maturity.** Tag-based services widespread (102 files), Layer composition used, Effect.gen standard. But:
- **0 SubscriptionRef** despite 409 Ref ops
- Only **1 acquireRelease** in entire monorepo
- **105 `Effect<X, unknown>`** sites — silent swallow at type level
- **28 Effect.runPromise** calls (15 in runtime alone)
- **7 Effect.gen + try/catch** mixes
- Persistent `as ComposableLayer` / `as Context.Tag.Service` casts

**Structural insight:** `runtime.ts:479-868` functions as **imperative DI container masquerading as Effect Layer composition** — 38× `runtime = Layer.merge(runtime, X) as ComposableLayer`. Team using Effect as service locator, not type-driven composition. Replace mutable `runtime` with `RuntimeAssembly` collector + `Layer.mergeAll(allPieces)` terminal merge. Eliminates `ComposableLayer` entirely.

### Architecture Drift Verdict (K)

**Mild-to-serious.** Key findings:
- **K-01 systemic:** kernel capabilities form mesh w/ 7 cycles, violating documented leaf principle
- **K-02 + K-08 dead surfaces:** `@reactive-agents/observe` pkg has zero internal callers (only docs reference it); 5 M12 adapter hooks ship 270 LOC w/ zero call sites (memory claims removal 2026-05-24 — only 1 of 6 removed)
- **K-04:** AGENTS.md package tree omits 7/35 packages incl. heavily-used reactive-intelligence (39 inbound consumers)
- **Doc-sync observation:** inline memory + per-fix CHANGELOGs faithful; central reference docs (AGENTS.md tree, North Star §4.3) write-once-then-drift

**Recommended CI guardrail:** diff `packages/*/package.json` `name` against AGENTS.md "Package Dependency Tree" + fail on missing.

### Combined iter 1+2+3+4 totals

- **126 findings** (60 + 27 + 19 + 20)
- **21 GH issues** (#151-#171)
- **4 comments on existing** (#77, #78, #87, #159)
- **1 P0** (#159 with root cause via H)
- **15 P1**, **8 P2**
- **Build GREEN + tests GREEN (3219/3219)**

### Domain coverage

| Domain | Iter | State |
|---|---|---|
| packages/* type/dead/bugs/tests | 1 | ✅ covered |
| apps/* | 2 | ✅ covered |
| wiki/docs staleness | 2+4 | ✅ covered |
| CI/release flow | 3 | ✅ covered + root cause |
| Live tests | 3 | ✅ GREEN baseline |
| Effect-TS abstraction | 4 | ✅ covered |
| Architecture drift | 4 | ✅ covered |
| Live LLM probe | — | not done — expensive, recommend dedicated session |
| Security deep audit | — | partially (H-09); recommend dedicated session |
| Memory v2 design review | — | not done — recommend separate session with advisor |

### Domain coverage

| Domain | Iter | State |
|---|---|---|
| packages/* type/dead/bugs | 1 | covered (60 findings) |
| apps/* | 2 | covered (12 findings, 2 root-cause types) |
| wiki/docs staleness | 2 | covered (15 findings, 1 P0) |
| CI/release flow | 3 | covered (13 findings, #159 root cause found) |
| Live tests | 3 | covered (3219 GREEN, 6 findings, 1 P1 actionable) |
| Effect-TS abstraction audit | — | not done (different lens; recommend separate session) |
| Security/secrets | — | partially (H-09 token exposure) |
| Live LLM probe | — | not done (expensive; recommend specific harness session) |

### Recommended Bundle 0 (execute before any other work)

**#159 release-flow fix** — single structural change unblocks future releases:
1. Local-stamp pattern in `release.ts` (commit pkg.json + CHANGELOG before tag)
2. CI publish.yml simplified to build+publish-only (no mutations)
3. Add target-version assertion to `test-clean-install.ts` (HS-H-04) as belt-and-suspenders
4. Delete v0.10.7 orphan draft (#165)
5. Backfill workspace pkg.json bumps to 0.11.1 + CHANGELOG entries for v0.10.6→v0.11.1
