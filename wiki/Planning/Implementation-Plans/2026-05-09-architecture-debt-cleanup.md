---
title: Architecture Debt Cleanup (post-W25)
date: 2026-05-09
status: in-progress
owners: claude
related: [[../Architecture/Specs/06-AUDIT-v0.10.0]], AGENTS.md#architecture-debt
---

# Architecture Debt Cleanup — post-W25

Sweep all open items from the AGENTS.md Architecture Debt register
(L494–L519) into a coherent multi-wave cleanup. Triggered after
W23/W24/W25 monolith decomposition completed.

## Goals

1. Drive type quality up: remove `Layer.Layer<any, any>` casts and
   `(svc as any)` patterns introduced during the W23/W24/W25 extraction.
2. Eliminate duplicated declarations (RiHooks, persona composition,
   strategy direct vs. reactive, sub-agent registration paths).
3. Fix small naming/scoping issues left over from extraction (gateway-chat,
   barrel leak, synthesisConfig, toolResult duplication).
4. Defer behavior-changing items (loop-vs-switch) to a separate spike.

## Inventory (open items)

From AGENTS.md L494–L519:

### Type quality
1. **Layer typing** (Medium/Medium) — `builder.ts buildEffect()` 6× casts
2. **Service typing** (Medium/Medium) — `(svc as any)` in
   `agent/gateway-{bootstrap,tick,driver}.ts` + `builder/build-effect/tool-init-layer.ts`
