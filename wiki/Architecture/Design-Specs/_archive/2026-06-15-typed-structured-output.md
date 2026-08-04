---
type: design-spec
status: approved
created: 2026-06-15
tags: [structured-output, schema, grounding, extraction, dx, v0.12]
related:
  - "[[2026-06-10-durable-execution]]"
  - "wiki/Research/Audit-Reports-2026-06-10/v0.12.0-leverage-audit.md"
---

# Design Spec — Typed Structured Output (grounded, layered)

> **One-line:** Surface and extend the existing internal structured-output pipeline into a user-facing, schema-typed agent output system with two engines — a fast single-shot path (table-stakes parity) and a **grounded-loop extraction engine** (the differentiator) that fills schema fields as first-class loop goals with per-field provenance, confidence, abstention, and surgical repair.

## 1. Motivation

The agent builder has **no way to return typed structured output**. `agent.run()` returns a `string`; users wanting an `Invoice`/`Classification`/`ExtractedData` must post-parse it themselves. Every competitor (AI-SDK `generateObject`, OpenAI structured outputs, Instructor, LangChain `with_structured_output`) exposes this at the surface — it is table stakes.

But table stakes is not the goal. The framework already owns machinery nobody else has — a verification spine (`requirement-state`, `verifier`, `evidence-grounding`), per-model calibration, a 4-stage healing pipeline, and a reactive multi-step loop. Bolting a single-shot `generateObject` on top would ignore all of it. The opportunity is **structured output as goal-directed grounded extraction**: the schema becomes a first-class goal of the agentic loop, filled progressively, validated as a loop signal, grounded per field, and repaired surgically — *and it works reliably on local models, where the entire ecosystem is weakest.*

That reframes "we have structured output too" into "we have the only **grounded, abstaining, self-repairing** structured output."

## 2. What already exists (build on, do not replace)

A robust structured-output system is already implemented — but it is wired only for the framework's **internal** needs, never surfaced for user output.

| Asset | Location | State |
|---|---|---|
| `extractStructuredOutput` — 5-layer pipeline (L0 native → L1 high-signal prompt → L2 JSON extract+repair → L3 Effect-Schema validate → L4 retry-with-feedback) | `reasoning/src/structured-output/pipeline.ts` | Proven; `stripThinking` + EventBus observability |
| `LLMService.completeStructured<A>` + `getStructuredOutputCapabilities().nativeJsonMode` | `llm-provider/src/llm-service.ts`, all 6 provider adapters | Native enforcement done. `nativeJsonMode`: openai/gemini/local = true; anthropic/litellm = false |
| `json-repair.js` (`extractJsonBlock`, `repairJson`) | `reasoning/src/structured-output/` | Pure functions, reusable for streaming partial-parse |
| `StructuredCompletionRequest<A>` (`outputSchema: Schema.Schema<A>`, `retryOnParseFail`, `maxParseRetries`) | `llm-provider/src/types.ts:1011` | Provider contract |
| Verify spine: `requirement-state.ts`, `verifier.ts` (`VerificationCheck`, severity `pass/warn/reject/escalate`), `evidence-grounding.ts` (`buildEvidenceCorpusFromSteps`) | `reasoning/src/kernel/capabilities/verify/` | Powers the grounded engine |
| `extractOutputFormat` / `OutputFormat` (prose-detected implicit format) | `reasoning/.../comprehend/task-intent.ts`, `loop/output-synthesis.ts` | Orthogonal; coexists |

**Current internal consumers of the pipeline** (must remain behavior-unchanged): `plan-execute.ts` (plan object), `plan-mutation.ts` (plan patch), `infer-required-tools.ts` (tool classification).

**Consequence:** the robustness core is done and battle-tested. Net-new work concentrates on the schema adapter, the user surface, the grounded orchestration, and streaming — i.e. almost entirely the differentiated parts. The fast path collapses from "build" to "wire + degrade-wrap."

## 3. Design decisions (locked)

