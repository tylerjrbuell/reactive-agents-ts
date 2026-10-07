// Run: bun test apps/examples/src/demos/island-sim/index.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "./world/fallback.js";
import { makeScriptedDecisionMaker } from "./decision/types.js";
import { viewerSafeState, makeController, createServer } from "./index.js";
import { renderPage } from "./ui/page.js";
import { initializeIslandGameplay } from "./engine/gameplay.js";

describe("ui projection", () => {
  it("viewerSafeState never includes hidden facts (canary)", () => {
    const world = makeFallbackWorld(5);
    const withCanary = { ...world, hidden: { ...world.hidden, secrets: ["CANARY_UI_991"] } };
    expect(JSON.stringify(viewerSafeState(withCanary))).not.toContain("CANARY_UI_991");
    expect(viewerSafeState(initializeIslandGameplay(world)).gameplay?.objectives.length).toBeGreaterThan(0);

    const initialized = initializeIslandGameplay(world);
    const withPrivateStash = {
      ...initialized,
      gameplay: {
        ...initialized.gameplay!,
        alliances: [{
          id: "private-test",
          name: "Test Pact",
          members: [world.agents[0]!.id, world.agents[1]!.id],
          formedAtTick: 0,
          stash: [{ kind: "private-compass-canary", qty: 5 }],
        }],
      },
    };
    const safe = viewerSafeState(withPrivateStash);
    expect(JSON.stringify(safe)).not.toContain("private-compass-canary");
    expect(safe.gameplay?.alliances[0]?.stashUnits).toBe(5);
  }, 15000);
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
  }, 15000);

  it("retains sequenced events from each completed tick", async () => {
    const controller = makeController({
      worldGenerator: { generate: async (seed) => ({ world: makeFallbackWorld(seed), source: "fallback", attempts: 0 }) },
      makeDecisionMaker: () => makeScriptedDecisionMaker(),
    });
    await controller.newSimulation();
    const { server, stop } = createServer(controller, 0);
    try {
      await controller.step();
      const response = await fetch(`http://localhost:${server.port}/api/events?after=0`);
      const payload = await response.json() as {
        events: Array<{ sequence: number; event: { tick: number } }>;
        latestSequence: number;
      };
      expect(payload.events.length).toBeGreaterThan(0);
      expect(payload.events[0]).toMatchObject({ sequence: 1, event: { tick: 0 } });
      expect(payload.latestSequence).toBeGreaterThan(0);
    } finally {
      stop();
    }
  }, 15000);

});

describe("simulation viewing page", () => {
  it("uses map + story layout with responsive survivor exploration", () => {
    const page = renderPage();
    expect(page).toContain("story-layout");
    expect(page).toContain("story-rail");
    expect(page).toContain("grid-area:rail");
    expect(page).toContain("grid-area:story");
    expect(page).toContain("survivor-panel");
    expect(page).toContain("inspector-panel");
    expect(page).toContain("avatar-portrait");
    expect(page).toContain("function agentThemeColor(agent)");
    expect(page).toContain("function renderRoster()");
    expect(page).toContain("function eventFilterCategory(event)");
    expect(page).toContain("event.twist==='weather-front'");
    expect(page).toContain("event-search");
    expect(page).toContain("/api/events?after=");
    expect(page).toContain("camp-cache");
    expect(page).toContain("alliance-list");
    expect(page).toContain("exile-list");
    expect(page).toContain("objective-list");
    expect(page).toContain("group-label");
    expect(page).toContain("@media");
  }, 15000);

  it("renders visible need bars with percents, emoji icons, and alliance links", () => {
    const page = renderPage();
    expect(page).toContain(".need-track{display:block");
    expect(page).toContain(".need-fill{display:block");
    expect(page).toContain("pct+'%'");
    expect(page).toContain("const resourceGlyphs=");
    expect(page).toContain("const structureGlyphs=");
    expect(page).toContain("const weatherGlyphs=");
    for (const glyph of ["🫐", "🐟", "💧", "🪵", "🪨", "🏕️", "⛺", "🔥", "🆘", "☀️", "🌧️", "⛈️"]) {
      expect(page).toContain(glyph);
    }
    expect(page).toContain("function allianceColorOf(");
    expect(page).toContain("alliance-link");
    expect(page).toContain("Alliance link");
    expect(page).toContain("🔄 New island");
    expect(page).toContain("▶ Resume story");
    expect(page).toContain("⏸ Pause");
    expect(page).toContain("⏭ Advance hour");
    expect(page).toContain("🤝 Social");
    expect(page).toContain("⚠️ Danger");
    expect(page).toContain("day-part");
  }, 15000);
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
  }, 15000);
});
