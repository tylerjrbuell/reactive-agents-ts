---
type: debrief
date: 2026-06-15
tags: [structured-output, typed-api, grounded-extraction, standard-schema, effect-schema, streaming, debrief]
status: shipped
---

# Debrief: Typed Structured Output Sprint

**Branch:** `feat/typed-structured-output`. **Build:** 38/38 packages. **Tests:** reasoning 130/0, runtime 184/0.

## What shipped

### P0 — SchemaContract + pipeline overload

`SchemaContract<A>` introduced in `@reactive-agents/reasoning` as the internal
typed wrapper around the existing 5-layer `extractStructuredOutput` pipeline.
The pipeline was already present (used internally by the verifier spine); this
phase surfaced it as a stable, typed seam with an overloaded call for the fast
(single-shot) and grounded (loop-integrated) paths.

### P1 — Fast path

Single-shot extraction for frontier models that support native JSON enforcement
with no tool overlap. Routes through the prompt+repair leg of the existing
pipeline. Lowest latency, no grounding data.

### P2 — Grounded engine

Loop-integrated extraction:
1. Build evidence corpus from the run's tool-result steps.
2. Extract each field, ground it against the corpus.
3. Surgically re-extract missing required fields.
4. Score per-field confidence (0..1).
5. Optionally abstain on low-confidence non-required fields (opt-in via `abstainBelow`).

Produces `result.provenance`, `result.confidence`, `result.abstained` on the
grounded path. The verifier spine's `buildEvidenceCorpusFromSteps` is reused
directly — no duplicate corpus-building.

### P3 — Typed carry through `run()` + `streamObject()`

`.withOutputSchema<A>(schema, options?)` on the builder returns
`ReactiveAgentBuilder<A>` so `result.object` is typed `A | undefined` at
compile time. `streamObject()` yields `{ object: DeepPartial<A> }` as tokens
arrive; the final yield is the fully-validated object.

### Public API surface

```
builder.withOutputSchema(schema, options?)
  schema: StandardSchemaV1<unknown, A> | Schema.Schema<A>
  options.mode:         "auto" | "fast" | "grounded"   (default: "auto")
  options.onParseFail:  "degrade" | "throw"            (default: "degrade")
  options.abstainBelow: number                         (default: off)

result.object?      A | undefined
result.objectError? string
result.provenance?  Record<string, { source, evidence }>   (grounded)
result.confidence?  Record<string, number>                 (grounded)
result.abstained?   Record<string, string>                 (grounded + abstainBelow)

agent.streamObject(task, options?) → AsyncGenerator<{ object: DeepPartial<A> }>
```

## Key design insight

The 5-layer `extractStructuredOutput` pipeline existed before this sprint as an
**internal** mechanism used by the verifier spine. The sprint surfaced it, not
rebuilt it. `SchemaContract<A>` is the minimal typed adapter that lets the
runtime call the pipeline with compile-time guarantees. The grounded engine
reuses `buildEvidenceCorpusFromSteps` — already present in
`packages/reasoning/src/kernel/capabilities/verify/` — rather than building a
parallel corpus mechanism.

This pattern (surface internal > rebuild) kept the delta small: the fast path
added a single overload; the grounded path added field-scoring and the abstention
gate on top of existing extraction logic.

## Decisions

**Standard Schema surface.** `.withOutputSchema()` accepts any Standard Schema
v1 validator (Zod 3.24+, Valibot, ArkType) OR an Effect `Schema.Schema<A>`. The
`toSchemaContract()` adapter handles both. This avoids requiring users to adopt
Effect Schema while keeping Effect Schema as the richer internal representation.

**Lenient default (`onParseFail: "degrade"`).** Failures set `objectError` and
leave `object` undefined — they never throw unless the caller opts into
`"throw"`. Reasoning: extraction failures on complex tasks are expected; a
hard-fail would break runs that produced a good prose answer but an imperfect
JSON structure.

**Layered engines, capability-routed.** `auto` mode picks `fast` when the
fast-path conditions hold (frontier provider, native JSON enforcement, no tool
overlap), else `grounded`. Callers can force either leg. This avoids a single
code path that is slow for simple cases and shallow for complex ones.

**Opt-in abstention and grounded-default routing.** Neither `abstainBelow` nor a
grounded-first default is on by default. Both are pending cross-tier ablation
per the project lift rule (≥3pp verified lift required for default-on).

**`streamObject()` as a separate method.** `runStream()` returns `AgentStreamEvent`
(the existing stream contract); streaming structured output is a different
consumer shape (`{ object: DeepPartial<A> }`). A separate method avoids
overloading `runStream()` and keeps its signature stable.

## Test results

| Suite | Passed | Failed |
|---|---|---|
| reasoning | 130 | 0 |
| runtime | 184 | 0 |
| Build (all 38 packages) | 38 | 0 |

Tests cover: typed-carry compile-time shape (`output-schema-typing.test.ts`),
fast-path e2e (`output-schema-e2e.test.ts`), grounded-path e2e
(`grounded-output-e2e.test.ts`), `streamObject` behavior incl. throw-mode
(`stream-object.test.ts`), and the `withOutputSchema` builder config
(`with-output-schema.test.ts`).

## Known limitations and follow-ups

**Svelte / Vue bindings.** `streamObject` is an `AsyncGenerator`; framework
integration helpers (reactive stores, composables) were deferred. P4 roadmap.

**`asTool()` (P4).** Exposing a typed-output agent as an Effect `Schema`-typed
tool for sub-agent delegation was scoped out. Requires a `Tool` type parameter
extension.

**Cross-tier ablation (required for defaults to change).** `abstainBelow` and
grounded-default auto-routing are opt-in. A cross-tier probe (frontier +
local-tier) with ≥3pp lift evidence is required before either becomes default-on.

**Standard Schema requirement-derivation.** Surgical re-extraction of missing
required fields is richest with Effect Schema (explicit `Schema.optional` /
required distinction). Standard Schema inputs get provenance and confidence but
not requirement-tracking; deriving required-field sets from Zod `.required()`
annotations is a follow-up.

**Calibrated confidence signal.** Per-field confidence scores are currently
heuristic (grounding match quality). A calibrated signal with held-out eval is
deferred.

**`runStream()` / `resumeRun()` typed-carry.** These paths return the base
`AgentResult` without the typed `object`. Threading the schema config through the
streaming and resume pipelines is a follow-up; current workaround is `run()` or
`streamObject()`.

## Lessons

**Dual-review caught two contract gaps.** Subagent-driven review (cavecrew-reviewer +
independent pass) surfaced:
1. The fast path needed contract-validation for the `SchemaContract` before
   calling into the existing pipeline — without it, type mismatch was a
   runtime surprise rather than a compile-time guarantee.
2. The `run()` typed-carry required an exactly-one config invariant at compile
   time (the builder overload must return the typed builder, not `this`) — a
   subtle TypeScript constraint that was caught before merge.

**Sound final-validation in the grounded engine.** The grounded engine runs
field-level extraction and grounding, but still requires a final whole-object
parse through the schema before emitting `result.object`. An early version
assembled the grounded fields into a POJO and returned it without the final
parse, which would have bypassed cross-field invariants in the schema (e.g.,
`.refine()` on a Zod object). The final-validation step was added before the
first test run.

**Surface internal > rebuild.** The temptation on sprints like this is to write
a new extraction pathway independent of existing code. Resisting that — spending
time to understand `extractStructuredOutput` and `buildEvidenceCorpusFromSteps`
before writing any new code — kept the implementation small and the behavior
consistent with what the verifier spine already produces.
