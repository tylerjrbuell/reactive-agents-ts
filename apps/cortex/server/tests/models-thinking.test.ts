import { describe, expect, it } from "bun:test";
import { modelsRouter } from "../api/models.js";
import { normalizeCortexAgentConfig } from "../services/cortex-agent-config.js";

describe("model thinking support", () => {
  it("framework models carry supportsThinking from the capability table (true/false/null, never undefined)", async () => {
    const res = await modelsRouter.handle(new Request("http://localhost/api/models/framework/anthropic"));
    const body = (await res.json()) as { models: Array<{ name: string; supportsThinking: boolean | null }> };
    expect(body.models.length).toBeGreaterThan(0);
    for (const m of body.models) expect([true, false, null]).toContain(m.supportsThinking);
    expect(body.models.some((m) => m.supportsThinking === true)).toBe(true);
  });
});

describe("thinking in persisted config", () => {
  it("keeps a boolean and drops null/garbage so the model default (auto) applies", () => {
    expect(normalizeCortexAgentConfig({ thinking: true }).thinking).toBe(true);
    expect(normalizeCortexAgentConfig({ thinking: false }).thinking).toBe(false);
    expect("thinking" in normalizeCortexAgentConfig({ thinking: null })).toBe(false);
    expect("thinking" in normalizeCortexAgentConfig({ thinking: "yes" })).toBe(false);
  });
});
