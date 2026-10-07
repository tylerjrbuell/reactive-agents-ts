// Run: bun test apps/examples/src/demos/island-sim/index.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { makeFallbackWorld } from "./world/fallback.js";
import { makeScriptedDecisionMaker } from "./decision/types.js";
import { viewerSafeState, makeController, createServer, finaleView } from "./index.js";
import { renderPage } from "./ui/page.js";
import { initializeIslandGameplay } from "./engine/gameplay.js";

describe("ui projection", () => {
  it("exposes the rescue marker, discoveries, and tainted spring to the viewer", () => {
    const world = initializeIslandGameplay(makeFallbackWorld(9));
    const withStory = {
      ...world,
      gameplay: {
        ...world.gameplay!,
        rescueAtTick: 42,
        discovered: ["a cache is buried at D4"],
        poisonedSpring: "D4",
      },
    };
    const safe = viewerSafeState(withStory);
    expect(safe.gameplay?.rescueAtTick).toBe(42);
    expect(safe.gameplay?.discovered).toEqual(["a cache is buried at D4"]);
    expect(safe.gameplay?.poisonedSpring).toBe("D4");
  }, 15000);

  it("reports a rescue finale with only survivors, never the living as dead", () => {
    const base = initializeIslandGameplay(makeFallbackWorld(10));
    const rescued = {
      ...base,
      clock: { ...base.clock, tick: 120, day: 6 },
      structures: [...base.structures, { id: "signal-1", kind: "signal-fire", tile: "D4", ownerId: "agent-0", durability: 10 }],
      gameplay: { ...base.gameplay!, rescueAtTick: 120 },
    };
    const view = finaleView(rescued)!;
    expect(view.rescued).toBe(true);
    expect(view.summary).toContain("made it home");
    expect(view.summary).not.toContain("lost");
    expect(view.roll).toHaveLength(rescued.agents.length);
    expect(view.roll.every((line) => line.startsWith("✅"))).toBe(true);
  }, 15000);

  it("reports an all-lost finale listing only the dead with their day and cause", () => {
    const base = initializeIslandGameplay(makeFallbackWorld(11));
    const lost = {
      ...base,
      agents: base.agents.map((agent, index) => index < 3
        ? { ...agent, status: "dead" as const, demise: { tick: 30 + index, cause: "thirst" } }
        : agent),
    };
    expect(finaleView(lost)).toBeUndefined();
    const allLost = {
      ...lost,
      agents: base.agents.map((agent, index) => ({ ...agent, status: "dead" as const, demise: { tick: 30 + index, cause: index % 2 === 0 ? "thirst" : "hunger" } })),
    };
    const finalView = finaleView(allLost)!;
    expect(finalView.rescued).toBe(false);
    expect(finalView.roll).toHaveLength(8);
    expect(finalView.roll.every((line) => line.startsWith("💀"))).toBe(true);
    expect(finalView.roll.some((line) => line.includes("thirst"))).toBe(true);
    expect(finalView.roll.some((line) => line.includes("unknown"))).toBe(false);
  }, 15000);

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
  it("ends the story when a boat arrives after the signal fire works", async () => {
    const base = initializeIslandGameplay(makeFallbackWorld(50));
    const ready = {
      ...base,
      weather: { condition: "sunny" as const, tempC: 25 },
      structures: [...base.structures, { id: "signal-test", kind: "signal-fire", tile: "D4", ownerId: "agent-0", durability: 10 }],
      gameplay: { ...base.gameplay!, objectives: base.gameplay!.objectives.map((goal) => goal.kind === "rescue" ? { ...goal, completed: true } : goal) },
    };
    const controller = makeController({
      worldGenerator: { generate: async () => ({ world: ready, source: "fallback", attempts: 0 }) },
      makeDecisionMaker: () => makeScriptedDecisionMaker(),
    });
    await controller.newSimulation();
    await controller.step();
    expect(controller.isGameOver()).toBe(true);
    const events = controller.getEventsAfter(0).events;
    expect(events.some((item) => item.event.kind === "rescue-arrived")).toBe(true);
    expect(controller.getRunning()).toBe(false);
  }, 15000);

  it("ends the story somberly when every castaway is lost", async () => {
    const base = makeFallbackWorld(51);
    const lost = {
      ...base,
      agents: base.agents.map((agent) => ({ ...agent, status: "dead" as const, demise: { tick: 3, cause: "thirst" } })),
    };
    const controller = makeController({
      worldGenerator: { generate: async () => ({ world: lost, source: "fallback", attempts: 0 }) },
      makeDecisionMaker: () => makeScriptedDecisionMaker(),
    });
    await controller.newSimulation();
    await controller.step();
    expect(controller.isGameOver()).toBe(true);
    const events = controller.getEventsAfter(0).events;
    expect(events.some((item) => item.event.kind === "all-lost")).toBe(true);
    expect(controller.getChronicle().some((entry) => entry.headline.length > 3)).toBe(true);
  }, 15000);

  it("resets the narrator chronicle when a new island is generated", async () => {
    const late = (seed: number) => {
      const base = makeFallbackWorld(seed);
      return { ...base, clock: { ...base.clock, tick: 23, hour: 23 } };
    };
    const controller = makeController({
      worldGenerator: { generate: async (seed) => ({ world: late(63 + (seed % 2)), source: "fallback", attempts: 0 }) },
      makeDecisionMaker: () => makeScriptedDecisionMaker(),
    });
    await controller.newSimulation();
    await controller.step();
    expect(controller.getChronicle().length).toBeGreaterThan(0);
    await controller.newSimulation();
    expect(controller.getChronicle()).toEqual([]);
    await controller.step();
    expect(controller.getChronicle().length).toBe(1);
  }, 15000);

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

  it("retains sequenced events from each completed tick", async () => {    const controller = makeController({
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
    const page = renderPage();    expect(page).toContain(".need-track{display:block");
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

  it("animates movement glide, action pings, and softer trails", () => {
    const page = renderPage();
    expect(page).toContain("transition:transform");
    expect(page).toContain("@keyframes action-ping");
    expect(page).toContain("function showActionPings(");
    expect(page).toContain("actionPingGlyphs");
    expect(page).toContain(".movement-trail.wrapped{opacity:.28}");
    expect(page).toContain(".movement-trail.focus{opacity:.9}");
    expect(page).toContain("ping");
  }, 15000);

  it("shows the narrator journal, memorial lines, and a rescue finale", () => {
    const page = renderPage();
    expect(page).toContain("🎙️ Narrator's journal");
    expect(page).toContain("function renderChronicle()");
    expect(page).toContain("api/chronicle");
    expect(page).toContain("demise");
    expect(page).toContain("💀");
    expect(page).toContain("rescue-arrived");
    expect(page).toContain("made it home");
  }, 15000);

  it("presents the narrator as a timeline with a reading pane and a new-island CTA", () => {
    const page = renderPage();
    expect(page).toContain("chronicle-timeline");
    expect(page).toContain("chronicle-chips");
    expect(page).toContain("chronicle-reader");
    expect(page).toContain("function selectChronicleDay(");
    expect(page).toContain("finale-restart");
    expect(page).toContain("memorial-list");
    expect(page).toContain("all-lost");
    expect(page.indexOf('id="chronicle-chips"')).toBeLessThan(page.indexOf('id="event-log"'));
  }, 15000);

  it("ends a run with a modal, map finale animation, and a one-screen layout", () => {
    const page = renderPage();
    expect(page).toContain('id="finale-modal"');
    expect(page).toContain("function showFinaleModal(");
    expect(page).toContain("function renderMapFinale(");
    expect(page).toContain("finaleDismissed");
    expect(page).toContain("⛵");
    expect(page).toContain("finale-dim");
    expect(page).toContain("height:100dvh");
    expect(page).toContain("overflow:hidden");
    expect(page).toContain("@media(max-height:640px)");
  }, 15000);

  it("keeps the map key complete: finale, action pings, terrain, and no stale entries", () => {
    const page = renderPage();
    expect(page).toContain("⛵ Rescue boat");
    expect(page).toContain("💀 Resting place");
    expect(page).toContain("legend-terrain");
    expect(page).toContain("Ocean");
    expect(page).toContain("Action ping");
    expect(page).toContain("🩹 Hurt");
    expect(page).toContain("🤒 Illness");
    expect(page).toContain("🔎 Discovery");
    expect(page).not.toContain("Terrain</span>");
  }, 15000);
});

describe("server", () => {
  it("reports a rescue finale through /api/state, not an all-lost one", async () => {
    const base = initializeIslandGameplay(makeFallbackWorld(52));
    const ready = {
      ...base,
      weather: { condition: "sunny" as const, tempC: 25 },
      structures: [...base.structures, { id: "signal-api", kind: "signal-fire", tile: "D4", ownerId: "agent-0", durability: 10 }],
      gameplay: { ...base.gameplay!, objectives: base.gameplay!.objectives.map((goal) => goal.kind === "rescue" ? { ...goal, completed: true } : goal) },
    };
    const controller = makeController({
      worldGenerator: { generate: async () => ({ world: ready, source: "fallback", attempts: 0 }) },
      makeDecisionMaker: () => makeScriptedDecisionMaker(),
    });
    await controller.newSimulation();
    await controller.step();
    const { server, stop } = createServer(controller, 0);
    try {
      const state = await (await fetch(`http://localhost:${server.port}/api/state`)).json() as {
        simulation: { gameOver: boolean; finale?: { rescued: boolean; roll: string[]; summary: string } };
      };
      expect(state.simulation.gameOver).toBe(true);
      expect(state.simulation.finale?.rescued).toBe(true);
      expect(state.simulation.finale?.roll.every((line) => line.startsWith("✅"))).toBe(true);
      expect(state.simulation.finale?.summary).toContain("made it home");
    } finally {
      stop();
    }
  }, 15000);

  it("serves the chronicle after a day rolls over", async () => {
    const base = makeFallbackWorld(60);
    const late = { ...base, clock: { ...base.clock, tick: 23, hour: 23 } };
    const controller = makeController({
      worldGenerator: { generate: async () => ({ world: late, source: "fallback", attempts: 0 }) },
      makeDecisionMaker: () => makeScriptedDecisionMaker(),
    });
    await controller.newSimulation();
    const { server, stop } = createServer(controller, 0);
    try {
      await controller.step();
      const response = await fetch(`http://localhost:${server.port}/api/chronicle`);
      const entries = await response.json() as Array<{ day: number; headline: string }>;
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries.at(-1)?.day).toBeGreaterThan(0);
      expect(entries.at(-1)?.headline.length).toBeGreaterThan(3);
    } finally {
      stop();
    }
  }, 15000);

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
