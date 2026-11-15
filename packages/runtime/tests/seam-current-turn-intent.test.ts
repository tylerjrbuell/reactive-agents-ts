import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { HISTORY_BLOCK_MARKER, CURRENT_MESSAGE_MARKER } from "@reactive-agents/reasoning";
import { extractIntentText } from "../src/engine/util.js";
import { withHistoryBlock } from "../src/agent/history-block.js";
import { formatHistoryBlock } from "../src/gateway-context-formatting.js";
import { classifyTools } from "../src/engine/phases/agent-loop/setup/classifier.js";
import { makeModelCalibration, makeRuntimeConfig, makeTask } from "../src/testing/index.js";

const history = [
  { role: "user" as const, content: "please use the calculator to add 5 and 7", timestamp: 1 },
  { role: "assistant" as const, content: "12", timestamp: 2 },
];

const NoLLM = Layer.succeed(LLMService, {
  complete: () => Effect.die(new Error("no LLM")),
  stream: () => Effect.die(new Error("no LLM")),
} as never);

const run = (input: string) =>
  Effect.runPromise(
    classifyTools({
      config: makeRuntimeConfig({
        agentId: "a",
        enableGuardrails: false,
        adaptiveToolFiltering: true,
        requiredTools: { tools: undefined, adaptive: true },
      } as never),
      task: makeTask({ id: "t", agentId: "a", input, metadata: { tags: [] } }),
      cachedToolDefs: [{ name: "calculator" }, { name: "search" }],
      resolvedCalibration: makeModelCalibration({ classifierReliability: "low" }),
      obs: null,
      isNormal: false,
    } as never).pipe(Effect.provide(NoLLM)) as Effect.Effect<{ effectiveRequiredTools?: readonly string[] }>,
  );

describe("seam: intent readers see only the current turn", () => {
  it("marker constants match what the runtime writes", () => {
    expect(formatHistoryBlock(history)).toContain(HISTORY_BLOCK_MARKER);
    expect(withHistoryBlock("hi", history)).toContain(CURRENT_MESSAGE_MARKER);
  });

  it("extractIntentText drops the history block", () => {
    expect(extractIntentText(withHistoryBlock("thanks", history)).trim()).toBe("thanks");
    expect(extractIntentText("plain")).toBe("plain");
  });

  it("history-only tool mention does not require the tool", async () => {
    const r = await run(withHistoryBlock("thanks", history));
    expect(r.effectiveRequiredTools ?? []).toEqual([]);
  });

  it("current-turn tool mention still requires the tool", async () => {
    const r = await run(withHistoryBlock("use the calculator again", history));
    expect(r.effectiveRequiredTools).toEqual(["calculator"]);
  });
});
