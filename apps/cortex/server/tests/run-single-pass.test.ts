/**
 * Manual / gateway runs must be ONE reasoning pass: the panel's default config (what the
 * UI posts) may not trigger continuation restarts (minIterations / reflect / REVISE loops).
 */
import { describe, expect, it } from "bun:test";
import { buildCortexAgent } from "../services/build-cortex-agent.js";
import { defaultConfig } from "../../ui/src/lib/types/agent-config.js";
import { cortexRunsPostBody } from "../../ui/src/lib/cortex-runs-post-body.js";

describe("default-config runs", () => {
  it("run exactly one kernel pass (one contract compile, no continuation restarts)", async () => {
    const { prompt: _p, ...posted } = cortexRunsPostBody("say hi", { ...defaultConfig(), provider: "test", model: "test-model", tools: [] });
    const agent = await buildCortexAgent({
      ...(posted as Record<string, never>),
      provider: "test",
      testScenario: [{ text: "FINAL ANSWER: hello" }, { text: "FINAL ANSWER: second pass (must not run)" }],
    });
    let contracts = 0;
    try {
      await agent.subscribe((e) => {
        if ((e as { _tag?: string })._tag === "ContractCompiledEmitted") contracts += 1;
      });
      const r = await agent.run("say hi");
      expect(String(r.output)).toContain("hello");
      expect(contracts).toBeLessThanOrEqual(1);
    } finally {
      await agent.dispose();
    }
  }, 60000);
});