1. **Schema input surface — Standard Schema spec.** `.withOutputSchema()` accepts any [Standard Schema v1](https://standardschema.dev) validator (Zod 3.24+, Valibot, ArkType, Effect). Vendor-neutral; one adapter; future-proof. Internally converts to the Effect `Schema.Schema<A>` the pipeline already consumes.
2. **Parse-fail mode — configurable, default lenient-degrade.** Default: heal/retry → on persistent failure, `result.object = undefined` + `result.objectError` populated (never a silent `undefined`); `result.success` reflects the run, not the parse. Opt into strict via `{ onParseFail: "throw" }` → typed `StructuredOutputError` (carries raw text + issues).
3. **Enforcement — clean contract, providers adapt; reuse existing infra.** The framework defines one structured-output contract; each provider adapter maps it to its native mechanism (Gemini `responseSchema`, OpenAI `json_schema`, Ollama `format`, Anthropic forced-tool) or defers to the shared prompt+heal path. No kernel-level provider branching. Routing uses `getStructuredOutputCapabilities().nativeJsonMode`.
4. **Streaming cadence — partial-JSON repair → deep-partial emit.** `streamObject()` yields `{ object: DeepPartial<A> }` events (validated-so-far, grounded where applicable); final event is the full validated object.
5. **Ambition — layered: fast floor + grounded engine.** One API surface, two engines, capability/calibration routing.

## 4. Architecture

### 4.1 SchemaContract (Phase 0 — the only new translation seam)

```ts
interface SchemaContract<A> {
  /** Always present — validation via Standard Schema's `~standard.validate`. */
  readonly validate: (v: unknown) => SchemaValidationResult<A>;
  /** Present ⇒ native provider enforcement eligible; undefined ⇒ prompt+heal only. */
  readonly toJsonSchema: () => Record<string, unknown> | undefined;
  /** Effect Schema view, for the existing pipeline's `config.schema`. */
  readonly effectSchema: Schema.Schema<A>;
  readonly label?: string;
}

function toSchemaContract<A>(
  input: StandardSchemaV1<A> | Schema.Schema<A>,
): SchemaContract<A>;
```

- **Kind detection.** Effect Schema → `JSONSchema.make` + `Schema.decodeUnknownSync`. Standard Schema (incl. Zod/Valibot) → `~standard.validate` for validation; JSON Schema derived via the validator's own emitter when available (Zod 4 native `toJSONSchema`, etc.), else `toJsonSchema()` returns `undefined` and the engine uses the prompt+heal path.
- **Why `effectSchema` is on the contract:** the existing pipeline is Effect-Schema-native. For Standard-Schema inputs without a clean Effect conversion, the pipeline path uses a thin Effect `Schema` whose decode delegates to `validate` (a bridge schema), so `extractStructuredOutput` stays untouched.

### 4.2 Generalize the existing pipeline (Phase 0 — additive only)

`extractStructuredOutput` gains an **additive** contract-based path: accept a `SchemaContract<A>` alongside the current `Schema.Schema<T>` convenience overload. Internal callers (`plan-execute`, `plan-mutation`, `infer-required-tools`) stay on the Effect-Schema overload, **behavior-unchanged, still hard-failing**. No `@deprecated`, no signature break. (Per `feedback_no_metric_gaming_refactor` and `feedback_flag_improvements_during_refactor`.)

### 4.3 Two engines

**Fast path (Phase 1 — floor / parity).**
Run the agent loop normally; at finalization, feed the final answer (+ optional step context) into `extractStructuredOutput` via the contract. Map `StructuredOutputResult<T>.data → result.object`. Catch the pipeline's terminal `Effect.fail` → lenient `objectError` or strict `StructuredOutputError`. Chosen by routing when: frontier tier + `nativeJsonMode` + no tools registered + not flagged grounded.

**Grounded engine (Phase 2 — the differentiator).**
A new orchestrator under `reasoning/src/structured-output/grounded/` that wraps `extractStructuredOutput` as its per-extraction primitive and integrates the verify spine:

- **Schema fields → field-requirements.** Extend the `requirement-state.ts` pattern (today: missing/satisfied/permanently-failed *tools*) with a generic field-requirement tracker (missing / satisfied / abstained). Unfilled required fields drive the loop and hint the next tool.
- **Validation as a loop signal.** A new `schemaSatisfactionCheck` `VerificationCheck` in `verifier.ts`: `reject` → repair, `escalate` → abstain/HITL. Loop termination gate = "all required fields valid + grounded."
- **Per-field provenance.** Ground each field value against `buildEvidenceCorpusFromSteps(...)`; record `provenance[fieldPath] = { source, evidence }`. Fields from parametric/non-tool knowledge → `provenance` undefined + lower confidence (honest, not faked).
- **Confidence + abstention.** Confidence aggregated from calibration signals per field. Below the abstention threshold → field omitted (`object[field]` undefined) + `abstained[field] = reason`, instead of a confident hallucination.
- **Surgical repair.** A wrong/invalid field re-derives **only that field** — call `extractStructuredOutput` with a sub-schema (`Schema.pick`) for the one field — rather than re-prompting the whole object. Token-efficient.

**Routing.** `auto` (default): grounded when *(local/uncalibrated tier OR tools registered OR schema flagged high-stakes)*, fast otherwise. Override: `.withOutputSchema(s, { mode: "grounded" | "fast" | "auto" })`.

### 4.4 Streaming (Phase 3)

`streamObject()` reuses `json-repair.js`. On each delta, tolerant-parse the accumulated buffer → emit `{ object: DeepPartial<A> }`. Final delta → full `validate` → final validated event (plus provenance/confidence on the grounded path). Bind to existing `svelte`/`vue` reactive stores for live-fill UIs.

### 4.5 Typed agent-as-tool (Phase 4 — cut-line)

`.asTool({ input, output })` wraps an agent as a tool whose `parameters` = input JSON Schema and whose handler runs the inner agent with `.withOutputSchema(output)`, returning `result.object`. Built entirely on Phase 1. **Pre-designated cut-line:** if Phases 0–3 consume the sprint, this ships as a follow-up.

## 5. Public API surface

```ts
// builder
.withOutputSchema<A>(
  schema: StandardSchemaV1<A> | Schema.Schema<A>,
  opts?: { mode?: "auto" | "fast" | "grounded"; onParseFail?: "degrade" | "throw" },
): ReactiveAgentBuilder /* now carrying output type A */

// run — generic return
const r = await agent.withOutputSchema(Invoice).run("extract …");
r.object        // A | undefined   (typed)
r.objectError   // string | undefined
r.provenance    // Partial<Record<FieldPath, { source; evidence }>> | undefined  (grounded only)
r.confidence    // Partial<Record<FieldPath, number>> | undefined                (grounded only)
r.abstained     // Partial<Record<FieldPath, string>> | undefined                (grounded only)

// streaming
for await (const p of agent.withOutputSchema(Invoice).streamObject("extract …")) {
  p.object;     // DeepPartial<Invoice>
}

// agent-as-tool (Phase 4)
const tool = agent.asTool({ input: QuerySchema, output: ResultSchema });
```

`AgentResult` gains `object?`, `objectError?`, `provenance?`, `confidence?`, `abstained?` — **all backward-compatible optionals.**

## 6. Error handling

- **Lenient (default):** heal/retry → degrade to `object: undefined` + `objectError`. Never throws, never silent.
- **Strict (`onParseFail: "throw"`):** terminal failure → `StructuredOutputError` (raw text + validation issues).
- **Internal callers unchanged:** `plan-execute` / `plan-mutation` / `infer-required-tools` keep current Effect-fail semantics.
- **Grounded abstention is not an error:** a field omitted by abstention is a successful, honest result with `abstained[field]` set.

## 7. Testing (TDD — `agent-tdd` skill, mandatory timeout flags)

- **P0:** adapter unit tests (Zod / Effect / Valibot → contract; JSON-Schema present vs absent → routing path). Pipeline-generalization regression: 3 internal callers byte-identical (golden-master).
- **P1:** per-provider structured complete (native + prompt fallback) via the deterministic `test` provider; lenient vs strict; heal-on-malformed; `result.object` typed roundtrip.
- **P2:** field-requirement transitions (missing→satisfied→abstained); `schemaSatisfactionCheck` severity routing; provenance built from a synthetic step corpus; surgical single-field repair calls `extractStructuredOutput` with the picked sub-schema; abstention threshold behavior.
- **P3:** partial-JSON repair on incremental buffers → DeepPartial sequence; stream e2e; final validated event.
- **P4:** typed agent-as-tool roundtrip.
- **Cross-tier receipt:** grounded extraction on 1 local (Ollama, e.g. qwen/gemma small) + 1 frontier — the "works on local models" proof. Keys live in `.env` (bun auto-loads).

## 8. Honesty / research-discipline guardrails

- **Confidence is a signal, not a guarantee** — scope claims per `01-RESEARCH-DISCIPLINE.md` Rule 11.
- **Abstention default-on requires an ablation gate.** The abstention threshold and any grounded-default routing ship **opt-in** until cross-tier ablation proves lift (≥3pp accuracy AND ≤15% token overhead, per the project lift rule). Route through `ablation-warden` before any default-on flip.
- **Provenance only as good as the evidence corpus** — non-tool fields carry no provenance and say so; no synthetic provenance.
- **Grounded engine pays loop cost** — that is *why* routing exists; frontier + no-tools escapes to the fast path. Publish the measured overhead (cost-honesty identity).
- **No metric-gaming in the pipeline refactor** — additive contract path only; internal callers untouched; leave-large is valid.

## 9. Out of scope

- Replacing or deprecating `extractStructuredOutput` or the internal callers.
- Changing the `OutputFormat` prose-intent system (it coexists; explicit schema supersedes when present).
- Multi-schema / union-discriminated extraction beyond what Standard Schema validators express.
- Default-on grounded routing or default-on abstention (gated to a later ablation-proven release).

## 10. Phasing summary

| Phase | Deliverable | Risk | Notes |
|---|---|---|---|
| **P0** | `SchemaContract` + adapter; additive pipeline generalization | Med (JSON-Schema derivation per kind) | fallback `undefined`→prompt+heal always valid |
| **P1** | `.withOutputSchema` fast path → existing pipeline + degrade-wrap; `result.object` | Low | mostly wiring |
| **P2** | Grounded engine (requirement-state ext, `schemaSatisfactionCheck`, provenance, confidence, abstention, surgical repair) | High | the moat; most effort |
| **P3** | `streamObject` deep-partial (reuse json-repair); svelte/vue binding | Med | — |
| **P4** | `.asTool` typed agent-as-tool | Med | **cut-line** if P0–P3 fill the sprint |
