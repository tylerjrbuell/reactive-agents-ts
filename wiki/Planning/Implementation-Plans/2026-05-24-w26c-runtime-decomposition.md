# W26-C: runtime.ts Decomposition Plan

**Goal:** Reduce `packages/runtime/src/runtime.ts` from 1997 LOC by moving type-only definitions (RuntimeOptions, LightRuntimeOptions, MCPServerConfig) + 2 helper closures (leanModeVerifier, A2aExtraLayer) into sibling modules. Target ≤1300 LOC. Closes the runtime.ts portion of issue #76.

**Architecture:** Pure type/helper extraction. No factory bodies move. Re-exports preserved in `runtime.ts` for backward compat with `builder.ts` and external consumers.

**Baseline:**
- runtime.ts: **1997 LOC**
- runtime tests: 811/0/1
- build: 38/38

## Task 1: Move type definitions to runtime-types.ts

**Files:**
- Create: `packages/runtime/src/runtime-types.ts`
- Modify: `packages/runtime/src/runtime.ts:72-164, 165-805, 1651-1696` (delete defs, keep re-exports)

Move `MCPServerConfig` (L72-164, ~93 LOC), `RuntimeOptions` (L165-805, ~641 LOC), `LightRuntimeOptions` (L1651-1696, ~46 LOC) verbatim. Re-export the three names from `runtime.ts`.

## Task 2: Move helpers

**Files:**
- Create: `packages/runtime/src/runtime/helpers.ts`
- Modify: `packages/runtime/src/runtime.ts:807-815, 1967-1997`

Move `leanModeVerifier` const + `A2aExtraLayer` factory.

## Task 3: Verify + PR

`bun test packages/runtime/`, `bun test packages/replay/`, `bun run build`; push; PR; retro.
