# Bundle: tools-result-handling
Date: 2026-08-16
Budget: 120 min (extended from default 90 — 3 issues, one requires new I/O)
Issues: #47, #57, #58

## Baseline
- `bun run build`: 37/37 successful
- `bun test`: 8890 pass / 26 skip / 4 todo / 0 fail / 1156 files (from prior verification pass this session)

## Re-verification note (none of the 3 issues carried `verified-by:` evidence)

All three issues predate the packages/reactive-agents/src/tools/ → packages/tools/
+ packages/reasoning/ restructuring; their bodies cite stale paths and a stale
`createAgent()`/raw-JSON-Schema `inputSchema` API. Re-verified against current
code before bundling, per SCAN Phase 1 rule 1 ("do not execute on unverified
claims"):

- **#47** (tool-result paging): `ResultCompressionConfig` (`packages/tools/src/
  types.ts:791`) already does char-budget truncation + auto-store overflow to
  `state.scratchpad` (`packages/reasoning/src/kernel/capabilities/act/
  tool-execution.ts:545-552`). But the store is an in-memory
  `Map<string,string>` (`kernel-state.ts:1202`) with **no size cap and no disk
  spill** — unbounded growth across a long run, and content is lost if the
  process dies without a durable checkpoint. This is the actual open half of
  #47, and it's the same mechanism today's `t0-deterministic` regression fix
  touched (`c2418864`) — evidence loss on the stored path is a live theme this
  session, not a hypothetical.
- **#57** (JSON Schema validation on tool defs): the literal ask (ajv against
  raw `inputSchema`) doesn't apply — tools are now typed via Effect
  `ToolDefinitionSchema` (`packages/tools/src/types.ts:97`), not raw JSON
  Schema. But `registry.register()` (`packages/tools/src/registry/
  tool-registry.ts:17`) stores the definition with **no `Schema.decode` call**
  — a malformed definition passed via `as any` (or built dynamically from an
  MCP server / raw object) is accepted silently and only fails later, deep in
  execution, with no indication the schema itself was ever bad. Re-scoped to
  Effect Schema validation at `register()`.
- **#58** (non-JSON tool result error message): confirmed live —
  `JSON.stringify(subAgentResultForDisplay(r.result))` at `tool-execution.ts:
  518,667` has no try/catch. A circular-reference return throws an uncaught
  generic `TypeError` with no tool name; an `undefined` return silently
  produces the JS value `undefined` (not a string), propagating a
  non-string `content` downstream instead of failing at the point of cause.

## Acceptance criteria (per issue)
- #47: `state.scratchpad` writes past a configurable aggregate byte cap spill
  to disk under `.reactive-agents/spill/` with a stable key, keeping memory
  bounded; `resolveStoredToolObservation` transparently reads spilled content
  back. Default cap high enough not to change behavior for typical runs.
- #57: `registry.register()` runs `Schema.decode(ToolDefinitionSchema)` on the
  incoming definition and fails with a typed `ToolSchemaError` (tool name +
  decode errors) instead of silently accepting a malformed definition.
- #58: a tool result that fails `JSON.stringify` (circular ref) or resolves to
  `undefined` produces a clear `ToolExecutionError` naming the tool and the
  actual value type, at the point of failure — not a generic downstream error.

## Execution units (ordered)
1. **Unit 1 (#58, ~25 min):** wrap the two `JSON.stringify(subAgentResultForDisplay(...))`
   call sites in `tool-execution.ts` with a safe-stringify helper; typed error
   on failure/undefined. Test: `packages/reasoning/src/kernel/capabilities/act/
   tool-execution.test.ts` (or nearest existing suite).
2. **Unit 2 (#57, ~25 min):** add `Schema.decode` validation to `register()` in
   `tool-registry.ts`; new `ToolSchemaError` in `errors.ts` if one doesn't
   already fit. Test: `packages/tools/src/registry/tool-registry.test.ts`.
3. **Unit 3 (#47, ~50 min):** size-capped scratchpad with disk spill.
   `packages/reasoning/src/kernel/state/` (or a new small module) gains a spill
   helper; `tool-execution.ts`'s `scratchpadStore.set(...)` calls route through
   it; `state-queries.ts`'s `resolveStoredToolObservation` reads spilled
   content back transparently. Test: new spill-threshold test exercising both
   the disk-write and read-back paths.

## Risk register
- Disk spill touches a path used by durable checkpoint serialization
  (`kernel-state.ts:1354`) — mitigate by keeping spill files referenced by key
  only (same shape as in-memory), not changing the scratchpad's serialized
  type.
- `Schema.decode` on registration could reject a definition some existing test
  fixture builds loosely (e.g. missing optional field defaults) — mitigate by
  running the full `packages/tools` + `packages/reasoning` + `packages/runtime`
  suites before considering Unit 2 done, not just its own new test.

## Verification protocol (cross-cutting)
- `bun test packages/tools/ packages/reasoning/ packages/runtime/` — full pass
- `bun run build` — green
- `bunx turbo run typecheck` — green
- Re-run each issue's re-verification check from above and confirm the gap is closed

## Out-of-scope (explicit)
- #47's literal `.reactive-agents/spill/` path convention followed as
  specified, but no CLI/inspection tooling for spilled files — that's a
  separate DX issue if wanted later.
- #57 does not add JSON-Schema-meta-schema validation (ajv) — Effect Schema
  decode is a strictly stronger current-architecture equivalent; not
  duplicating both.
