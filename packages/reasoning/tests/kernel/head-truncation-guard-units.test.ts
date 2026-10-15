// Run: bun test packages/reasoning/tests/kernel/head-truncation-guard-units.test.ts --timeout 15000
/**
 * W2e — head-truncation guard UNIT suite: the ladder's deterministic
 * semantics on synthetic wire content (message granularity under test
 * control; the integration suite pins the firing through the real think.ts
 * seam).
 *
 * Numbers are SELF-CALIBRATED: `numCtx` is derived from
 * `estimateWireTokens` (the guard's own exported arithmetic) so every bill
 * is exact regardless of the estimator's content-classification branches.
 *
 * Pins: fit → identity (byte-identical no-op); schema rung pays first with
 * required + classifier-relevant protected; non-protected drop order is
 * TAIL-of-registration first (documented classifier-absent fallback);
 * history rung drops oldest-first and always keeps the newest turn; the
 * stillOverflowing report when both rungs exhaust; the schema term is
 * actually counted (a request that fits without tools overflows with them).
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import type { LLMMessage } from "@reactive-agents/llm-provider";
import {
  estimateWireTokens,
  preflightHeadTruncation,
  type WireToolPayload,
} from "../../src/kernel/capabilities/reason/head-truncation-guard.js";

const SYS = "You are an agent. " + "identity rule. ".repeat(50);
const BUDGET = 1200;

function msg(i: number): LLMMessage {
  const pairs: string[] = [];
  for (let k = 0; k < 40; k++) pairs.push(`"f${i}-${k}":"v${i}-${k}"`);
  return { role: "user", content: `{${pairs.join(",")}}`.repeat(5) };
}

function tool(i: number): WireToolPayload {
  return {
    name: `tool-${i}`,
    description: "",
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 24 }, (_, k) => [`param${k}`, { type: "string", enum: ["a", "b"] }]),
      ),
      required: ["q"],
    },
  };
}

function run(args: {
  messages: readonly LLMMessage[];
  wireTools: readonly WireToolPayload[];
  numCtx: number;
  requiredTools?: readonly string[];
  relevantTools?: readonly string[];
}) {
  return Effect.runPromise(
    preflightHeadTruncation({
      systemPrompt: SYS,
      messages: args.messages,
      wireTools: args.wireTools,
      outputBudget: BUDGET,
      numCtx: args.numCtx,
      tokenizerFamily: "llama",
      requiredTools: args.requiredTools ?? [],
      relevantTools: args.relevantTools ?? [],
    }),
  );
}

const est = (
  messages: readonly LLMMessage[],
  wireTools: readonly WireToolPayload[],
) => Effect.runPromise(estimateWireTokens(SYS, messages, wireTools, "llama"));

describe("W2e guard units — fit path & schema-term honesty", () => {
  it("fit → identity: same array references in, same out, fired=false (byte-identical wire)", async () => {
    const messages = [msg(0)];
    const tools = [tool(0)];
    const out = await run({ messages, wireTools: tools, numCtx: 20_000 });
    expect(out.fired).toBe(false);
    expect(out.messages).toBe(messages);
    expect(out.wireTools).toBe(tools);
    expect(out.droppedToolNames).toEqual([]);
    expect(out.droppedMessageCount).toBe(0);
    expect(out.stillOverflowing).toBe(false);
  }, 15000);

  it("a thread that fits with NO tools OVERFLOWS once the 8-tool schema term is added — the term no pre-2.5 estimate carried", async () => {
    const messages = Array.from({ length: 4 }, (_, i) => msg(i));
    const tools = Array.from({ length: 8 }, (_, i) => tool(i));

    const withTools = await est(messages, tools);
    const noTools = await est(messages, []);
    // The schema term is real and material.
    expect(withTools - noTools).toBeGreaterThan(500);

    // Window sized so the bare thread fits but +schemas overflow by ~500.
    const out = await run({ messages, wireTools: tools, numCtx: noTools + BUDGET + 500 });
    expect(out.fired).toBe(true);
    expect(out.stillOverflowing).toBe(false);
    expect(out.droppedToolNames.length).toBeGreaterThan(0);
    // History paid nothing — the surface covered the bill.
    expect(out.droppedMessageCount).toBe(0);
  }, 15000);
});

describe("W2e guard units — rung 1: schema shrink order + protection", () => {
  it("overflow inside the pool: tail-of-registration non-required tools drop FIRST, required survive, history untouched", async () => {
    const messages = Array.from({ length: 6 }, (_, i) => msg(i));
    const tools = Array.from({ length: 8 }, (_, i) => tool(i));
    const withTools = await est(messages, tools);
    const oneTool = await est([], [tool(0)]);
    // Bill ≈ 2.5 tools' worth → comfortably inside the 6-candidate pool.
    const numCtx = withTools + BUDGET - Math.round(2.5 * oneTool);
    const out = await run({
      messages,
      wireTools: tools,
      numCtx,
      requiredTools: ["tool-0", "tool-1"],
    });

    expect(out.fired).toBe(true);
    expect(out.droppedMessageCount).toBe(0);
    expect(out.messages).toBe(messages);
    // Tail-first: tool-7 (last non-required registered) went first…
    expect(out.droppedToolNames[0]).toBe("tool-7");
    // …and the required pair NEVER drops.
    const names = new Set(out.wireTools.map((t) => t.name));
    expect(names.has("tool-0")).toBe(true);
    expect(names.has("tool-1")).toBe(true);
    const after = await est(out.messages, out.wireTools);
    expect(after + BUDGET).toBeLessThanOrEqual(numCtx);
  }, 15000);

  it("classifier-relevant tools join the protected set when rankings exist", async () => {
    const messages = Array.from({ length: 6 }, (_, i) => msg(i));
    const tools = Array.from({ length: 8 }, (_, i) => tool(i));
    const withTools = await est(messages, tools);
    // Bill far exceeds the UNPROTECTED pool (tool-0..5): every candidate
    // drops — but the classifier-ranked tool-7/tool-6 ride through.
    const out = await run({
      messages,
      wireTools: tools,
      numCtx: withTools + BUDGET - 6_000,
      requiredTools: [],
      relevantTools: ["tool-7", "tool-6"],
    });
    const names = new Set(out.wireTools.map((t) => t.name));
    expect(names.has("tool-7")).toBe(true);
    expect(names.has("tool-6")).toBe(true);
    // The un-ranked tail paid first.
    expect(out.droppedToolNames[0]).toBe("tool-5");
  }, 15000);
});

describe("W2e guard units — rung 2: history ladder", () => {
  it("when the schema pool exhausts, history trims OLDEST-FIRST and the newest turn always survives", async () => {
    const messages = Array.from({ length: 10 }, (_, i) => msg(i));
    const tools = Array.from({ length: 2 }, (_, i) => tool(i));
    const withTools = await est(messages, tools);
    const out = await run({
      messages,
      wireTools: tools,
      // Bill beyond the 2-tool pool but payable from history.
      numCtx: withTools + BUDGET - Math.max(2_000, await est([], tools) + 100),
    });

    expect(out.fired).toBe(true);
    // Rung 1 first: every droppable tool went…
    expect(out.wireTools.length).toBe(0);
    // …ONLY then history trimmed.
    expect(out.droppedMessageCount).toBeGreaterThan(0);
    // Oldest-first: the survivor tail is the NEWEST messages, in order.
    expect(out.messages[out.messages.length - 1]).toBe(messages[messages.length - 1]);
    expect(out.messages[0]).toBe(messages[messages.length - out.messages.length]);
    // And the final thread genuinely fits now.
    const after = await est(out.messages, out.wireTools);
    expect(after + BUDGET).toBeLessThanOrEqual(out.correctedTokensBefore + BUDGET);
  }, 15000);

  it("unpayable bill → stillOverflowing=true, everything droppable dropped, single newest message kept, system prompt untouched", async () => {
    const messages = [msg(0), msg(1)];
    const out = await run({
      messages,
      wireTools: [tool(0)],
      numCtx: await est([], [tool(0)]) + BUDGET - 5_000,
    });
    expect(out.fired).toBe(true);
    expect(out.wireTools.length).toBe(0);
    expect(out.messages.length).toBe(1); // floor: newest always kept
    expect(out.stillOverflowing).toBe(true);
    // The head is never the sacrifice: the system prompt is not a resource.
    const floorCost = await est([messages[1]!], []);
    expect(out.correctedTokensAfter).toBe(floorCost);
  }, 15000);
});