3. **Config view bloat** (Low/**High**) — `BuilderRuntimeStateView` 155→~40
   fields, *unblocks Layer typing fix*

### Duplication / consolidation
4. **Persona composition** (Low/Low) — 3 sites duplicate
   `composePersonaToSystemPrompt + concat`
5. **Sub-agent path duplication** (Medium/Medium) — `withAgentTool` vs.
   `withDynamicSubAgents`; ~60 LOC saveable
6. **Strategy duplication** (Medium/Medium) — `direct.ts` (215) +
   `reactive.ts` (279) → single `coreReactive(maxIterations?)`
7. **RiHooks duplication** (Low/Low) — 3 declarations of same 6-hook shape

### Naming / scoping
8. **Naming clarity** (Low/Low) — `gateway-chat.ts` →
   `gateway-context-formatting.ts`
9. **Coupling hotspot** (Low/Medium) — `runtime/types.ts`,
   `runtime/builder/types.ts` 360+ inbound imports; move `ProviderName`,
   `OutputFormat` to `@reactive-agents/core` *(defer to next sprint per audit)*
10. **Barrel leak** (Medium/Medium) — `kernel/index.ts` `export *` leaks
    internal utils
11. **Stale docs** (Low/Low) — `context-builder.ts` header overstates scope
12. **synthesisConfig naming** (Low/Low) — kernel-state.ts misleading name
13. **Config duplication** (Low/Low) — `toolResultMaxChars`/`toolResultPreviewItems`
    duplicate `resultCompression.budget`/`previewItems`

### Deferred (not in scope for this plan)
- **Loop vs switch** (Medium/Medium) — behavior-changing, needs harness
  validation; defer to its own spike.
- **Coupling hotspot** — defer per audit ("next sprint").
- **Strategy duplication** (`direct.ts` / `reactive.ts`) — public API
  surface; needs deprecation alias + CHANGELOG. Plan as part of v0.11.
- **Sub-agent path duplication** (`withAgentTool` / `withDynamicSubAgents`)
  — public builder API; same treatment as strategy duplication.

## Type-quality baseline (added 2026-05-09)

User explicitly asked to also clean up IDE issues, tsconfig errors, and
"any other type issues."

**Captured baseline:**
- `bun run typecheck` fails on `@reactive-agents/svelte` only.
- IDE diagnostics also flag `packages/runtime/tsconfig.json` (same root
  cause) — turbo cache hid this in the workspace run.
- Root cause: `"ignoreDeprecations": "6.0"` in 4 tsconfigs (`tsconfig.json`,
  `packages/{react,svelte,vue}/tsconfig.json`). TS 6.0.3 rejects `"6.0"`;
  valid value is `"5.0"` or remove entirely (post-6.0 deprecations are
  removed, not ignorable).
- `as any` density: 134 in runtime/src, 3 in reasoning/src, 774 total
  workspace-wide. Most are intentional/test-mock; W25 audit only flags
  ~12 specific ones (Service typing + Layer typing).

**Wave 0 (do first, before any other wave):**
- W0-1: Remove `ignoreDeprecations: "6.0"` from `tsconfig.json` and
  `packages/{react,svelte,vue}/tsconfig.json`. If anything legitimately
  needs it, downgrade to `"5.0"`.
- W0-2: Re-run `bun run typecheck` clean across all 27 tasks (no cache
  shortcut hiding errors).
- W0-3: Snapshot `mcp__ide__getDiagnostics()` zero-error baseline.

This unlocks any subsequent wave from being blocked by pre-existing red
ticks, and gives subagents a clean starting state.

## Wave plan

Conflict analysis: many items touch `builder.ts` (2,407 LOC). Items that
edit `builder.ts` MUST run sequentially; items touching distinct files run
in parallel.

### Wave 1 — Independent, parallel-safe (no `builder.ts` edits)

Caller verification (2026-05-09):
- `executeDirect` / `executeReactive` are publicly re-exported from
  `packages/reasoning/src/index.ts` (lines 95 / 101) and consumed by
  `strategy-registry.ts` plus 9 test files; `runtime/reactive-agent.ts:442`
  hard-codes `strategy: 'reactive'`. **W1-A demoted to deferred** (API-shaped,
  needs deprecation alias + CHANGELOG).
- `.withAgentTool` and `.withDynamicSubAgents` are public builder methods.
  **W1-E demoted to deferred** (API-shaped).
- `kernel/index.ts` barrel: zero external consumers found in `apps/` or
  other packages. **W1-C is safe to trim** (subagent must still re-verify
  before deleting any export).

| # | Task | Files | Touches builder.ts? |
|---|------|-------|---------------------|
| W1-B | Naming clarity (rename `gateway-chat.ts`) | `runtime/src/gateway-chat.ts` + import sites | No |
| W1-C | Barrel leak trim | `packages/reasoning/src/kernel/index.ts` | No |
| W1-D | Service typing helper (`yieldService<T>`) | `agent/gateway-{bootstrap,tick,driver}.ts`, `builder/build-effect/tool-init-layer.ts` | No |
| W1-F | Small naming/dedup grab-bag | `kernel-state.ts` (synthesisConfig), `kernel-runner.ts`/`context-profile.ts` (toolResult duplication), `context-builder.ts` (header) | No |

**Dispatch:** 4 parallel `general-purpose` subagents.

### Wave 2 — Sequential, all touch `builder.ts`

After Wave 1 returns, dispatch **sequentially** (one at a time):

1. **W2-A: Config view bloat → Layer typing** (chained, single agent).
   First narrow `BuilderRuntimeStateView` from ~155 to actually-consumed
   fields, then drop the 6× `Layer.Layer<any, any>` casts in
   `buildEffect()`. Audit explicitly flags this dependency.
2. **W2-B: Persona composition wrapper.** Add
   `buildSubAgentSystemPrompt()` to `builder/helpers.ts`, replace at
   3 sites: `builder.ts:2042`, `local-agent-tools.ts:116`,
   `sub-agent-executor.ts:167`.
3. **W2-C: RiHooks duplication.** Remove duplicate `RiHooks`
   declarations in `builder.ts` (~L378, ~L1670); import single canonical
   from `builder/ri-wiring.ts`.

## Per-wave guardrails

- Each subagent commits when its task is green (typecheck + targeted tests).
- Each subagent reports: files changed, LOC delta, tests run, any debt
  re-classification needed.
- After each wave, update AGENTS.md debt register status `Open → Fixed (May 2026)`.
- No `--no-verify`. No co-author trailers (per memory).

## Verification per task

- `bun run typecheck` (workspace) clean.
- Targeted tests for the touched package(s) pass.
- For W2-A specifically: confirm zero `Layer.Layer<any, any>` and zero
  `as any` in `buildEffect()` after the change.

## Out of scope

- Behavior changes (loop-vs-switch).
- Cross-package type moves (coupling hotspot).
- v0.11 launch-readiness work (next priority after this cleanup).
