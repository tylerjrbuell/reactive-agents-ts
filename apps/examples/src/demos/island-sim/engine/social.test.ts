import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { applyTrust, reputationOf } from "./social.js";
import { regrowResources, depleteResource } from "./resources.js";

describe("social", () => {
  it("applyTrust clamps to [-1,1] and updates both sides", () => {
    const w = makeFallbackWorld(9);
    const { a, b } = applyTrust(w.agents[0], w.agents[1], 5);
    expect(a.relationships[b.id].trust).toBeLessThanOrEqual(1);
    expect(b.relationships[a.id].trust).toBeLessThanOrEqual(1);
  });
  it("reputationOf is the mean inbound trust", () => {
    const w = makeFallbackWorld(9);
    const r = reputationOf(w.agents[0], w.agents.slice(1));
    expect(Number.isFinite(r)).toBe(true);
  });
});

describe("resources", () => {
  it("depleteResource reduces quantity and never below zero", () => {
    const w = makeFallbackWorld(9);
    const id = w.resources[0].id;
    const w2 = depleteResource(w, id, 9999);
    expect(w2.resources.find(r => r.id === id)!.quantity).toBe(0);
  });
  it("regrowResources never exceeds the original quantity", () => {
    const w = makeFallbackWorld(9);
    const id = w.resources[0].id;
    const depleted = depleteResource(w, id, 9999);
    const regrown = regrowResources(depleted, 10);
    const originalQty = w.resources.find(r => r.id === id)!.quantity;
    const regrownQty = regrown.resources.find(r => r.id === id)!.quantity;
    expect(regrownQty).toBeLessThanOrEqual(originalQty);
  });
});
