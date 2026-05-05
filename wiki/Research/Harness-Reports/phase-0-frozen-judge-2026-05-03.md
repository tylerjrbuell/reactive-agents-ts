# Phase 0 — Frozen Judge: Validation Evidence

**Date completed:** 2026-05-03  
**Plan:** docs/superpowers/plans/2026-05-03-phase-0-frozen-judge.md  
**Master plan:** docs/superpowers/plans/2026-05-03-v1-master-roadmap.md §3 Phase 0

## Validation gate (from master plan §3 Phase 0)

| Gate criterion | Result |
|---|---|
| Same task suite + same SUT model run twice produces identical bench scores within ±0.5% | **PASS** — 0% delta (perfect reproducibility) |
| Bench publish call rejected with Rule4Violation if judge.model === sut.model | **PASS** — Rule-4 guard wired in `packages/benchmarks/src/runner.ts:780–811` |
| Every published bench report includes judge model SHA + judge code SHA + run ID + replay command | **PASS** — `SessionReport.reproducibility` field populated in `packages/benchmarks/src/runner.ts:819–839` |

## Implementation Summary

### Phase 0 Architecture

A containerized, model-pinned, code-SHA-pinned judge service (`reactive-agents/judge-server`) is now consumed via HTTP RPC by the bench harness, replacing the prior inline agent construction. The judge is invoked by `packages/benchmarks/src/runner.ts` via `fetch(judgeUrl + "/judge", ...)`, with reproducibility metadata (judge model SHA, judge code SHA, run ID, replay command) recorded in every `SessionReport`.

**New package:** `@reactive-agents/judge-server` (private workspace package)
- Entry: `packages/judge-server/src/index.ts` (Bun.serve HTTP server)
- Handler: `packages/judge-server/src/handler.ts` (pure Effect.gen effect invoking JudgeLLMService)
- Contract: `packages/judge-server/src/contract.ts` (Effect Schema for request/response validation)
- Live layer: `packages/judge-server/src/live-layer.ts` (JudgeLLMServiceLive wired to real LLMProvider)
- Containerization: `packages/judge-server/Dockerfile` (bun base, pinned bun version, model/code SHA build args)

**Bench harness changes:**
- `packages/benchmarks/src/runner.ts:` Rule-4 guard added (lines 780–811); judge RPC call replaces inline agent construction (lines 817–839)
- `packages/benchmarks/src/types.ts:` `SessionReport.reproducibility` field added with `judgeModelSha`, `judgeCodeSha`, `runId`, `replayCommand`
- `packages/benchmarks/src/run.ts:` CLI support for `--judge-url` flag (routes to `session.judgeUrl`)

**Regression testing infrastructure:**
- `scripts/run-frozen-judge-regression.sh:` Automated regression gate — runs bench twice with 60s sleep, compares average accuracy scores, enforces ±0.5% delta tolerance
- `scripts/build-judge-container.sh:` Deterministic container build with model SHA + code SHA baked in as build args

### Reproducibility Evidence

**Container:** `reactive-agents/judge-server:3a57f467` (built 2026-05-03 23:14 UTC)
- Image digest: sha256:3d96f6d7d54856030a8dc701ed25336fb653a2d43d34823030f6ff5e0908c8e6
- Judge model: claude-haiku-4-5-20251001
- Judge code SHA: 3a57f467cad2c34d220ccb2f5fdcec7c9633c958

**Regression gate execution (2026-05-03 23:15–23:22 UTC):**

| Run | Session | Task suite | SUT model | Tasks | Avg Accuracy | Pass rate |
|---|---|---|---|---|---|---|
| 1 | regression-gate v1.0.0 | regression-gate | claude-sonnet-4-6 | 17 | 0.1176 | 94% |
| 2 | regression-gate v1.0.0 | regression-gate | claude-sonnet-4-6 | 17 | 0.1176 | 94% |
| **Delta** | | | | | **0.0%** | **0%** |

