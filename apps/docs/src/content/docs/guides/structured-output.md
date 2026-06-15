---
title: Typed Structured Output
description: Extract a schema-validated TypeScript object from every agent run — with provenance, per-field confidence, and streaming partial objects as tokens arrive.
sidebar:
  order: 27
---

Agents produce prose. Sometimes you need a typed object — an invoice, a parsed
entity, a classification result — not a string. **Typed structured output** gives
you that: call `.withOutputSchema(schema)` and the agent populates
`result.object` as your declared type.

Two engines handle the extraction depending on what your stack supports:

- **Fast** — single-shot native JSON enforcement (frontier models with
  native function calling and no tool overlap). Lowest latency.
- **Grounded** — extracts, grounds each field against the tool-result evidence
  corpus from the run, surgically re-extracts missing required fields, and
  scores per-field confidence. Enables provenance + abstention. The
  differentiator for research or data-extraction agents.

The mode is auto-selected by default and can be overridden.

## Quick start

### With a Zod schema

```typescript
import { ReactiveAgents } from "reactive-agents";
import { z } from "zod";

const InvoiceSchema = z.object({
  vendor: z.string(),
  total: z.number(),
  currency: z.string(),
  lineItems: z.array(
    z.object({ description: z.string(), amount: z.number() })
  ),
});

const agent = await ReactiveAgents.create()
  .withName("invoice-extractor")
  .withSystemPrompt("You extract structured data from documents.")
  .withTools({ builtins: ["read-file"] })
  .withOutputSchema(InvoiceSchema)
  .build();

const result = await agent.run(
  "Extract the invoice details from invoice.pdf"
);

if (result.object) {
  // result.object is typed as z.infer<typeof InvoiceSchema>
  console.log(`${result.object.vendor}: ${result.object.total} ${result.object.currency}`);
}
```

### With an Effect Schema

```typescript
import { ReactiveAgents } from "reactive-agents";
import { Schema } from "@effect/schema";

const Invoice = Schema.Struct({
  vendor: Schema.String,
  total: Schema.Number,
  currency: Schema.String,
  lineItems: Schema.Array(
    Schema.Struct({ description: Schema.String, amount: Schema.Number })
  ),
});

const agent = await ReactiveAgents.create()
  .withName("invoice-extractor")
  .withSystemPrompt("You extract structured data from documents.")
  .withTools({ builtins: ["read-file"] })
  .withOutputSchema(Invoice)
  .build();

const result = await agent.run(
  "Extract the invoice details from invoice.pdf"
);

if (result.object) {
  // result.object is typed as Schema.Schema.Type<typeof Invoice>
  console.log(result.object.vendor);
}
```

