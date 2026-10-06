import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "./world/fallback.js";
import { makeScriptedDecisionMaker } from "./decision/types.js";
import { viewerSafeState, makeController, createServer } from "./index.js";

describe("ui projection", () => {
  it("viewerSafeState never includes hidden facts (canary)", () => {
    const w = makeFallbackWorld(5);
    w.hidden.secrets = ["CANARY_UI_991"];
    expect(JSON.stringify(viewerSafeState(w))).not.toContain("CANARY_UI_991");
  });
});

describe("controller", () => {
  it("newSimulation produces a world, and step advances one tick (offline)", async () => {
    const controller = makeController({
      worldGenerator: { generate: async (seed) => ({ world: makeFallbackWorld(seed), source: "fallback", attempts: 0 }) },
      makeDecisionMaker: () => makeScriptedDecisionMaker(),
    });
    await controller.newSimulation();
    const before = controller.world!.clock.tick;
    await controller.step();
    expect(controller.world!.clock.tick).toBe(before + 1);
  });
});

describe("server", () => {
  it("serves the page and /api/state without hidden facts", async () => {
    const controller = makeController({
      worldGenerator: { generate: async (seed) => ({ world: makeFallbackWorld(seed), source: "fallback", attempts: 0 }) },
      makeDecisionMaker: () => makeScriptedDecisionMaker(),
    });
    await controller.newSimulation();
    const { server, stop } = createServer(controller, 0);
    try {
      const base = `http://localhost:${server.port}`;
      const page = await fetch(base + "/");
      expect(page.headers.get("content-type")).toContain("text/html");
      const state = await fetch(base + "/api/state");
      const json = await state.json();
      expect(json).not.toHaveProperty("hidden");
    } finally {
      stop();
    }
  });
});