import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { perceive } from "../engine/perceive.js";
import { makeScriptedDecisionMaker } from "./types.js";

describe("scripted decisions", () => {
  it("chooses rest when energy is critical", async () => {
    const w = makeFallbackWorld(21);
    const a = w.agents[0];
    a.needs.energy = 10;
    const d = await makeScriptedDecisionMaker().decide({ world: w, agentId: a.id, perception: perceive(w, a.id) });
    expect(d.action.type).toBe("rest");
  });
  it("is deterministic for identical input", async () => {
    const w = makeFallbackWorld(21);
    const m = makeScriptedDecisionMaker();
    const a = w.agents[0];
    const one = await m.decide({ world: w, agentId: a.id, perception: perceive(w, a.id) });
    const two = await m.decide({ world: w, agentId: a.id, perception: perceive(w, a.id) });
    expect(one).toEqual(two);
  });
  it("always returns an action inside the vocabulary", async () => {
    const w = makeFallbackWorld(21);
    const vocab = new Set(["move","gather","hunt","build","craft","eat","drink","rest","trade","share","talk","inspect"]);
    for (const a of w.agents) {
      const d = await makeScriptedDecisionMaker().decide({ world: w, agentId: a.id, perception: perceive(w, a.id) });
      expect(vocab.has(d.action.type)).toBe(true);
    }
  });
});