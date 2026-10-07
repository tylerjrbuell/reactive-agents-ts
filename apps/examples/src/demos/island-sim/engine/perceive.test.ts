// Run: bun test apps/examples/src/demos/island-sim/engine/perceive.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { perceive, renderPerception } from "./perceive.js";

/** Distance helper used in test expectations */
function distance(a: string, b: string): number {
  const colA = a.charCodeAt(0);
  const rowA = parseInt(a.slice(1), 10);
  const colB = b.charCodeAt(0);
  const rowB = parseInt(b.slice(1), 10);
  return Math.max(Math.abs(colA - colB), Math.abs(rowA - rowB));
}

describe("perceive", () => {
  it("never includes hidden facts, even as canaries", () => {
    const source = makeFallbackWorld(11);
    const w = { ...source, hidden: { ...source.hidden, secrets: ["CANARY_SECRET_7431", "poisoned spring canary"] } };
    for (const a of w.agents) {
      const text = renderPerception(perceive(w, a.id));
      expect(text).not.toContain("CANARY_SECRET_7431");
      expect(text).not.toContain("poisoned spring canary");
    }
  }, 15000);

  it("only includes entities within the vision radius", () => {
    const w = makeFallbackWorld(11);
    const p = perceive(w, w.agents[0].id);
    const selfLoc = w.agents[0].location;
    for (const r of p.visibleResources) {
      expect(distance(selfLoc, r.tile)).toBeLessThanOrEqual(2);
    }
  }, 15000);

  it("includes the agent's own memory and relationships", () => {
    const source = makeFallbackWorld(11);
    const w = {
      ...source,
      agents: source.agents.map((agent, index) => index === 0
        ? { ...agent, memory: [{ tick: 0, text: "saw berries" }] }
        : agent),
    };
    const p = perceive(w, w.agents[0].id);
    expect(p.memory).toHaveLength(1);
    expect(Object.keys(p.relationships)).toEqual(Object.keys(w.agents[0].relationships));
  }, 15000);

  it("excludes dead castaways from visible agents so decisions never target the dead", () => {
    const source = makeFallbackWorld(11);
    const self = source.agents[0]!;
    const neighbor = source.agents[1]!;
    const w = {
      ...source,
      agents: source.agents.map((agent) => agent.id === neighbor.id
        ? { ...agent, location: self.location, status: "dead" as const, demise: { tick: 1, cause: "thirst" } }
        : agent),
    };
    const p = perceive(w, self.id);
    expect(p.visibleAgents.some((agent) => agent.id === neighbor.id)).toBe(false);
  }, 15000);
});
