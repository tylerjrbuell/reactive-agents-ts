// Run: bun test packages/reasoning/tests/kernel/abstain-meta-tool.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { handleAbstain, ABSTAIN_TOOL_NAME } from "../../src/kernel/capabilities/act/meta-tool-handlers";
import { NativeFCStrategy } from "@reactive-agents/tools";

describe("abstain meta-tool handler", () => {
  it("exposes the tool name", () => {
    expect(ABSTAIN_TOOL_NAME).toBe("abstain");
  }, 15000);

  it("returns an abstained terminal intent with reason + missing", () => {
    const intent = handleAbstain({ reason: "insufficient evidence", missing: ["tool:web-search"] });
    expect(intent._tag).toBe("abstained");
    expect(intent.reason).toBe("insufficient evidence");
    expect(intent.missing).toEqual(["tool:web-search"]);
  }, 15000);

  it("defaults missing to an empty array when omitted", () => {
    const intent = handleAbstain({ reason: "cannot answer" });
    expect(intent.missing).toEqual([]);
  }, 15000);
});

describe("abstain resolver wiring (NativeFCStrategy)", () => {
  const strategy = new NativeFCStrategy();

  it("resolves a native-FC abstain tool call to {_tag:'abstained', reason, missing}", async () => {
    const result = await Effect.runPromise(
      strategy.resolve(
        {
          toolCalls: [
            {
              id: "tc-1",
              name: "abstain",
              input: { reason: "required data unavailable", missing: ["tool:database"] },
            },
          ],
          stopReason: "tool_use",
        },
        [{ name: "abstain" }],
      ),
    );
    expect(result._tag).toBe("abstained");
    if (result._tag === "abstained") {
      expect(result.reason).toBe("required data unavailable");
      expect(result.missing).toEqual(["tool:database"]);
    }
  }, 15000);

  it("resolves an abstain call with no missing array to {missing:[]}", async () => {
    const result = await Effect.runPromise(
      strategy.resolve(
        {
          toolCalls: [{ id: "tc-2", name: "abstain", input: { reason: "no evidence" } }],
          stopReason: "tool_use",
        },
        [{ name: "abstain" }],
      ),
    );
    expect(result._tag).toBe("abstained");
    if (result._tag === "abstained") {
      expect(result.missing).toEqual([]);
    }
  }, 15000);

  it("does NOT intercept regular tool calls as abstained", async () => {
    const result = await Effect.runPromise(
      strategy.resolve(
        {
          toolCalls: [{ id: "tc-3", name: "web-search", input: { query: "hello" } }],
          stopReason: "tool_use",
        },
        [{ name: "web-search" }],
      ),
    );
    expect(result._tag).toBe("tool_calls");
  }, 15000);
});
