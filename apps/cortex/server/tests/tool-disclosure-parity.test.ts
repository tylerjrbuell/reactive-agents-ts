/**
 * Builder parity for `.withTools({ disclosure, builtins })` (skills-and-extension
 * spec §12.5 F5). Both are AgentConfig paths, so the Lab generic renderer and the
 * chat quick bar write them into `rawConfig.tools`; this pins that they survive
 * Cortex's own `withTools({ allowedTools })` call and reach the run:
 * `run-started.config.disclosure` records `{ mode, source: "withTools" }`.
 */
import { describe, expect, it } from "bun:test";
import { buildCortexAgent } from "../services/build-cortex-agent.js";

const disclosureOf = async (rawConfig: Record<string, unknown> | undefined): Promise<unknown> => {
  const agent = await buildCortexAgent({
    provider: "test",
    tools: ["web-search"],
    ...(rawConfig ? { rawConfig } : {}),
    testScenario: [{ text: "FINAL ANSWER: done" }],
  });
  let disclosure: unknown;
  try {
    await agent.subscribe((e) => {
      const ev = e as { _tag?: string; config?: { disclosure?: unknown } };
      if (ev._tag === "AgentStarted") disclosure = ev.config?.disclosure;
    });
    await agent.run("say done");
  } finally {
    await agent.dispose();
  }
  return disclosure;
};

describe("tool disclosure + toolset builtins reach the built agent", () => {
  it("rawConfig.tools.disclosure + a toolset name land on run-started.config.disclosure", async () => {
    expect(await disclosureOf({ tools: { disclosure: "index", builtins: ["read"] } })).toEqual({ mode: "index", source: "withTools" });
  }, 30000);

  it("unset disclosure keeps the tier default (Cortex does not re-default it)", async () => {
    const d = (await disclosureOf(undefined)) as { source?: string } | undefined;
    expect(d?.source).not.toBe("withTools");
  }, 30000);
});
