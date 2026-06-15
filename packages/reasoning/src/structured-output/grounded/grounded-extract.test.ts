import { describe, it, expect } from "bun:test";
import { Effect, Schema } from "effect";
import { groundedExtract } from "./grounded-extract.js";
import { toSchemaContract } from "../schema-contract.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BaseContract = toSchemaContract(
  Schema.Struct({ price: Schema.Number, vendor: Schema.String }),
);

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("groundedExtract", () => {
  /**
   * Test 1 — happy path: object + provenance + confidence.
   * price=64000 appears in evidenceCorpus → grounded (conf ~0.9).
   * vendor="acme" does NOT appear → ungrounded (conf ~0.4).
   * => price.confidence > vendor.confidence
   */
  it("returns object + provenance + confidence (grounded field higher confidence)", async () => {
    // Native mode: json turn bypasses prompt-mode and returns the object directly.
    const llm = TestLLMServiceLayer([{ json: { price: 64000, vendor: "acme" } }]);
    const r = await Effect.runPromise(
      groundedExtract({
        contract: BaseContract,
        finalAnswer: "price is 64000",
        evidenceCorpus: "tool returned price=64000",
        onParseFail: "degrade",
      }).pipe(Effect.provide(llm)),
    );
    expect(r.object).toEqual({ price: 64000, vendor: "acme" });
    expect(r.provenance?.price).toBeDefined();
    expect(r.provenance?.vendor).toBeUndefined(); // vendor not in corpus
    expect((r.confidence?.price ?? 0)).toBeGreaterThan(r.confidence?.vendor ?? 1);
  });

  /**
   * Test 2 — degrade path: pipeline hard-fails → objectError surfaced.
   * We send a text turn that is not valid JSON and set maxRetries=0 on the
   * pipeline. groundedExtract catches the Error and degrades.
   *
   * Strategy: force prompt-mode so complete() is called, and feed
   * invalid text so JSON extraction fails after 1 attempt (maxRetries 0 via
   * forcePromptMode with a single scenario entry that is invalid text;
   * the pipeline will fail with "Structured output failed").
   *
   * Since groundedExtract catches all errors → never channel, we just
   * expect { object: undefined, objectError: <some string> }.
   */
  it("degrades with objectError when extraction fails", async () => {
    const llm = TestLLMServiceLayer([{ text: "not json at all ~~~" }]);
    const r = await Effect.runPromise(
      groundedExtract({
        contract: BaseContract,
        finalAnswer: "garbage",
        evidenceCorpus: "",
        onParseFail: "degrade",
        _forcePromptMode: true,
        _maxRetries: 0,
      }).pipe(Effect.provide(llm)),
    );
    expect(r.object).toBeUndefined();
    expect(r.objectError).toBeDefined();
  });

  /**
   * Test 3 — abstention: vendor is ungrounded (conf ~0.4 < abstainBelow 0.5).
   * But vendor IS a required field → cannot silently drop it.
   * The object must still contain vendor (required stays), abstained stays empty for it.
   * price is grounded (conf ~0.9 >= 0.5) → not abstained.
   */
  it("keeps required fields even when confidence is below abstainBelow threshold", async () => {
    const llm = TestLLMServiceLayer([{ json: { price: 64000, vendor: "acme" } }]);
    const r = await Effect.runPromise(
      groundedExtract({
        contract: BaseContract,
        finalAnswer: "price 64000",
        evidenceCorpus: "price=64000",
        onParseFail: "degrade",
        abstainBelow: 0.5,
      }).pipe(Effect.provide(llm)),
    );
    // vendor conf ~0.4 < 0.5 but required → stays in object, NOT abstained
    expect(r.object?.price).toBe(64000);
    expect(r.object?.vendor).toBe("acme");
    expect(r.abstained?.vendor).toBeUndefined();
    // price conf ~0.9 >= 0.5 → not abstained either
    expect(r.abstained?.price).toBeUndefined();
  });

  /**
   * Test 4 — abstention: optional low-confidence field IS dropped.
   * Schema with an optional `note` field. "acme" not in corpus → conf ~0.4.
   * note is OPTIONAL → should be abstained when abstainBelow=0.5.
   */
  it("abstains optional low-confidence fields", async () => {
    const contractWithOptional = toSchemaContract(
      Schema.Struct({
        price: Schema.Number,
        note: Schema.optional(Schema.String),
      }),
    );
    // Both price (in corpus) and note (not in corpus)
    const llm = TestLLMServiceLayer([{ json: { price: 64000, note: "extra" } }]);
    const r = await Effect.runPromise(
      groundedExtract({
        contract: contractWithOptional,
        finalAnswer: "price 64000 note extra",
        evidenceCorpus: "price=64000",
        onParseFail: "degrade",
        abstainBelow: 0.5,
      }).pipe(Effect.provide(llm)),
    );
    // note is ungrounded (conf ~0.4 < 0.5) and optional → abstained
    expect(r.object?.price).toBe(64000);
    expect((r.object as Record<string, unknown> | undefined)?.note).toBeUndefined();
    expect(r.abstained?.note).toBeDefined();
  });

  /**
   * Test 5 — surgical repair: first extraction omits a required field;
   * second scripted response provides it. Final object should be complete.
   *
   * Scenario:
   *   Turn 1 (native completeStructured via json): { price: 64000 }  — missing vendor
   *   Turn 2 (prompt-mode repair via text): '{"vendor":"acme"}'       — repair response
   *
   * groundedExtract detects missing `vendor`, runs a focused re-extract,
   * merges the result → final object has both price and vendor.
   */
  it("surgically repairs missing required fields with a second extraction pass", async () => {
    // Turn 1: native structured output – missing `vendor`
    // Turn 2: repair extraction – provides the missing field
    const llm = TestLLMServiceLayer([
      { json: { price: 64000 } },          // first extraction: missing vendor
      { text: '{"vendor":"acme"}' },        // surgical repair response
    ]);
    const r = await Effect.runPromise(
      groundedExtract({
        contract: BaseContract,
        finalAnswer: "price 64000 vendor acme",
        evidenceCorpus: "price=64000 vendor=acme",
        onParseFail: "degrade",
      }).pipe(Effect.provide(llm)),
    );
    expect(r.object?.price).toBe(64000);
    expect(r.object?.vendor).toBe("acme");
    expect(r.objectError).toBeUndefined();
  });

  /**
   * Test 6 — surgical repair failure: both passes fail to fill a required field.
   * objectError should list the still-missing fields.
   */
  it("degrades with objectError listing missing required fields when repair also fails", async () => {
    // Both turns omit vendor
    const llm = TestLLMServiceLayer([
      { json: { price: 64000 } },
      { json: { price: 64000 } },           // repair also missing vendor
    ]);
    const r = await Effect.runPromise(
      groundedExtract({
        contract: BaseContract,
        finalAnswer: "price 64000",
        evidenceCorpus: "price=64000",
        onParseFail: "degrade",
      }).pipe(Effect.provide(llm)),
    );
    expect(r.object).toBeUndefined();
    expect(r.objectError).toMatch(/vendor/);
  });
});
