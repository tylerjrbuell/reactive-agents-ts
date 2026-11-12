// Run: bun run repo test apps/cortex/server/tests/structured-output-config.test.ts
//
// The output schema is plain JSON Schema in the AgentConfig (runtime 7d4664da2), not a Cortex
// overlay: it maps through cortexParamsToAgentConfig, the builder Cortex runs serializes it
// back, and an agent built from it extracts the answer into `result.object` with a report.
import { describe, expect, it } from "bun:test";
import { cortexAgentBuilder, buildCortexAgent } from "../services/build-cortex-agent.js";
import { cortexParamsToAgentConfig } from "../services/cortex-to-agent-config.js";
import { CORTEX_OVERLAY_CALLS } from "../services/cortex-agent-source.js";

const schema = {
  type: "object",
  properties: { city: { type: "string", description: "Where" }, pop: { type: "integer" } },
  required: ["city"],
};

describe("output schema as AgentConfig", () => {
  it("maps to outputSchema, and onParseFail only when it is throw", () => {
    const base = cortexParamsToAgentConfig({ provider: "test", outputSchema: schema });
    expect(base.outputSchema).toEqual(schema);
    expect(base.outputSchemaOptions).toBeUndefined();
    const strict = cortexParamsToAgentConfig({ provider: "test", outputSchema: schema, outputSchemaOnParseFail: "throw" });
    expect(strict.outputSchemaOptions).toEqual({ onParseFail: "throw" });
    expect(cortexParamsToAgentConfig({ provider: "test", outputSchema: {} }).outputSchema).toBeUndefined();
    expect(cortexParamsToAgentConfig({ provider: "test", outputSchemaOnParseFail: "throw" }).outputSchemaOptions).toBeUndefined();
  });

  it("is no longer an overlay call", () => {
    expect(CORTEX_OVERLAY_CALLS).not.toContain("withOutputSchema");
  });

  it("the builder Cortex runs serializes the same schema back", async () => {
    const b = await cortexAgentBuilder({ provider: "test", agentId: "so-cfg", outputSchema: schema, outputSchemaOnParseFail: "throw" });
    const config = b.toConfig();
    expect(config.outputSchema).toEqual(schema);
    expect(config.outputSchemaOptions).toMatchObject({ onParseFail: "throw" });
  });

  it("an agent built from it extracts the answer into result.object", async () => {
    const agent = await buildCortexAgent({
      provider: "test",
      agentId: "so-run",
      outputSchema: schema,
      testScenario: [{ text: JSON.stringify({ city: "Oslo", pop: 700000 }) }],
    });
    const result = await agent.run("Tell me about Oslo");
    expect(result.object).toEqual({ city: "Oslo", pop: 700000 });
    await agent.dispose();
  }, 30_000);

  it("a schema the framework cannot validate is refused when the agent is built, not ignored", async () => {
    await expect(
      buildCortexAgent({ provider: "test", agentId: "so-bad", outputSchema: { type: "object", dependentSchemas: {} } }),
    ).rejects.toThrow();
  });
});
