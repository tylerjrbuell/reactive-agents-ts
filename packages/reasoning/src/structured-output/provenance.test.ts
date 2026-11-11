import { describe, it, expect } from "bun:test";
import { Effect, Either, Schema } from "effect";
import * as v from "valibot";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { extractStructuredOutput } from "./pipeline.js";
import { toSchemaContract } from "./schema-contract.js";
import { fieldErrorsFromPath, toJsonPointer, valueChanged } from "./provenance.js";

const Item = Schema.Struct({ name: Schema.String, count: Schema.Number });

const failureOf = async (eff: Effect.Effect<unknown, Error>) => {
  const either = await Effect.runPromise(Effect.either(eff));
  if (Either.isRight(either)) throw new TypeError("expected the extraction to fail");
  return either.left;
};

describe("structured-output provenance — success reports", () => {
  it("native success: layer native, one attempt, no repairs", async () => {
    const out = await Effect.runPromise(
      extractStructuredOutput({ schema: Item, prompt: "extract" }).pipe(
        Effect.provide(TestLLMServiceLayer([{ json: { name: "n", count: 1 } }])),
      ),
    );
    expect(out.report).toEqual({
      outcome: "success",
      layer: "native",
      native: "succeeded",
      attempts: 1,
      promptAttempts: 0,
      repairs: [],
      coerced: false,
      budgetEscalated: false,
      fieldErrors: [],
    });
  });

  it("clean prompt-mode success: layer prompt", async () => {
    const out = await Effect.runPromise(
      extractStructuredOutput({ schema: Item, prompt: "extract", forcePromptMode: true, maxRetries: 0 }).pipe(
        Effect.provide(TestLLMServiceLayer([{ text: '{"name":"a","count":2}' }])),
      ),
    );
    expect(out.report.layer).toBe("prompt");
    expect(out.report.native).toBe("not-attempted");
    expect(out.report.attempts).toBe(1);
    expect(out.report.repairs).toEqual([]);
  });

  it("repaired success: layer repaired, names each repair that changed the text", async () => {
    const out = await Effect.runPromise(
      extractStructuredOutput({ schema: Item, prompt: "extract", forcePromptMode: true, maxRetries: 0 }).pipe(
        Effect.provide(TestLLMServiceLayer([{ text: 'Here:\n```json\n{"name": \'x\', "count": 3,}\n```' }])),
      ),
    );
    expect(out.data).toEqual({ name: "x", count: 3 });
    expect(out.report.layer).toBe("repaired");
    expect(out.report.repairs).toEqual(["extract-json-block", "single-quotes", "trailing-commas"]);
  });

  it("coerced success: the validator transformed the parsed value", async () => {
    const contract = toSchemaContract(v.object({ count: v.pipe(v.string(), v.transform(Number)) }));
    const out = await Effect.runPromise(
      extractStructuredOutput({ contract, prompt: "extract", forcePromptMode: true, maxRetries: 0 }).pipe(
        Effect.provide(TestLLMServiceLayer([{ text: '{"count":"5"}' }])),
      ),
    );
    expect(out.data).toEqual({ count: 5 });
    expect(out.report.layer).toBe("coerced");
    expect(out.report.coerced).toBe(true);
  });

  it("retried success: layer retried, the failed attempt's field errors are not carried", async () => {
    const out = await Effect.runPromise(
      extractStructuredOutput({ schema: Item, prompt: "extract", forcePromptMode: true, maxRetries: 1 }).pipe(
        Effect.provide(
          TestLLMServiceLayer([{ text: '{"name":1}' }, { text: '{"name":"ok","count":9}' }]),
        ),
      ),
    );
    expect(out.attempts).toBe(2);
    expect(out.report.layer).toBe("retried");
    expect(out.report.promptAttempts).toBe(2);
    expect(out.report.fieldErrors).toEqual([]);
  });

  it("native rejected by the contract then prompt success: native recorded as contract-rejected", async () => {
    const contract = toSchemaContract(Schema.Struct({ answer: Schema.String }));
    const out = await Effect.runPromise(
      extractStructuredOutput({ contract, prompt: "say hi", maxRetries: 1 }).pipe(
        Effect.provide(TestLLMServiceLayer([{ json: { wrong: 1 } }, { text: '{"answer":"ok"}' }])),
      ),
    );
    expect(out.report.native).toBe("contract-rejected");
    expect(out.report.layer).toBe("prompt");
    expect(out.report.attempts).toBe(2);
  });
});

