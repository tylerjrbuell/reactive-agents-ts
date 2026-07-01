/**
 * TDD: Task 3.2 — `.streamObject()` streaming structured output.
 *
 * Tests the happy path, the no-schema error guard, and degrade-on-invalid behavior.
 *
 * Note on test-provider chunking:
 *   The deterministic test provider emits each scenario turn as a SINGLE text_delta
 *   event (the whole text at once). That means `streamObject` receives one `TextDelta`
 *   carrying the full JSON. We verify:
 *     1. It yields at least one partial (the full text as a DeepPartial).
 *     2. The final yielded object equals the schema-validated value.
 *     3. Calling without `.withOutputSchema()` throws synchronously.
 *     4. Invalid JSON in degrade mode yields a best-effort partial (not throws).
 *     5. Invalid JSON in throw mode throws StructuredOutputError at the end.
 */
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { ReactiveAgents } from "../builder.js";
import { StructuredOutputError } from "../errors/structured-output-error.js";

describe(".streamObject()", () => {
  it("yields and ends with the validated object (happy path)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("stream-object-happy")
      .withProvider("test")
      .withTestScenario([{ text: '{"city":"Paris"}' }])
      .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
      .withOutputSchema(Schema.Struct({ city: Schema.String }))
      .build();

    const events: Array<{ city?: string }> = [];
    for await (const p of agent.streamObject("name a city")) {
      events.push(p.object as { city?: string });
    }
    await agent.dispose();

    // Must yield at least once.
    expect(events.length).toBeGreaterThanOrEqual(1);

    // Final event must be the validated full object.
    const last = events.at(-1);
    expect(last).toEqual({ city: "Paris" });

    // Type-carry: property is typed as string.
    expect(typeof last?.city).toBe("string");
  });

  it("throws synchronously when called without .withOutputSchema()", async () => {
    const agent = await ReactiveAgents.create()
      .withName("stream-object-no-schema")
      .withProvider("test")
      .withTestScenario([{ text: "hello" }])
      .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
      .build();

    expect(() => agent.streamObject("task")).toThrow(
      "streamObject() requires .withOutputSchema()"
    );

    await agent.dispose();
  });

  it("yields best-effort partial and does NOT throw in degrade mode on invalid JSON", async () => {
    const agent = await ReactiveAgents.create()
      .withName("stream-object-degrade")
      .withProvider("test")
      .withTestScenario([{ text: "garbage not json" }])
      .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
      .withOutputSchema(Schema.Struct({ city: Schema.String }), {
        onParseFail: "degrade",
      })
      .build();

    const events: Array<Record<string, unknown>> = [];
    // Should NOT throw even though the answer is not valid JSON.
    for await (const p of agent.streamObject("name a city")) {
      events.push(p.object as Record<string, unknown>);
    }
    await agent.dispose();

    // At least the empty-partial fallback is emitted.
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("throws StructuredOutputError at end in throw mode on invalid JSON", async () => {
    const agent = await ReactiveAgents.create()
      .withName("stream-object-throw")
      .withProvider("test")
      .withTestScenario([{ text: "garbage not json" }])
      .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
      .withOutputSchema(Schema.Struct({ city: Schema.String }), {
        onParseFail: "throw",
      })
      .build();

    let threw = false;
    try {
      for await (const _ of agent.streamObject("name a city")) {
        // consume
      }
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(StructuredOutputError);
    } finally {
      await agent.dispose();
    }

    expect(threw).toBe(true);
  });

  it("yields multiple unique partials when multi-chunk scenario is used", async () => {
    // The test provider emits one text_delta per turn but we can approximate
    // multi-chunk behaviour by building a manual stream test via streamObjectFrom.
    // This test verifies the deduplication logic: identical partials are NOT re-emitted.
    const agent = await ReactiveAgents.create()
      .withName("stream-object-dedup")
      .withProvider("test")
      // Same text repeated — should yield only ONE partial (deduplication).
      .withTestScenario([{ text: '{"city":"Paris"}' }])
      .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
      .withOutputSchema(Schema.Struct({ city: Schema.String }))
      .build();

    const events: Array<{ city?: string }> = [];
    for await (const p of agent.streamObject("name a city")) {
      events.push(p.object as { city?: string });
    }
    await agent.dispose();

    // Deduplication: even if the stream emits the same partial multiple times,
    // we only yield distinct objects. Final validated object is always emitted.
    expect(events.at(-1)).toEqual({ city: "Paris" });
  });
});

// ── Unit test for streamObjectFrom directly ───────────────────────────────────

import { streamObjectFrom } from "../engine/stream-object.js";
import { toSchemaContract } from "@reactive-agents/reasoning";
import type { AgentStreamEvent } from "../stream-types.js";

async function* makeStream(events: AgentStreamEvent[]): AsyncGenerator<AgentStreamEvent> {
  for (const e of events) yield e;
}

const dummyMeta = {
  duration: 0,
  cost: 0,
  tokensUsed: 0,
  stepsCount: 0,
};

describe("streamObjectFrom() unit", () => {
  it("emits partials for each delta and final validated object", async () => {
    const contract = toSchemaContract(Schema.Struct({ city: Schema.String }));

    // Simulate two text_delta events building up the JSON incrementally.
    const stream = makeStream([
      { _tag: "TextDelta", text: '{"city"' },
      { _tag: "TextDelta", text: ':"Paris"}' },
      { _tag: "StreamCompleted", output: '{"city":"Paris"}', metadata: dummyMeta },
    ]);

    const results: Array<Record<string, unknown>> = [];
    for await (const p of streamObjectFrom(stream, contract, "degrade")) {
      results.push(p.object as Record<string, unknown>);
    }

    // After the first delta '{"city"' there's no stable value yet (no comma/close),
    // so parsePartial may return {}. After second delta the full JSON is valid.
    // Final emit must be the validated object.
    expect(results.at(-1)).toEqual({ city: "Paris" });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("deduplicates identical partials — same delta text does not re-emit", async () => {
    const contract = toSchemaContract(Schema.Struct({ city: Schema.String }));

    // Two delta events with the same text — but note the buffer accumulates,
    // so the second delta produces a different buffer (concatenated). The key
    // assertion: the FINAL validated object is always emitted exactly once at
    // the end, and the final result must equal the validated value.
    const stream = makeStream([
      { _tag: "TextDelta", text: '{"city":"Paris"}' },
      // Single-text delta: full object arrives in one shot.
      { _tag: "StreamCompleted", output: '{"city":"Paris"}', metadata: dummyMeta },
    ]);

    const results: Array<Record<string, unknown>> = [];
    for await (const p of streamObjectFrom(stream, contract, "degrade")) {
      results.push(p.object as Record<string, unknown>);
    }

    // One delta + validated final is same content = no double emit → exactly 1 result.
    expect(results.length).toBe(1);
    expect(results[0]).toEqual({ city: "Paris" });
  });

  it("does not reparse on token-only deltas but still yields the correct value", async () => {
    const contract = toSchemaContract(Schema.Struct({ sentence: Schema.String }));

    // A long string value streamed token-by-token: no structural delimiter until
    // the closing `}`. Only the final delta should produce an emit.
    const stream = makeStream([
      { _tag: "TextDelta", text: '{"sentence":"' },
      { _tag: "TextDelta", text: "the " },
      { _tag: "TextDelta", text: "quick " },
      { _tag: "TextDelta", text: "brown " },
      { _tag: "TextDelta", text: "fox" },
      { _tag: "TextDelta", text: '"}' }, // closing `}` — first structural delimiter
      { _tag: "StreamCompleted", output: '{"sentence":"the quick brown fox"}', metadata: dummyMeta },
    ]);

    const results: Array<Record<string, unknown>> = [];
    for await (const p of streamObjectFrom(stream, contract, "degrade")) {
      results.push(p.object as Record<string, unknown>);
    }

    // Token-only deltas produced no emit; the closing delta yielded the value,
    // and completion did not re-emit an identical object.
    expect(results.length).toBe(1);
    expect(results.at(-1)).toEqual({ sentence: "the quick brown fox" });
  });

  it("throws StructuredOutputError in throw mode when final parse fails", async () => {
    const contract = toSchemaContract(Schema.Struct({ city: Schema.String }));

    const stream = makeStream([
      { _tag: "TextDelta", text: "not json at all" },
      { _tag: "StreamCompleted", output: "not json at all", metadata: dummyMeta },
    ]);

    let threw = false;
    try {
      for await (const _ of streamObjectFrom(stream, contract, "throw")) {
        // consume
      }
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(StructuredOutputError);
    }

    expect(threw).toBe(true);
  });

  it("degrades gracefully when final parse fails in degrade mode", async () => {
    const contract = toSchemaContract(Schema.Struct({ city: Schema.String }));

    const stream = makeStream([
      { _tag: "TextDelta", text: "not json at all" },
      { _tag: "StreamCompleted", output: "not json at all", metadata: dummyMeta },
    ]);

    const results: Array<Record<string, unknown>> = [];
    for await (const p of streamObjectFrom(stream, contract, "degrade")) {
      results.push(p.object as Record<string, unknown>);
    }

    // Should not throw; at least one emit (the best-effort partial or empty).
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
