// Run: bun test apps/examples/src/demos/island-sim/decision/llm.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { perceive } from "../engine/perceive.js";
import { makeScriptedDecisionMaker } from "./types.js";
import { makeLlmDecisionMaker } from "./llm.js";

describe("llm decisions", () => {
  it("asks the model for the next action and falls back to the scripted maker on provider failure", async () => {
    const world = makeFallbackWorld(70);
    const agent = world.agents[0]!;
    const perception = perceive(world, agent.id);
    const scripted = makeScriptedDecisionMaker();

    const good = await makeLlmDecisionMaker({
      run: async () => ({ object: { type: "gather", target: "res-0" } }),
    }).decide({ world, agentId: agent.id, perception });
    expect(good.action.type).toBe("gather");
    expect(good.reasoningSummary.toLowerCase()).toContain("model");

    const degraded = await makeLlmDecisionMaker({
      run: async () => { throw new Error("provider down"); },
    }, () => scripted).decide({ world, agentId: agent.id, perception });
    expect(degraded).toEqual(await scripted.decide({ world, agentId: agent.id, perception }));
  }, 15000);

  it("shows the model engine ids and degrades illegal choices to the scripted maker", async () => {
    const world = makeFallbackWorld(72);
    const agent = world.agents[0]!;
    const perception = perceive(world, agent.id);
    const scripted = makeScriptedDecisionMaker();
    let seen = "";
    const illegal = await makeLlmDecisionMaker({
      run: async (prompt: string) => {
        seen = prompt;
        return { object: { type: "gather", target: "res-999" } };
      },
    }, () => scripted).decide({ world, agentId: agent.id, perception });
    expect(seen).toContain("res-0");
    expect(seen).toContain("agent-1");
    expect(illegal.action.type).not.toBe("gather");
    expect(illegal).toEqual(await scripted.decide({ world, agentId: agent.id, perception }));
  }, 15000);

  it("rejects actions outside the action vocabulary", async () => {    const world = makeFallbackWorld(71);
    const agent = world.agents[0]!;
    const scripted = makeScriptedDecisionMaker();
    const decision = await makeLlmDecisionMaker({
      run: async () => ({ object: { type: "teleport" } }),
    }, () => scripted).decide({ world, agentId: agent.id, perception: perceive(world, agent.id) });
    expect(Object.keys(decision.probabilities ?? {})).toHaveLength(1);
    expect(decision.action.type).not.toBe("teleport");
  }, 15000);
});
