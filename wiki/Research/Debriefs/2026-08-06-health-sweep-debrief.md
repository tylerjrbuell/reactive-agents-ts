---
aliases: [Health Sweep 2026-08-06]
tags: [debrief, health-sweep, maintenance]
date: 2026-08-06
---

# Health Sweep Debrief — 2026-08-06

## Baseline vs Final

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Build | GREEN 37/37 | GREEN 37/37 | = |
| Tests pass | 8748 | 8758 | +10 |
| Tests fail | 2 (skill-persistence + ceiling) | 1 (ceiling, pre-existing HS-210) | -1 |
| Test files | 1139 | 1141 | +2 |

## What was fixed (7 items)

**P0: Tentative skill auto-activation leak (HS-200).** `selectActivated()` relevance branch had no confidence gate. A tentative skill scoring 3 points on a keyword match (floor=2) would auto-activate into context. Root cause traced to `dc8274fb` (skill activation feature) not filtering the relevance path. Fix: `r.skill.confidence !== "tentative"` filter.

**P1: Tool error double-prefix (HS-201).** Four tool sites used `${e}` which on Error objects produces "Error: Error: msg". New `toToolError(toolName, label)` combinator in `packages/tools/src/errors.ts` handles Error vs string vs unknown. 4 unit tests added.

**P1: Memory JSON.parse crash risk (HS-202).** 35 `JSON.parse` call sites across 9 memory service files had no try/catch. One corrupt SQLite TEXT row would produce an unrecoverable Effect defect, crashing an entire query. New `safeJsonParse<T>(raw, fallback)` helper provides per-row degradation. 5 tests added (unit + corrupt-row integration via episodic-memory).

**P1: SIGTERM handler hang (HS-203).** No `.catch()` on shutdown promise — if `stop()`/`dispose()` threw, `process.exit(0)` never reached. Container would hang on SIGTERM.

**P1: Gateway startup error swallowed (HS-204).** `.catch(() => {})` silently ate rejections. Now logs to stderr.

**P1: duplicateGuard O(N) doubled (HS-205).** Two identical scans (`.some()` + `.findIndex()`) each running `JSON.stringify` per step. Collapsed to single `for` loop. Behavior-preserving — confirmed by identical predicates in both old scans.

**P1: Residual meta casts (HS-206).** 6 `as Record<string, unknown>` casts on already-typed `KernelMeta`. Pure deletion across arbitrator.ts and iterate-pass.ts.

## What was filed (10 items)

2 P1 items needing design work: MCP `activeConnections` race condition (HS-207), builder `Layer<any, any>` type erasure (HS-208).

8 P2 items: test debris 5.42GB, ceiling test drift, replaySSE missing catch, NODE_ENV production branch, dead poll loop, dead barrel exports, cast counts, unused deps.

## Surprising patterns

1. **Memory layer had zero corrupt-row resilience.** 35 raw `JSON.parse` calls across 9 files, all inside `Effect.gen`. One bad row = service-wide crash. Now wrapped, but the pattern suggests a missing coding convention — future memory code should always use `safeJsonParse`.

2. **Tool error formatting was invisible.** The `${e}` double-prefix only showed up in error messages returned to the LLM, so it degraded tool-use recovery quality silently. The new `toToolError` combinator prevents recurrence.

3. **Guard perf bug was behavior-preserving by accident.** The two scans looked like they might differ (`.some()` vs `.findIndex()`), but both had byte-identical predicates. Collapsing was safe but required explicit verification.

## Top 3 P2 opportunities for next sprint

1. **HS-209: Test debris root cause** — `resolveDefaultDbPath()` CWD-relative default creates 5.42GB of orphan DB files. Fix the default, then clean up.
2. **HS-208: `Layer<any, any>` on public builder API** — type erasure at the composition boundary loses Error channel guarantees. Tighten generic bounds.
3. **HS-215: Cast reduction** — 47 `as any` + 83 `as unknown as` code-position casts in `packages/*/src` (ceiling test at 75). Prioritize the `as any` sites.

## Links

- [[wiki/Issues/Running Issues Log#Health Sweep — 2026-08-06]]
- Effect abstraction audit ran concurrently; findings overlap at HS-201 (toToolError) and HS-208 (Layer type erasure).