`.withOutputSchema()` accepts any [Standard Schema v1](https://standardschema.dev/)
validator (Zod 3.24+, Valibot, ArkType) **or** an Effect `Schema.Schema<A>`. The
returned builder is re-typed so `result.object` is `A` at compile time.

## `result.object` and `result.objectError`

By default the agent is **lenient**: a parse failure does not throw. Instead:

- `result.object` is `undefined`.
- `result.objectError` is set to a human-readable description of what went wrong.

```typescript
const result = await agent.run("Extract invoice details");

if (result.object) {
  // happy path
} else if (result.objectError) {
  console.error("Extraction failed:", result.objectError);
  // fall back to result.output (the raw text answer)
}
```

## Lenient vs strict (`onParseFail`)

Choose between two failure modes via the `onParseFail` option:

| Mode | Behaviour |
|---|---|
| `"degrade"` (default) | `object` is `undefined`, `objectError` is set. Never throws. |
| `"throw"` | Throws `StructuredOutputError` (carries `.rawText` + `.issues`). |

```typescript
import { StructuredOutputError } from "reactive-agents";

const strictAgent = await ReactiveAgents.create()
  .withOutputSchema(InvoiceSchema, { onParseFail: "throw" })
  .build();

try {
  const result = await strictAgent.run("Extract invoice details");
  console.log(result.object);
} catch (e) {
  if (e instanceof StructuredOutputError) {
    console.error("Parse failed:", e.issues);
    console.log("Raw text was:", e.rawText);
  }
}
```

## The grounded path — provenance, confidence, and abstention

For extraction tasks where you need to know *why* a value was chosen — or when
model hallucination is a concern — use `mode: "grounded"`.

The grounded engine:
1. Extracts fields from the agent's final answer.
2. Grounds each field against the tool-result evidence corpus accumulated during
   the run (the actual data the agent read, not its prose summary).
3. Scores per-field confidence (0–1).
4. Surgically re-extracts missing required fields if they were omitted.

```typescript
const agent = await ReactiveAgents.create()
  .withSystemPrompt("You extract financial data from SEC filings.")
  .withTools({ builtins: ["web-search", "read-file"] })
  .withOutputSchema(InvoiceSchema, { mode: "grounded" })
  .build();

const result = await agent.run("Extract Q3 revenue from the attached 10-Q");

if (result.object) {
  console.log(result.object.total);

  // Per-field evidence trace
  console.log(result.provenance?.total);
  // → { source: "10-Q page 4", evidence: "Net revenues for Q3 were $..." }

  // Per-field confidence (0..1)
  console.log(result.confidence?.total); // → 0.97
}
```

### Abstention (opt-in)

Set `abstainBelow` to have the grounded engine omit non-required fields whose
confidence falls below a threshold, rather than emitting a low-confidence guess:

```typescript
const agent = await ReactiveAgents.create()
  .withOutputSchema(InvoiceSchema, {
    mode: "grounded",
    abstainBelow: 0.7,
  })
  .build();

const result = await agent.run("...");

// Fields below 0.7 confidence are omitted from result.object
// and recorded here instead:
console.log(result.abstained);
// → { currency: "confidence 0.42 below abstainBelow threshold" }
```

`abstainBelow` is opt-in (off by default) and requires the grounded path.

### Grounded result fields

| Field | Type | When present |
|---|---|---|
| `result.object` | `A \| undefined` | Parse succeeded |
| `result.objectError` | `string` | Parse failed (lenient mode) |
| `result.provenance` | `Record<string, { source, evidence }>` | Grounded path |
| `result.confidence` | `Record<string, number>` | Grounded path |
| `result.abstained` | `Record<string, string>` | Grounded path + `abstainBelow` set |

## `mode` option

| Value | Behaviour |
|---|---|
| `"auto"` (default) | `fast` for frontier models with native JSON + no tool overlap; else `grounded`. |
| `"fast"` | Single-shot extraction. No grounding, provenance, or abstention. |
| `"grounded"` | Loop-integrated extraction with evidence grounding. |

## Streaming structured output (`streamObject`)

Use `streamObject()` to receive a `DeepPartial<A>` as tokens arrive, finishing
with the complete validated object:

```typescript
const agent = await ReactiveAgents.create()
  .withOutputSchema(InvoiceSchema)
  .build();

for await (const { object } of agent.streamObject("Extract invoice details")) {
  // object is DeepPartial<Invoice> — fields appear as the model emits them
  if (object.vendor) process.stdout.write(`\rVendor so far: ${object.vendor}`);
}
// Final iteration carries the full validated object
```

`streamObject()` throws synchronously if `.withOutputSchema()` was not called.
When `onParseFail: "throw"` is set, it throws `StructuredOutputError` at the
end if the final buffer fails validation.

Note that `runStream()` and `resumeRun()` return the base stream / result and do
**not** carry the typed `object`; use `run()` or `streamObject()` for typed
structured output.

## Limitations

- **Lenient by default** — `onParseFail: "degrade"` means failures are silent
  unless you check `result.objectError`. Use `"throw"` when you want failures to
  be loud.
- **Grounded field-level features are richest with Effect Schema.** Standard
  Schema inputs (Zod/Valibot/ArkType) get provenance and confidence scoring, but
  requirement-tracking and surgical re-extraction of missing required fields are
  not yet derived from Standard Schema (follow-up planned).
- **`abstainBelow` and grounded-default routing are opt-in** pending cross-tier
  ablation (project lift rule). Auto-mode selects `grounded` only when the fast
  path is not applicable.
- **`runStream()` / `resumeRun()` results do not carry `result.object`** — use
  `run()` or `streamObject()` for typed output.

## See also

- [Reasoning](/guides/reasoning) — the kernel loop that populates the evidence
  corpus the grounded engine draws from.
- [Durable Execution](/guides/durable-execution) — crash-resume for long
  extraction runs.
- [Tools](/guides/tools) — tools produce the evidence that grounded extraction
  grounds against.
