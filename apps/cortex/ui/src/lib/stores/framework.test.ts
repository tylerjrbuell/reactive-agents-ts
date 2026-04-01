import { describe, it, expect } from "bun:test";
import {
  createAgent,
  createAgentStream,
  createCortexAgentRun,
  createCortexAgentStreamRun,
} from "./framework.js";

describe("@reactive-agents/svelte via cortex framework barrel", () => {
  it("createCortexAgentRun exposes subscribe + run like createAgent", () => {
    const a = createCortexAgentRun("/x");
    const b = createAgent("/x");
    expect(typeof a.subscribe).toBe("function");
    expect(typeof a.run).toBe("function");
    expect(typeof b.run).toBe("function");
  });

  it("createCortexAgentStreamRun exposes subscribe + run + cancel", () => {
    const s = createCortexAgentStreamRun("/stream");
    expect(typeof s.subscribe).toBe("function");
    expect(typeof s.run).toBe("function");
    expect(typeof s.cancel).toBe("function");
  });
});
