// Run: bun run repo test apps/cortex/server/tests/debrief-memory.test.ts
//
// The framework writes a run debrief (`DebriefCompleted`) per `isDebriefEnabled`
// (`debrief ?? enableMemory === true`) when the run took the reasoning path
// (runtime `debrief-synthesis.ts` `shouldFinalize`). Pins: the Lab default
// (working memory on) gets a debrief, an all-off memory (the chat default) gets
// none, `rawConfig.debrief: true` gets one with memory off, `debrief: false`
// suppresses it with memory on, and a config with no memory choice still gets
// the memory layer. The UI's wording rule is `lib/debrief-memory.ts`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCortexAgent, type BuildCortexAgentParams } from "../services/build-cortex-agent.js";
import { cortexParamsToAgentConfig } from "../services/cortex-to-agent-config.js";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-debrief-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Run once on the test provider; the tags the agent published, after the debrief daemon had time to finish. */
async function runTags(params: BuildCortexAgentParams): Promise<string[]> {
  const agent = await buildCortexAgent({
    provider: "test",
    agentName: "debrief-pin",
    strategy: "reactive",
    maxIterations: 3,
    testScenario: [{ text: "The answer is 42." }],
    ...params,
  });
  const tags: string[] = [];
  const unsubscribe = await agent.subscribe((e) => void tags.push(e._tag));
  try {
    await agent.run("What is six times seven?");
    for (let i = 0; i < 40 && !tags.includes("DebriefCompleted"); i++) await new Promise((r) => setTimeout(r, 50));
  } finally {
    unsubscribe();
    await agent.dispose();
  }
  return tags;
}

describe("debrief follows memory", () => {
  it("Lab default (working memory on): the run publishes DebriefCompleted", async () => {
    const tags = await runTags({
      memory: { working: true, episodic: false, semantic: false },
      rawConfig: { memory: { dbPath: join(dir, "lab.db") } },
    });
    expect(tags).toContain("AgentCompleted");
    expect(tags).toContain("DebriefCompleted");
  }, 30_000);

  it("chat default (all memory off): no debrief", async () => {
    const tags = await runTags({ memory: { working: false, episodic: false, semantic: false } });
    expect(tags).toContain("AgentCompleted");
    expect(tags).not.toContain("DebriefCompleted");
  }, 30_000);

  it("rawConfig.debrief true with memory off: the run publishes DebriefCompleted", async () => {
    const tags = await runTags({
      memory: { working: false, episodic: false, semantic: false },
      rawConfig: { debrief: true, memory: { dbPath: join(dir, "off.db") } },
    });
    expect(tags).toContain("DebriefCompleted");
  }, 30_000);

  it("rawConfig.debrief false with memory on: no debrief", async () => {
    const tags = await runTags({
      memory: { working: true, episodic: false, semantic: false },
      rawConfig: { debrief: false, memory: { dbPath: join(dir, "on.db") } },
    });
    expect(tags).toContain("AgentCompleted");
    expect(tags).not.toContain("DebriefCompleted");
  }, 30_000);

  it("no memory choice at all: Cortex still turns memory on (as before the AgentConfig migration)", () => {
    expect(cortexParamsToAgentConfig({ provider: "test" }).features?.memory).toBe(true);
    expect(cortexParamsToAgentConfig({ provider: "test", memory: { working: true } }).memory?.tier).toBe("standard");
    expect(cortexParamsToAgentConfig({ provider: "test", memory: { working: false, episodic: false, semantic: false } }).features?.memory).toBeUndefined();
  });
});