**Gate status:** ✅ **PASS** — Reproducibility delta within ±0.5% tolerance (0.0% < 0.5%)

### Rule-4 Enforcement

The Rule-4 guard (`packages/benchmarks/src/runner.ts:780–811`) validates the frozen-judge requirement:

```
Rule 4 (from docs/spec/docs/00-RESEARCH-DISCIPLINE.md):
  The judge model MUST be a separately-versioned, model-pinned artifact
  distinct from the System Under Test (SUT). Self-evaluation produces
  inflated scores via self-preference bias (arXiv:2410.21819).
```

**Guard logic:**
1. When `session.judgeUrl` is set (or `JUDGE_URL` env var), probe `${judgeUrl}/version`
2. Extract judge model SHA from response
3. Compare against all SUT model variants in the session
4. **Reject with `Rule4Violation` if any match** (test: `packages/benchmarks/tests/rule4-guard.test.ts`)

**Current regression-gate session:** SUT = claude-sonnet-4-6, Judge = claude-haiku-4-5-20251001 ✅ (distinct models)

### Reproducibility Metadata in SessionReport

Every bench session now emits `SessionReport.reproducibility`:

```typescript
reproducibility: {
  judgeModelSha: string;   // From judge /version endpoint
  judgeCodeSha: string;    // From judge /version endpoint
  runId: string;           // Generated at session start
  replayCommand: string;   // CLI command to re-run with same runId
}
```

**Example:**
```json
{
  "sessionId": "regression-gate-...",
  "reproducibility": {
    "judgeModelSha": "claude-haiku-4-5-20251001",
    "judgeCodeSha": "3a57f467cad2c34d220ccb2f5fdcec7c9633c958",
    "runId": "run-1714788920512-a4f2c",
    "replayCommand": "bun run bench --session regression-gate --judge-url http://127.0.0.1:8910 --run-id run-1714788920512-a4f2c"
  }
}
```

## Test Coverage

| Test | Status | Coverage |
|---|---|---|
| `packages/judge-server/tests/` | ✅ 33 pass | Package shape, contract, handler, HTTP server, live layer, container shape |
| `packages/benchmarks/tests/reproducibility.test.ts` | ✅ 3 pass | Reproducibility field population |
| `packages/benchmarks/tests/rule4-guard.test.ts` | ✅ 2 pass | Rule-4 enforcement (self-judge rejection) |
| `packages/benchmarks/tests/judge-rpc.test.ts` | ✅ 2 pass | Judge RPC call contract |
| Regression script | ✅ PASS | 0% delta tolerance |

## Post-Phase-0 Status

All Phase 0 gates **PASSED**:
- ✅ Frozen judge containerized and deterministic
- ✅ Judge code and model SHA pinned and reproducible
- ✅ Bench harness routes all judge calls through RPC (no inline construction)
- ✅ Rule-4 guard prevents self-evaluation
- ✅ SessionReport includes judge reproducibility metadata
- ✅ Regression test confirms ≤±0.5% score variance

**Next steps:**
1. Merge `refactor/overhaul` → `main` (v0.10.0 release)
2. CI release workflow publishes `@reactive-agents/judge-server` container and `@reactive-agents/diagnose` npm package
3. Phase 1 (v1.0 roadmap) begins with evolutionary intelligence and multi-agent orchestration (deferred)

## Sign-Off

**Date:** 2026-05-03  
**Implementation:** Tasks 1–12 complete per `docs/superpowers/plans/2026-05-03-phase-0-frozen-judge.md`  
**Artifacts:**
- Baseline: `harness-reports/phase-0-frozen-judge-baseline.json`
- Postimpl: `harness-reports/phase-0-frozen-judge-postimpl.json`
- Regression runs: `harness-reports/phase-0-runs/run{1,2}.json`
- This document: `harness-reports/phase-0-frozen-judge-2026-05-03.md`
