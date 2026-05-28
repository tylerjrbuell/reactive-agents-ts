---
title: WS-2 — Runtime Composition + Agent-Facade Canonical Seam
date: 2026-05-28
status: pending
master-plan: 2026-05-28-canonical-refactor.md
architecture-model: 2026-05-28-canonical-architecture-model.md
root-cause-closed: RC-1 (mutation-chain Layer composition; agent-facade type debt)
gh-issues-closed: [#162 (AgentResult.debrief), #163 (AgentEvent narrowing), #164 (CLI template `as any`), #167 (RuntimeAssembly refactor)]
gh-issues-touched: [HS-A-01, HS-A-04, HS-A-05, HS-A-07, HS-A-15, HS-A-16, HS-A-19, HS-D-07, HS-D-08, HS-D-09]
authoritative-anchor: master-plan §4 RC-1 + §3.6 F1/F5/F6 + architecture-model §3 + §11
owner-warden: runtime-warden
session-budget: 2 sessions — Phase 1 (1 session) + Phase 2+3 (1 session)
risk: MEDIUM (Phase 1 mechanical; Phase 2 touches public types — requires careful changeset)
---

# WS-2 — Runtime Composition + Agent-Facade Canonical Seam

## Goal (one sentence)

Refactor `runtime.ts:createRuntime` from imperative mutation chain to declarative terminal `Layer.mergeAll` (mirroring the already-working `createLightRuntime` pattern at line 1061), surface `AgentResult.debrief` and discriminated `AgentEvent` on the public type, and reduce `builder.ts` 59 `withX()` methods toward the ≤24 anti-mission #3 ceiling.

## Anchor

- **Master plan §4 RC-1:** mutation chain adds 44 cast points instead of 1 terminal cast
- **§3.6 F1:** `createLightRuntime` already uses `Layer.mergeAll` — refactor is pattern alignment, not invention
- **§3.6 F5:** `builder.ts` has 59 withers (2.4× anti-mission #3 threshold of 24)
- **§3.6 F6:** `reactive-agent.ts` `this as any` at 2 sites — `ReactiveAgentInternalView` interface fix
- **Architecture model §3:** declarative composition with one `ComposableLayer` erasure boundary at the terminal `Layer.mergeAll` call
- **Architecture model §11:** user surface principles — preset-primary, compose-secondary, ≤24 wither ceiling

## Current State (first-hand verified 2026-05-28)

```
runtime.ts LOC:                                1261
runtime.ts `Layer.merge(runtime, X)` calls:    40   (mutation chain)
runtime.ts `Layer.mergeAll` calls:             2    (declarative — exists in createLightRuntime)
runtime.ts `as ComposableLayer` casts:         44
builder.ts LOC:                                2027
builder.ts withX() method count:               59   (target ≤24)
reactive-agent.ts LOC:                         1535
reactive-agent.ts `this as any` sites:         2    (lines 1385, 1413)
AgentResult.debrief on public type:            NO   (cast sites: 4+ across CLI/cortex/playground)
AgentEvent discriminated on _tag in user code: NO   (cast sites: 13+ in cortex/ui)
```

## Scope IN

### Phase 1 — Runtime composition (mechanical pattern alignment, 1 session)

**Files touched:** `packages/runtime/src/runtime.ts`

**Change shape:**

```typescript
// BEFORE (lines ~215-940 in createRuntime)
let runtime: ComposableLayer = Layer.mergeAll(
  coreLayer, eventBusLayer, llmLayer, memoryLayer, /* ... base ... */,
) as ComposableLayer;
if (options.enableTools)         runtime = Layer.merge(runtime, toolsLayer)        as ComposableLayer;
if (options.enableReasoning)     runtime = Layer.merge(runtime, reasoningLayer)    as ComposableLayer;
if (options.enableIdentity)      runtime = Layer.merge(runtime, createIdentityLayer()) as ComposableLayer;
// ... 40 more conditional Layer.merge mutations ...
return runtime;

// AFTER
const layers: ComposableLayer[] = [
  coreLayer, eventBusLayer, llmLayer, memoryLayer, /* ... base ... */,
];
if (options.enableTools)         layers.push(toolsLayer);
if (options.enableReasoning)     layers.push(reasoningLayer);
if (options.enableIdentity)      layers.push(createIdentityLayer());
// ... 40 more conditional `layers.push(...)` ...
return Layer.mergeAll(...layers) as ComposableLayer;
```

**Pattern source:** `runtime.ts:1061` (`createLightRuntime`). DO NOT invent — copy the shape already working.

**Preserved invariants:**
- `ComposableLayer` type-erasure (documented at runtime.ts:55-76) STAYS
- Behavior identical (same layers, same conditional logic, same options interpretation)
- Test coverage unchanged (existing 3219+ tests cover the runtime composition path)

**Special cases to handle:**
- `effectiveLlmLayer` construction with fallback chain (runtime.ts:242-345) — stays as a derived layer; pushed to `layers[]`
- `finalLlmLayer` with retry wrapping (lines ~347-367) — stays as derived layer
- `gatewayLayer` with `Layer.unwrapEffect` (lines ~892-927) — pushed to `layers[]` post-construction
- `A2aExtraLayer` (lines ~879-885) — pushed to `layers[]`
- `options.extraLayers` (lines 936-938) — pushed last to preserve override semantics

### Phase 2 — Agent-facade public type truth (1 session, alongside Phase 3)

**Files touched:** `packages/runtime/src/types.ts`, `packages/core/src/types/agent-events.ts` (or wherever `AgentEvent` lives), `packages/runtime/src/reactive-agent.ts`, `packages/runtime/src/agent/gateway-runner.ts`, downstream consumers (CLI, cortex, playground)

**Changes:**

#### 2.1 — Surface `AgentResult.debrief` on public type (closes #162)

```typescript
// packages/runtime/src/types.ts
export interface AgentResult {
  readonly output: string | null;
  readonly success: boolean;
  readonly metadata: AgentResultMetadata;
  readonly debrief?: AgentDebrief;   // ← ADD — was internal field, now public
}
```

Migration: 4+ cast sites (CLI, cortex/server, playground) drop `(result as any).debrief` → `result.debrief`. Per-site grep before/after for verification.

#### 2.2 — Discriminate `AgentEvent` on `_tag` for narrowing (closes #163)

Existing `AgentEvent` is a union but consumers must cast to narrow. Add proper discriminated structure so TypeScript narrows on `if (event._tag === "AgentStarted")`:

```typescript
// packages/core/src/types/agent-events.ts
export type AgentEvent =
  | { readonly _tag: "AgentStarted"; readonly agentId: AgentId; readonly taskId: TaskId; /* ... */ }
  | { readonly _tag: "AgentCompleted"; readonly agentId: AgentId; readonly taskId: TaskId; readonly success: boolean; readonly totalTokens: number; /* ... */ }
  | { readonly _tag: "ToolCallStarted"; /* ... */ }
  | { readonly _tag: "ToolCallCompleted"; /* ... */ }
  | { readonly _tag: "LLMRequestStarted"; /* ... */ }
  | { readonly _tag: "LLMRequestCompleted"; /* ... */ }
  | { readonly _tag: "GuardrailViolationDetected"; /* ... */ }
  // ... all variants explicit
;
```

Migration: 13+ cast sites in `cortex/ui/chat-store.ts` + `RunChatTab.svelte` drop `(event as AgentStarted)` → switch on `event._tag`.

#### 2.3 — Add `ReactiveAgentInternalView` to drop `this as any` (closes HS-A-01)

```typescript
// packages/runtime/src/types.ts (or reactive-agent.ts)
export interface ReactiveAgentInternalView {
  readonly _agentId: AgentId;
  readonly _managedRuntime: ManagedRuntime.ManagedRuntime<unknown, never>;
  readonly _gatewayConfig?: GatewayConfig;
  // ... only the fields gateway-runner.ts actually needs
}

// packages/runtime/src/reactive-agent.ts
gatewayStatus(): Promise<GatewayStatus | null> {
  return queryGatewayStatus(this);   // ← was: queryGatewayStatus(this as any)
}
start(): GatewayHandle {
  return startGateway(this);          // ← was: startGateway(this as any)
}

// packages/runtime/src/agent/gateway-runner.ts
export function queryGatewayStatus(agent: ReactiveAgentInternalView): Promise<GatewayStatus | null> { ... }
export function startGateway(agent: ReactiveAgentInternalView): GatewayHandle { ... }
```

### Phase 3 — Builder wither audit + deprecation (1 session)

**Files touched:** `packages/runtime/src/builder.ts`

**Method:**

1. `grep -nE "^\s*public\s+with[A-Z]" packages/runtime/src/builder.ts` → enumerate all 59 withers
2. For each wither, decide:
   - **Keep** — no preset covers this concern + `.compose()` is too low-level for users
   - **Deprecate-alias** — preset already covers; method stays but marked `@deprecated alias for HarnessProfile.<X>()`
   - **Remove** — preset covers AND `.compose()` covers AND method has no callers in tests/examples
3. Target distribution:
   - **Keep:** ~20-24 (the irreducible essential surface)
   - **Deprecate-alias:** ~25-30 (covered by HarnessProfile presets)
   - **Remove:** ~5-10 (true dead weight)
4. Update `Quickstart.mdx` + `README.md` to use `HarnessProfile.balanced()` as primary entry point

**Backward compatibility:** ALL `@deprecated` withers continue to work. No breaking changes. The next major release evaluates removal candidates per usage telemetry.

## Scope OUT (non-goals — flagged for refusal)

- Refactoring the LAYER CONSTRUCTION logic (e.g. how `reasoningLayer` is built) — Phase 1 only changes how layers are ASSEMBLED, not what they are
- Decomposing `runtime.ts` further (WS-6 territory if it ships)
- Decomposing `builder.ts` further (W26-style decomposition is separate)
- Touching `kernel/` capabilities (WS-3 territory)
- Touching `packages/reactive-intelligence/` (separate workstream)
- Changing user-facing API SHAPES (only deprecating redundant methods)
- Adding new HarnessProfile presets (model §11 caps at 3-4)

## Pre-Conditions

- WS-1 shipped (release flow works) — so any post-WS-2 release can validate end-to-end
- `main` current with `origin/main`
- Build green (`bunx turbo run build`)
- Tests green (`bun test` workspace)
- No uncommitted changes

## Tests (RED → GREEN)

### RED first

Phase 1 RED: write a test that asserts `Layer.merge(runtime, X) as ComposableLayer` mutation pattern is absent — initially fails because the pattern is present 40 times.

```typescript
// packages/runtime/tests/runtime-composition.test.ts
import { readFileSync } from "node:fs";
import { test, expect } from "bun:test";

test("createRuntime uses Layer.mergeAll pattern (canonical) — no mutation chain", () => {
  const src = readFileSync("packages/runtime/src/runtime.ts", "utf-8");
  const createRuntimeStart = src.indexOf("export const createRuntime");
  const createRuntimeEnd = src.indexOf("export const createLightRuntime");
  const createRuntimeBody = src.slice(createRuntimeStart, createRuntimeEnd);

  const mutationChainCount = (createRuntimeBody.match(/runtime = Layer\.merge\(runtime,/g) ?? []).length;
  const mergeAllCount = (createRuntimeBody.match(/Layer\.mergeAll\(/g) ?? []).length;

  expect(mutationChainCount).toBe(0);
  expect(mergeAllCount).toBeGreaterThanOrEqual(1);
});
```

Phase 2 RED: write tests asserting `AgentResult.debrief` accessible without cast; `AgentEvent` narrows on `_tag`.

```typescript
// packages/runtime/tests/agent-result-public-types.test.ts
test("AgentResult.debrief is on the public type (no cast)", () => {
  const result: AgentResult = { output: "x", success: true, metadata: { /* ... */ }, debrief: { rationale: "y" } };
  // TypeScript compilation alone is the test — if `debrief` is not on the public type, this fails to compile
  expect(result.debrief?.rationale).toBe("y");
});

test("AgentEvent narrows on _tag", () => {
  const event: AgentEvent = { _tag: "AgentStarted", agentId: AgentId("a"), taskId: TaskId("t") };
  if (event._tag === "AgentStarted") {
    // TypeScript should narrow event to AgentStartedEvent here
    expect(event.agentId).toBe("a");
  }
});
```

Phase 3 RED: lint test (or grep) asserts `builder.ts` wither count is ≤30 (with @deprecated allowed).

### GREEN gates per phase

| Phase | Gate | Expected |
|---|---|---|
| 1 | `grep -c "runtime = Layer.merge(runtime," packages/runtime/src/runtime.ts` | 0 (was 40) |
| 1 | `grep -c "as ComposableLayer" packages/runtime/src/runtime.ts` | ≤3 (was 44; allowing terminal cast + 2 sub-functions) |
| 1 | `grep -c "Layer.mergeAll" packages/runtime/src/runtime.ts` | ≥2 (was 2; createLightRuntime + new createRuntime) |
| 1 | Workspace tests pass | 3219+ pass |
| 2.1 | `grep -r "(result as any).debrief\|as unknown as.*debrief" apps packages` | 0 |
| 2.2 | `grep -rE "as AgentEvent\|as.*AgentStarted" apps/cortex packages/runtime` | 0 (all narrowing via `_tag`) |
| 2.3 | `grep -c "this as any" packages/runtime/src/reactive-agent.ts` | 0 (was 2) |
| 3 | `grep -cE "^\s*public\s+with[A-Z]" packages/runtime/src/builder.ts` | ≤30 (was 59; with @deprecated on the rest) |
| 3 | `grep -c "@deprecated" packages/runtime/src/builder.ts` | ≥20 (alias annotations) |

### Existing tests that MUST still pass

- All workspace `bun test` (3219+ baseline)
- `bunx turbo run build` 38/38
- `bun run typecheck` clean across ALL packages (Phase 2 may surface latent cast violations — fix in scope)

## Verification Protocol

```bash
# Before
echo "Phase 1 baseline:"
grep -c "Layer.merge(runtime," packages/runtime/src/runtime.ts        # → 40
grep -c "as ComposableLayer" packages/runtime/src/runtime.ts          # → 44

echo "Phase 2 baseline:"
grep -rn "(result as any).debrief\|as.*\.debrief" apps/ packages/ | wc -l     # → 4+
grep -rn "as AgentEvent\|as.*Started\b" apps/cortex/ | wc -l                  # → 13+
grep -c "this as any" packages/runtime/src/reactive-agent.ts                  # → 2

echo "Phase 3 baseline:"
grep -cE "^\s*public\s+with[A-Z]" packages/runtime/src/builder.ts     # → 59

# (apply WS-2 changes)

# After
echo "Phase 1 post:"
grep -c "Layer.merge(runtime," packages/runtime/src/runtime.ts        # → 0
grep -c "as ComposableLayer" packages/runtime/src/runtime.ts          # → ≤3
grep -c "Layer.mergeAll" packages/runtime/src/runtime.ts              # → ≥2

echo "Phase 2 post:"
grep -rn "(result as any).debrief\|as.*\.debrief" apps/ packages/ | wc -l     # → 0
grep -rn "as AgentEvent\|as.*Started\b" apps/cortex/ | wc -l                  # → 0
grep -c "this as any" packages/runtime/src/reactive-agent.ts                  # → 0

echo "Phase 3 post:"
grep -cE "^\s*public\s+with[A-Z]" packages/runtime/src/builder.ts     # → ≤30
grep -c "@deprecated" packages/runtime/src/builder.ts                  # → ≥20

# Build + test
bunx turbo run build && bun test && bun run typecheck
```

## Done Criteria (falsifiable — each line is yes/no)

### Phase 1

- [ ] `runtime.ts` createRuntime uses `Layer.mergeAll(...layers)` pattern
- [ ] Zero `runtime = Layer.merge(runtime, X)` mutations in `createRuntime`
- [ ] `as ComposableLayer` count in `runtime.ts` ≤ 3 (from baseline 44)
- [ ] Behavior identical: existing tests pass (3219+)
- [ ] Build 38/38 green
- [ ] Typecheck clean

### Phase 2

- [ ] `AgentResult.debrief` declared on public type in `packages/runtime/src/types.ts`
- [ ] Zero cast sites accessing `debrief` via `as` (closes #162)
- [ ] `AgentEvent` discriminates on `_tag` for TypeScript narrowing
- [ ] Zero cast sites narrowing `AgentEvent` via `as Started` (closes #163)
- [ ] `ReactiveAgentInternalView` interface defined and consumed
- [ ] Zero `this as any` in `reactive-agent.ts` (closes HS-A-01)

### Phase 3

- [ ] `builder.ts` wither count ≤ 30 (from baseline 59)
- [ ] ≥20 redundant withers annotated `@deprecated alias for HarnessProfile.X`
- [ ] Quickstart docs use `HarnessProfile.balanced()` as primary entry point
- [ ] All deprecated withers still functional (backward compat)

### Cross-cutting

- [ ] Workspace tests pass (3219+ from baseline)
- [ ] Build green (38/38)
- [ ] Typecheck clean across ALL packages
- [ ] No new `as any` or `as unknown as` introduced (CI grep)

## Rollback Plan

Phase 1: single revert of the runtime.ts diff. The mutation chain returns; no other code touched.

Phase 2: revert is multi-file (types.ts, reactive-agent.ts, gateway-runner.ts, downstream consumer cleanups). If any downstream consumer ships before WS-2 merges, that consumer's cast removal stays (it's correct cleanup). The TYPE declarations revert; consumers continue to compile because casts come back.

Phase 3: revert removes `@deprecated` annotations. All withers continue to function. Net: rollback is annotation-level.

Per-phase commits make rollback granular.

## Evidence Artifact

`wiki/Research/Refactor-Reports/2026-05-28-ws-2-runtime-seam.md` containing:

- Before/after grep counts (Phase 1: ComposableLayer 44→3; Phase 2: cast sites 17→0; Phase 3: withers 59→≤30)
- Diff statistics (runtime.ts net LOC, builder.ts net LOC)
- Behavior verification: N=1 probe run across reactive + reflexion + plan-execute on local + frontier tier — output sanitized matches pre-WS-2 baseline
- Confirmation of #162, #163, #167 close + HS-A-01/04/05/07/15/16/19 close
- Mock drift secondary effect: count of `as` casts in mock-test files (D-07/08/09) before/after — should drop since source types are now precise

## Why This Workstream Is Second

After WS-1 unblocks release flow:

- Highest-leverage cleanup — the runtime/agent-facade seam is the type-debt epicenter (~30 of 80 `as unknown as` cluster here)
- Mock drift collapses downstream automatically (D-07/08/09 follow from source types)
- Every subsequent WS becomes cheaper (fewer cast collisions when WS-3 touches kernel)
- Phase 1 is mechanical and proven (pattern already works in createLightRuntime)
- Phase 2+3 are independent of Phase 1; can ship as separate PR if Phase 1 takes longer

## Owner + Handoff

`runtime-warden` dispatch via Agent tool with MissionBrief input per pilot. UpwardReport on each phase completion. Main thread runs verification gates before merge.

For Phase 2.2 (AgentEvent discriminated union), coordinate with cortex/ui consumer changes — likely a coordinated multi-package PR.

## Cross-Reference

- Master plan: `wiki/Planning/Implementation-Plans/2026-05-28-canonical-refactor.md` §4 RC-1, §3.6 F1/F5/F6, §6.2 WS-2 summary
- Architecture model: §3 (runtime composition canonical shape), §11 (user surface), §17 mapping
- Related closed issues: #162, #163, #164, #167, HS-A-01/04/05/07/15/16/19, HS-D-07/08/09
- Verified-working reference: `packages/runtime/src/runtime.ts:1061` (createLightRuntime)