describe("structured-output provenance — failure reports", () => {
  it("schema failure: typed error carries every field path, message unchanged", async () => {
    const err = await failureOf(
      extractStructuredOutput({ schema: Item, prompt: "extract", forcePromptMode: true, maxRetries: 0 }).pipe(
        Effect.provide(TestLLMServiceLayer([{ text: '{"name":5}' }])),
      ),
    );
    // The error text (also fed to the retry prompt) is the first-error ParseError text, as before.
    const legacy = Effect.runSync(Effect.flip(Schema.decodeUnknown(Item)({ name: 5 }))).message;
    expect(err.message).toBe(`Structured output failed after 1 attempts. Last error: ${legacy}`);
    expect("_tag" in err && err._tag).toBe("StructuredOutputExtractionError");
    const report = "report" in err ? err.report : undefined;
    expect(report).toMatchObject({ outcome: "failure", layer: null, attempts: 1, failure: { kind: "schema-mismatch" } });
    expect(report).toHaveProperty("fieldErrors", [
      { path: "/name", message: "Expected string, actual 5" },
      { path: "/count", message: "is missing" },
    ]);
  });

  it("contract failure: field errors come from the contract's issues", async () => {
    const contract = toSchemaContract(v.object({ items: v.array(v.object({ id: v.number() })) }));
    const err = await failureOf(
      extractStructuredOutput({ contract, prompt: "extract", forcePromptMode: true, maxRetries: 0 }).pipe(
        Effect.provide(TestLLMServiceLayer([{ text: '{"items":[{"id":1},{"id":"two"}]}' }])),
      ),
    );
    const report = "report" in err ? err.report : undefined;
    expect(report).toMatchObject({ failure: { kind: "schema-mismatch" } });
    expect(report).toHaveProperty(["fieldErrors", 0, "path"], "/items/1/id");
  });

  it("invalid JSON after repair: kind invalid-json, no field errors", async () => {
    const err = await failureOf(
      extractStructuredOutput({ schema: Item, prompt: "extract", forcePromptMode: true, maxRetries: 0 }).pipe(
        Effect.provide(TestLLMServiceLayer([{ text: "no json here at all" }])),
      ),
    );
    const report = "report" in err ? err.report : undefined;
    expect(report).toMatchObject({ outcome: "failure", fieldErrors: [], failure: { kind: "invalid-json" } });
  });

  it("empty output twice: kind empty-output, budget escalation recorded", async () => {
    const err = await failureOf(
      extractStructuredOutput({ schema: Item, prompt: "extract", forcePromptMode: true, maxRetries: 2 }).pipe(
        Effect.provide(TestLLMServiceLayer([{ text: "" }])),
      ),
    );
    const report = "report" in err ? err.report : undefined;
    expect(report).toMatchObject({ budgetEscalated: true, promptAttempts: 2, failure: { kind: "empty-output" } });
  });
});

describe("structured-output provenance — typed error channel", () => {
  it("catchTag narrows to the report (the documented consumer path)", async () => {
    const kind = await Effect.runPromise(
      extractStructuredOutput({ schema: Item, prompt: "extract", forcePromptMode: true, maxRetries: 0 }).pipe(
        Effect.map(() => "none"),
        Effect.catchTag("StructuredOutputExtractionError", (e) => Effect.succeed(e.report.failure?.kind ?? "none")),
        Effect.provide(TestLLMServiceLayer([{ text: '{"name":5}' }])),
      ),
    );
    expect(kind).toBe("schema-mismatch");
  });
});

describe("structured-output provenance — pure helpers", () => {
  it("toJsonPointer escapes ~ and / per RFC 6901; root is empty", () => {
    expect(toJsonPointer([])).toBe("");
    expect(toJsonPointer(["a/b", "c~d", 0])).toBe("/a~1b/c~0d/0");
  });

  it("fieldErrorsFromPath maps issues in order", () => {
    expect(fieldErrorsFromPath([{ path: ["x", 2], message: "bad" }])).toEqual([{ path: "/x/2", message: "bad" }]);
  });

  it("valueChanged is structural: equal JSON is unchanged, transformed values changed", () => {
    expect(valueChanged({ a: [1, { b: null }] }, { a: [1, { b: null }] })).toBe(false);
    expect(valueChanged({ a: "5" }, { a: 5 })).toBe(true);
    expect(valueChanged({ a: 1, extra: 2 }, { a: 1 })).toBe(true);
    expect(valueChanged([1, 2], [1, 2, 3])).toBe(true);
  });
});
