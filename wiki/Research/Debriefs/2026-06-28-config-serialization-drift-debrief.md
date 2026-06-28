---
title: Config Serialization Drift Closure + Dynamic Anti-Drift Guard
date: 2026-06-28
status: shipped (local main, not pushed)
area: packages/runtime — agent-as-data serialization
---

# Config Serialization Drift Closure + Dynamic Anti-Drift Guard

## Problem

"Agent as data" serialization (`AgentConfig` ↔ `ReactiveAgentBuilder`) requires three
artifacts to stay in lockstep:

1. `AgentConfigSchema` — `packages/runtime/src/agent-config.ts` (the data shape)
2. `serializeBuilder()` — `packages/runtime/src/builder/to-config.ts` (builder → config)
3. `agentConfigToBuilder()` — `packages/runtime/src/agent-config.ts` (config → builder)

They had drifted. Schema + deserializer gained fields after the feature shipped, but
`serializeBuilder()` was never updated, so `builder.toConfig()` **silently dropped** them.
Root cause of the silence: `builder.toConfig()` (builder.ts:2010) calls
`serializeBuilder(this as unknown as BuilderStateForSerialization)`. The `as unknown as`
cast severs the type link, so adding a schema field never forced a serializer update.

## Drift fixed (already in schema + deserializer, missing from serializer)

`grounding`, `fabricationGuard`, `stallPolicy`, `taskContext`, `tools.focusedTools`,
`reasoning.auditRationale`, `outputSchemaOptions`.

`outputSchemaOptions` is **serialize-out only** — the schema *object* is not JSON-expressible,
so the options ride out in `toConfig()` but cannot be re-applied without
`.withOutputSchema(schema, options)` in code. Documented as `NON_BUILDER_ROUNDTRIP`.

## Data parity added (new schema + serialize + deserialize)

`agentId`, `execution.minIterations`, `requiredTools`, `budget`, `circuitBreaker`
(incl. `false` to disable), `rateLimiting`, `skillPersistence`, `durableRuns`.

- Shape trap caught: the builder's `BudgetLimits` is `{tokenLimit, costLimit, warningRatio}`,
  NOT the cost package's `{perRequest, perSession, daily, monthly}`. Two distinct types,
  same concept. Schema now mirrors the builder's.
- `leanHarness` **deliberately excluded** from parity: it is a profile switch with cross-field
  side effects (force-disables memory + strategy switching), so it cannot coexist with `memory`
  in one config without contradiction. Documented alongside callbacks/secrets/runtime methods
  in the guard's exclusion rationale.

## Dynamic anti-drift mechanism (the durable fix)

`packages/runtime/tests/config-serialization-drift.test.ts` reads `AgentConfigSchema` AST at
runtime and walks every leaf key-path (recursing hand-mapped subtrees; treating opaque
passthrough subtrees like `gateway`/`persona`/`logging` as single leaves):

1. **Coverage** — a `MAXIMAL_CONFIG` fixture must set every schema leaf. Adding a schema field
   without a fixture entry fails this test.
2. **Roundtrip** — `config → builder → toConfig()` must drop no leaf. A missing serializer or
   deserializer branch fails this test (extra fields in output are tolerated; only drops fail).
3. **Documented exclusions** — `NON_BUILDER_ROUNDTRIP` + a prose list of intentionally
   non-data methods. Promoting one to data is a conscious, reviewed change.

Effect: future config additions cannot drift silently. The test names exactly which of the
three steps was forgotten.

## Verification

- New guard: 3/3 (proved RED on the existing drift first, then GREEN).
- `agent-config.test.ts`: 26/26.
- Full runtime suite: 1037 pass / 0 fail.
- `turbo run build --filter=@reactive-agents/runtime` + DTS typecheck: green.

## Lessons

- An `as unknown as` cast at a serialization boundary is a drift magnet — it disables the one
  compile-time check that would have caught the gap. Where compile-time can't enforce
  cross-artifact sync, an AST-driven runtime guard with a maximal fixture is the substitute.
- Not all builder data is *config* data: profile switches with side effects (leanHarness) and
  callback/secret/runtime methods are correctly non-serializable. Enumerate and document the
  exclusions so "should this be data?" is reviewed, not silently assumed.
