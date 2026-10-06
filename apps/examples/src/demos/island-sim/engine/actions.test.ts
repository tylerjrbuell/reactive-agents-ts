import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { perceive } from "../engine/perceive.js"; // placeholder import; not needed for this test
import { makeRng } from "../engine/rng.js";
import { applyAction } from "../engine/actions.js";
import { decayNeeds, needsCritical } from "../engine/needs.js";

const dummyRng = makeRng(1);

describe("applyAction", () => {
  it("move valid", () => {
    const w = makeFallbackWorld(5);
    const a = w.agents[0];
    const isAdj = (a: string, b: string) => {
      const colA = a.charCodeAt(0);
      const rowA = parseInt(a.slice(1),10);
      const colB = b.charCodeAt(0);
      const rowB = parseInt(b.slice(1),10);
      return Math.max(Math.abs(colA-colB), Math.abs(rowA-rowB))===1;
    };
    const adj = w.terrain.find(t => t.tile !== a.location && t.biome !== "ocean" && isAdj(a.location, t.tile))?.tile;

    if (!adj) throw new Error("no adjacent");
    const res = applyAction(w, a.id, { type: "move", target: adj }, dummyRng);
    expect(res.ok).toBe(true);
    expect(res.world.agents[0].location).toBe(adj);
    expect(res.events[0].kind).toBe("agent-moved");
  });
  it("move invalid fails", () => {
    const w = makeFallbackWorld(5);
    const a = w.agents[0];
    const res = applyAction(w, a.id, { type: "move", target: "Z9" }, dummyRng);
    expect(res.ok).toBe(false);
    expect(res.events[0].kind).toBe("action-failed");
  });
});

describe("needs", () => {
  it("decay adds hunger/thirst", () => {
    const w = makeFallbackWorld(5);
    const a = w.agents[0];
    const before = a.needs.hunger;
    const newA = decayNeeds(a, w.weather);
    expect(newA.needs.hunger).toBeGreaterThanOrEqual(before);
  });
  it("critical need detection", () => {
    const a = {
      needs: { hunger: 9, thirst: 2, energy: 2 },
    } as any;
    expect(needsCritical(a)).toBe("hunger");
  });
});
