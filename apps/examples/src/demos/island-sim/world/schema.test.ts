import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "./fallback.js";
import { parseWorld } from "./schema.js";

describe("world schema", () => {
  it("fallback world is schema-valid with 8 agents and a hidden fact", () => {
    const w = makeFallbackWorld(42);
    const parsed = parseWorld(w);
    expect(parsed).toBeDefined();
    expect(w.agents).toHaveLength(8);
    expect(w.hidden.secrets.length).toBeGreaterThan(0);
    expect(w.seed).toBe(42);
    expect(w.clock).toEqual({ tick: 0, day: 1, hour: 0 });
  });
  it("rejects a world missing required fields", () => {
    expect(parseWorld({ id: "x" })).toBeUndefined();
  });
  it("rejects an agent with a negative need", () => {
    const w = makeFallbackWorld(1);
    const bad = { ...w, agents: [{ ...w.agents[0], needs: { hunger: -1, thirst: 5, energy: 5 } }] } as any;
    expect(parseWorld(bad)).toBeUndefined();
  });
});
