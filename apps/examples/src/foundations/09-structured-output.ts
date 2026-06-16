/**
 * Example 09: Typed Structured Output
 *
 * Demonstrates `.withOutputSchema()` for typed structured output:
 * - Define a schema with Effect Schema.Struct (or any Standard Schema — Zod,
 *   Valibot, etc. also work; top-level arrays are also supported)
 * - `result.object` is typed to the schema shape — zero casting required
 * - `result.output` contains the steered JSON string (not prose) in structured mode
 * - `result.objectError` is populated (lenient mode) when parsing fails
 * - `agent.streamObject()` yields typed DeepPartial<T> as tokens arrive
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/foundations/09-structured-output.ts
 *
 * Or with test mode (no API key needed):
 *   bun run apps/examples/src/foundations/09-structured-output.ts
 */

import { Schema } from "effect";
import { ReactiveAgents, StructuredOutputError } from "reactive-agents";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

// ─── Schema definition ────────────────────────────────────────────────────────
// Any Effect Schema.Struct works here. Zod and Valibot schemas are also
// accepted via the Standard Schema interface — swap Schema.Struct for
// z.object({ ... }) with no other changes.

const InvoiceSchema = Schema.Struct({
  total: Schema.Number,
  currency: Schema.String,
});

// Infer the TypeScript type from the schema so we keep a single source of truth.
type Invoice = typeof InvoiceSchema.Type;

export async function run(opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();

  type PN = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test";
  const provider = (opts?.provider ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")) as PN;

  console.log("=== Reactive Agents: Typed Structured Output Example ===\n");
  console.log(`Mode: ${provider !== "test" ? `LIVE (${provider})` : "TEST (deterministic)"}\n`);

  // ─── Demo 1: .withOutputSchema() → result.object ─────────────────────────

  console.log("── Demo 1: withOutputSchema + run() ──\n");

  let b = ReactiveAgents.create()
    .withName("invoice-extractor")
    .withProvider(provider);
  if (opts?.model) b = b.withModel(opts.model);
  if (provider === "test") {
    // The test provider returns this exact text as the agent's final answer.
    // The fast-path extraction then parses it against InvoiceSchema.
    b = b.withTestScenario([{ text: '{"total":4200,"currency":"USD"}' }]);
  }
  const agent = await b
    .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
    .withOutputSchema(InvoiceSchema)
    .build();

  const task = provider === "test"
    ? "Return the invoice total as JSON"
    : "Return a JSON invoice object with a total of 4200 and currency USD. Respond with only the JSON object, no prose.";

  console.log(`Task: ${task}\n`);
  const result = await agent.run(task);

  console.log(`Raw output : ${result.output}`);
  console.log(`Parsed     : ${JSON.stringify(result.object)}`);

  // result.object is typed as Invoice — access fields directly, no cast.
  const invoice = result.object as Invoice | undefined;
  if (invoice) {
    console.log(`Total      : ${invoice.total}`);
    console.log(`Currency   : ${invoice.currency}`);
  }
  console.log(`objectError: ${result.objectError ?? "(none)"}\n`);

  const demo1Passed = invoice !== undefined && invoice.total === 4200 && invoice.currency === "USD";
  console.log(`Demo 1 → ${demo1Passed ? "PASS" : "FAIL"}\n`);

  // ─── Demo 2: lenient degrade when parse fails ──────────────────────────────
  // In `onParseFail: "degrade"` mode (the default), a bad JSON answer sets
  // result.objectError and leaves result.object undefined instead of throwing.
  // In `onParseFail: "throw"` mode a StructuredOutputError is raised instead.
  //
  // We skip a second live agent call to keep the example fast. In test mode
  // we exercise the degrade path to prove it works.

  let demo2Passed = true;

  if (provider === "test") {
    console.log("── Demo 2: degrade on parse failure (test mode only) ──\n");

    let b2 = ReactiveAgents.create()
      .withName("invoice-extractor-degrade")
      .withProvider("test")
      .withTestScenario([{ text: "not-json" }])
      .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
      .withOutputSchema(InvoiceSchema, { onParseFail: "degrade" });
    const agent2 = await b2.build();

    const r2 = await agent2.run("bad input");
    await agent2.dispose();

    console.log(`object      : ${JSON.stringify(r2.object)}`);
    console.log(`objectError : ${r2.objectError ?? "(none)"}\n`);

    demo2Passed = r2.object === undefined && typeof r2.objectError === "string";
    console.log(`Demo 2 → ${demo2Passed ? "PASS (object=undefined, objectError set)" : "FAIL"}\n`);

    // Bonus: show StructuredOutputError is importable and is the right class.
    const err = new StructuredOutputError("example error");
    console.log(`StructuredOutputError instanceof check: ${err instanceof StructuredOutputError}\n`);
  } else {
    console.log("── Demo 2: degrade on parse failure (skipped in live mode — test mode only) ──\n");
  }

  // ─── Demo 3: streamObject() ───────────────────────────────────────────────

  console.log("── Demo 3: streamObject() ──\n");

  let b3 = ReactiveAgents.create()
    .withName("invoice-stream")
    .withProvider(provider);
  if (opts?.model) b3 = b3.withModel(opts.model);
  if (provider === "test") {
    b3 = b3.withTestScenario([{ text: '{"total":4200,"currency":"USD"}' }]);
  }
  const agent3 = await b3
    .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
    .withOutputSchema(InvoiceSchema)
    .build();

  const streamTask = provider === "test"
    ? "Return the invoice total as JSON"
    : "Return a JSON invoice object with total 4200 and currency USD. Respond only with the JSON.";

  let streamFinalInvoice: Partial<Invoice> | undefined;
  let partialCount = 0;

  // streamObject() yields DeepPartial<Invoice> as tokens arrive, then the
  // fully-validated Invoice as the final item.
  for await (const partial of agent3.streamObject(streamTask)) {
    partialCount++;
    streamFinalInvoice = partial.object as Partial<Invoice> | undefined;
    console.log(`  partial[${partialCount}]: ${JSON.stringify(partial.object)}`);
  }
  await agent3.dispose();

  const demo3Passed =
    partialCount >= 1 &&
    streamFinalInvoice !== undefined &&
    (streamFinalInvoice as Invoice).total === 4200 &&
    (streamFinalInvoice as Invoice).currency === "USD";

  console.log(`\nStream emitted ${partialCount} partial(s)`);
  console.log(`Final object : ${JSON.stringify(streamFinalInvoice)}`);
  console.log(`Demo 3 → ${demo3Passed ? "PASS" : "FAIL"}\n`);

  await agent.dispose();

  const passed = demo1Passed && demo2Passed && demo3Passed;

  return {
    passed,
    output: result.output,
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL");
  process.exit(r.passed ? 0 : 1);
}
