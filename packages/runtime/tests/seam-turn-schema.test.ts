/**
 * Per-turn structured output: `runStream(task, { outputSchema })`
 * (agent/turn-schema.ts). Direct-import pin on `runTurnWithSchema` plus the
 * public `runStream()` path.
 *
 * Run: bun test packages/runtime/tests/seam-turn-schema.test.ts --timeout 20000
 */
import { describe, test, expect } from "bun:test";
import { Schema } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import { AgentStream } from "../src/agent-stream.js";
import { runTurnWithSchema } from "../src/agent/turn-schema.js";
import type { AgentStreamEvent } from "../src/stream-types.js";

const CITY = {
  type: "object",
  properties: { city: { type: "string" } },
  required: ["city"],
  additionalProperties: false,
} as const;

const STEERED = "Respond with ONLY a single JSON object";

type Completed = Extract<AgentStreamEvent, { _tag: "StreamCompleted" }>;

const build = (turns: Parameters<ReturnType<typeof ReactiveAgents.create>["withTestScenario"]>[0]) =>
  ReactiveAgents.create().withName("turn-schema").withTestScenario(turns).build();

const drain = async (gen: AsyncIterable<AgentStreamEvent>): Promise<AgentStreamEvent[]> => {
  const out: AgentStreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
};

describe("runStream(task, { outputSchema })", () => {
  test("the turn is steered to JSON and StreamCompleted carries the typed object", async () => {
    // Only a steered prompt gets the JSON answer; an unsteered one gets prose.
    const agent = await build([{ match: STEERED, text: '{"city":"Lima"}' }, { text: "Lima is a city." }]);
    try {
      const events = await drain(agent.runStream("Name a capital", { outputSchema: CITY }));
      const done = events.at(-1) as Completed;
      expect(done._tag).toBe("StreamCompleted");
      expect(done.object).toEqual({ city: "Lima" });
      expect(done.objectError).toBeUndefined();
    } finally {
      await agent.dispose();
    }
  }, 20000);

  test("an Effect Schema works too, and collect() carries the object onto the result", async () => {
    const agent = await build([{ match: STEERED, text: '{"city":"Quito"}' }, { text: "Quito." }]);
    try {
      const result = await AgentStream.collect(
        agent.runStream("Name a capital", { outputSchema: Schema.Struct({ city: Schema.String }) }),
      );
      expect(result.object).toEqual({ city: "Quito" });
    } finally {
      await agent.dispose();
    }
  }, 20000);

  test("without outputSchema the turn is unchanged: no steering, no object fields", async () => {
    const agent = await build([{ match: STEERED, text: '{"city":"Lima"}' }, { text: "Lima is a city." }]);
    try {
      const events = await drain(agent.runStream("Name a capital"));
      const done = events.at(-1) as Completed;
      expect(done.output).toContain("Lima is a city.");
      expect("object" in done || "objectError" in done || "objectReport" in done).toBe(false);
    } finally {
      await agent.dispose();
    }
  }, 20000);

  test("an unsupported JSON Schema ends the stream with one StreamError and runs nothing", async () => {
    let started = false;
    const events = await drain(
      runTurnWithSchema({ type: "object", if: {} }, "x", undefined as never, async function* () {
        started = true;
        yield { _tag: "TextDelta", text: "never" } as AgentStreamEvent;
      }),
    );
    expect(started).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]!._tag).toBe("StreamError");
    expect((events[0] as { cause: string }).cause).toContain('unsupported keyword "if"');
  });

  test("a paused or failed completion passes through untouched", async () => {
    const paused: AgentStreamEvent = {
      _tag: "StreamCompleted",
      output: "",
      metadata: { duration: 0, cost: 0, tokensUsed: 0, stepsCount: 0 },
      status: "awaiting-approval",
      success: false,
    };
    const events = await drain(
      runTurnWithSchema(CITY, "x", undefined as never, async function* () {
        yield paused;
      }),
    );
    expect(events).toEqual([paused]);
  });
});
