---
title: Codebase debt + Effect-abstraction cleanup sweep
date: 2026-08-21
status: in-progress
---

# Codebase debt + Effect-abstraction cleanup sweep

## Why

User asked for a general debt/clutter pass across all major packages, with explicit focus on
Effect-TS usage and abstraction quality, "DRY and elegant," documented before executing. Four
parallel read-only audit agents surveyed `packages/reasoning` (kernel), `packages/runtime`
(builder/engine), `packages/memory`+`packages/tools`+`packages/llm-provider`, and
`packages/core`+remaining smaller packages+a cross-cutting `as unknown as` cast sweep. This
document is the synthesis + execution plan.

## Findings, triaged

### Batch 1 — Fix immediately (mechanical, low risk, independent files)

| # | Finding | File:line | Effort |
|---|---|---|---|
| 1 | Ceiling-test 2-over-budget: bad `ToolDefinition` literal cast + reinvented `Database` constructor cast | `packages/benchmarks/src/memory-bootstrap-ablation.ts:90,180` | Low |
| 2 | Dead duplicate `serializeKernelState`/`deserializeKernelState` — name-collides with the real codec in `kernel-codec.ts`, zero production callers, a landmine waiting to happen | `packages/reasoning/src/kernel/state/kernel-state.ts:1292-1361` | Low |
| 3 | Retry/timeout/catchTag pattern duplicated verbatim across 5 LLM provider adapters, self-documented via repeated "F4" comments, never factored out | `anthropic.ts:307`, `openai.ts:380`, `gemini.ts:424`, `litellm.ts:306`, `local.ts:616` | Medium |
| 4 | `mcp-client.ts` module-level global connection state — two `ToolService` Layer instances in one process silently clobber each other's MCP connections | `packages/tools/src/mcp/mcp-client.ts:64-98` | Medium |
| 5 | `observability/runtime.ts` erases type on default layer param needlessly | `packages/observability/src/runtime.ts:17` | Low |
| 6 | Two undocumented `as unknown as` casts, no rationale comment (contrast with the documented sibling pattern) | `packages/runtime/src/reactive-agent.ts:1841`, `packages/runtime/src/execution-engine.ts:200` | Low |
| 7 | Raw `Error` throws instead of typed domain errors (rest of package is clean on this) | `packages/memory/src/services/skill-portability.ts:117,124` | Low |
| 8 | Stray avoidable `as any` casts | `packages/llm-provider/src/calibration-runner.ts:70`, `testing.ts:467` | Low |

### Batch 2 — Flag for planning (real, scoped, but bigger blast radius — own dedicated pass)

| # | Finding | File:line | Effort | Risk |
|---|---|---|---|---|
| 9 | Dead inline agent-loop arm — Move 1 (2026-08-13) made the kernel arm the sole path; the `else if (!cacheHit)` branch + 4 `inline-*.ts` files (~1,450 LOC total) are unreachable in production | `packages/runtime/src/execution-engine.ts:861-1102`, `packages/runtime/src/engine/phases/agent-loop/inline-{think,act,observe,harness-hooks}.ts` | Medium | Medium (verify no test layer stack omits `ReasoningService` first) |
| 10 | `withLayers()`/`withReplayLLM()` erase both channels via `Layer<any,any>` on public builder API; unchecked cast at consumption site | `packages/runtime/src/builder.ts:2223,2240`, `runtime-construction.ts:420` | Medium | Low, but semver-relevant public type signature |
| 11 | `BuilderRuntimeStateView` blind structural cast, no compile-time guard against a renamed/removed private field | `packages/runtime/src/builder/build-effect/runtime-construction.ts:84-91` | Medium | Low |
| 12 | `MaybeService<T>` reinvents `Option<T>`, which the package already imports elsewhere | `packages/reasoning/src/kernel/state/kernel-state.ts:977` + ~7 consumer files | Medium | Low |
| 13 | No `Data.TaggedError`/`Effect.fail` anywhere in the kernel — domain errors are plain `throw`, surfacing as unrecoverable defects inside `Effect.gen` | `kernel/state/kernel-codec.ts:200-227`, `kernel/utils/tool-parsing.ts` (8 sites) | Medium | Medium (touches the runtime resume call-site) |
| 14 | `toStrictToolSchema` typed `(schema: any): any`, self-acknowledged debt | `packages/llm-provider/src/providers/openai.ts:160-206` | Medium | Low |
| 15 | `applyPatches` exported+tested, zero callers — dispatcher applies patches inline instead; duplicate-or-dead, needs a check-first read | `packages/reactive-intelligence/src/controller/patch-applier.ts:14` vs `dispatcher.ts:252,261` | Low | Low |

### Escalate — needs explicit decision, changes runtime behavior

| # | Finding | Why it's not a mechanical fix |
|---|---|---|
| 16 | `selectArm` (Thompson-sampling bandit) fully wired on the write side (`updateArm` records rewards every run) but **never called** on the read side — nothing selects an arm via it | Wiring it changes what strategy/arm gets picked at decision time. Per project convention this needs an `ablation-warden`-style cross-tier verification before going default-on, not a blind wire-up in a cleanup sweep. |
| 17 | `subscribeEntropyScoring`/`subscribeCalibrationUpdates` — exported, tested, zero callers; likely meant to be started once at agent-boot | Same shape as #16 — silently-inert signal pipeline. Wiring it could change entropy/calibration-driven behavior in live runs. Needs a `runtime-warden` confirm of the intended call site before wiring. |

### Registered but explicitly NOT this sweep (large, already-tracked, or non-actionable now)

- `arbitrator.ts` (1,908 LOC, 17 importers) and `kernel-state.ts` (1,459 LOC, 51 importers) — top coupling hotspots, future decomposition candidates, not urgent.
- `builder.ts` (2,713 LOC God-object) — ongoing multi-session extraction already in progress (W23-W26 markers); no new action.
- `think.ts` (2,056 LOC) — currently mid-edit (uncommitted `HALO_DEBUG` diff from earlier this session); decomposition candidate once that lands, not touched here.

## Execution order

1. Batch 1, items 1-8 — dispatched as parallel subagents, each scoped to independent files/packages, TDD/safe-refactor discipline, full regression + typecheck before commit.
2. Batch 2 — one item at a time in a later pass, each gets its own commit and regression sweep (not bundled — different files/packages, different risk profiles).
3. Escalate items — reported to user, not executed without an explicit go-ahead + (for #16/#17) an ablation verification pass.

## Audit source (not persisted elsewhere — full findings live in the 4 agent transcripts this session)

- Reasoning/kernel audit: `packages/reasoning/src/kernel/**`, 118 files, 43,171 LOC surveyed.
- Runtime/builder audit: `packages/runtime/**`.
- Memory/tools/llm-provider audit: all three packages, cross-referenced against the whole monorepo for dead-export false positives.
- Core + cross-cutting audit: `packages/core` + 11 smaller packages + full `as unknown as` ceiling reconciliation.
