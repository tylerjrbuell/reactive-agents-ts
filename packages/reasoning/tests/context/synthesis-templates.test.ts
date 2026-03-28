import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { fastSynthesis } from "../../src/context/synthesis-templates.js";
import type { SynthesisInput } from "../../src/context/synthesis-types.js";

const baseMid: SynthesisInput = {
  transcript: [{ role: "user", content: "Research AI trends and write to ./report.md" }],
  task: "Research AI trends and write to ./report.md",
  taskPhase: "gather",
  requiredTools: ["web-search", "file-write"],
  toolsUsed: new Set(["web-search"]),
  availableTools: [],
  entropy: undefined,
  iteration: 2,
  maxIterations: 10,
  lastErrors: [],
  tier: "mid",
  tokenBudget: 3000,
  synthesisConfig: { mode: "fast" },
};

describe("fastSynthesis", () => {
  it("returns an array of LLMMessages", async () => {
    const messages = await Effect.runPromise(fastSynthesis(baseMid));
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBeGreaterThan(0);
  });

  it("always includes the task as the first user message", async () => {
    const messages = await Effect.runPromise(fastSynthesis(baseMid));
    expect(messages[0]!.role).toBe("user");
    expect(typeof messages[0]!.content === "string" ? messages[0]!.content : "").toContain(
      "Research AI trends",
    );
  });

  it("gather phase includes a situation status message directing next action", async () => {
    const messages = await Effect.runPromise(fastSynthesis(baseMid));
    const lastMsg = messages[messages.length - 1]!;
    expect(lastMsg.role).toBe("user");
    expect(typeof lastMsg.content === "string" ? lastMsg.content : "").toContain("file-write");
  });

  it("gather phase with errors mentions the failure", async () => {
    const withError: SynthesisInput = {
      ...baseMid,
      lastErrors: ["http-get: 404 Not Found"],
    };
    const messages = await Effect.runPromise(fastSynthesis(withError));
    const lastMsg = messages[messages.length - 1]!;
    expect(typeof lastMsg.content === "string" ? lastMsg.content : "").toContain("404");
  });

  it("orient phase produces minimal context", async () => {
    const orient: SynthesisInput = {
      ...baseMid,
      taskPhase: "orient",
      toolsUsed: new Set(),
      iteration: 0,
    };
    const messages = await Effect.runPromise(fastSynthesis(orient));
    expect(messages.length).toBeLessThanOrEqual(2);
  });

  it("synthesize phase tells model to synthesize", async () => {
    const synth: SynthesisInput = {
      ...baseMid,
      taskPhase: "synthesize",
      toolsUsed: new Set(["web-search", "file-write"]),
    };
    const messages = await Effect.runPromise(fastSynthesis(synth));
    const lastMsg = messages[messages.length - 1]!;
    const text = typeof lastMsg.content === "string" ? lastMsg.content : "";
    expect(text.toLowerCase()).toMatch(/synth|compose|write|report|gathered|output/);
  });

  it("returns defined messages for fast path", async () => {
    const messages = await Effect.runPromise(fastSynthesis(baseMid));
    expect(messages).toBeDefined();
  });
});
