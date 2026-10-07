// Run: bun test apps/examples/src/demos/island-sim/engine/gameplay.test.ts --timeout 15000
import { describe, expect, it } from "bun:test";
import { makeFallbackWorld } from "../world/fallback.js";
import { advanceIslandGameplay, initializeIslandGameplay } from "./gameplay.js";
import type { SimEvent } from "./events.js";

describe("island gameplay systems", () => {
  it("initializes personal roles, a shared rescue goal, and camp storage", () => {
    const world = initializeIslandGameplay(makeFallbackWorld(20261006));
    const gameplay = world.gameplay;

    expect(gameplay).toBeDefined();
    expect(gameplay?.objectives.filter((goal) => goal.ownerId)).toHaveLength(world.agents.length);
    expect(gameplay?.objectives.some((goal) => goal.kind === "rescue" && !goal.ownerId)).toBe(true);
    expect(gameplay?.campCache).toEqual([]);
    expect(gameplay?.nextTwistTick).toBeGreaterThan(0);
  }, 15000);

  it("dissolves an alliance that lost members to death and returns its private stash to the camp cache", () => {
    let world = initializeIslandGameplay(makeFallbackWorld(15));
    const [first, second] = world.agents;
    world = {
      ...world,
      gameplay: {
        ...world.gameplay!,
        alliances: [{
          id: "all-test",
          name: "The Shoreline Pact",
          members: [first!.id, second!.id],
          formedAtTick: 4,
          stash: [{ kind: "water", qty: 3 }, { kind: "berries", qty: 2 }],
        }],
      },
    };
    const aftermath = advanceIslandGameplay(world, [
      { kind: "agent-died", tick: 10, agentId: first!.id, cause: "thirst" },
    ]);
    const dissolved = aftermath.events.find((event) => event.kind === "alliance-dissolved");
    expect(dissolved).toBeDefined();
    expect(aftermath.world.gameplay!.alliances).toHaveLength(0);
    expect(aftermath.world.gameplay!.campCache).toEqual([{ kind: "water", qty: 3 }, { kind: "berries", qty: 2 }]);
  }, 15000);

  it("keeps a two-member alliance alive and retains its stash when no member has died", () => {
    let world = initializeIslandGameplay(makeFallbackWorld(16));
    const [first, second] = world.agents;
    world = {
      ...world,
      gameplay: {
        ...world.gameplay!,
        alliances: [{
          id: "all-test",
          name: "The Shoreline Pact",
          members: [first!.id, second!.id],
          formedAtTick: 4,
          stash: [{ kind: "water", qty: 1 }],
        }],
      },
    };
    const aftermath = advanceIslandGameplay(world, []);
    expect(aftermath.world.gameplay!.alliances).toHaveLength(1);
    expect(aftermath.world.gameplay!.campCache).toHaveLength(0);
  }, 15000);

  it("arranges the rescue once the signal objective completes with a signal fire and clear weather", () => {
    let world = initializeIslandGameplay(makeFallbackWorld(17));
    const rescue = world.gameplay!.objectives.find((goal) => goal.kind === "rescue")!;
    world = {
      ...world,
      weather: { condition: "sunny", tempC: 25 },
      structures: [...world.structures, { id: "signal-test", kind: "signal-fire", tile: "D4", ownerId: "agent-0", durability: 10 }],
      gameplay: { ...world.gameplay!, objectives: world.gameplay!.objectives.map((goal) => goal.kind === "rescue" ? { ...goal, completed: true } : goal) },
    };
    const rescueTick = rescue? world.clock.tick : world.clock.tick;
    const aftermath = advanceIslandGameplay({ ...world, clock: { ...world.clock, tick: rescueTick } }, []);
    expect(aftermath.events.some((event) => event.kind === "rescue-arrived")).toBe(true);
    expect(aftermath.world.gameplay!.rescueAtTick).toBeDefined();
  }, 15000);

  it("advances only the relevant personal goal and emits a completion milestone", () => {
    let world = initializeIslandGameplay(makeFallbackWorld(12));
    const ownerId = world.agents[0]!.id;
    const goal = world.gameplay!.objectives.find((item) => item.ownerId === ownerId)!;
    const event: SimEvent = goal.kind === "gather"
      ? { kind: "resource-gathered", tick: 0, agentId: ownerId, resourceId: "res-0", amount: 1 } as const
      : goal.kind === "build"
        ? { kind: "built", tick: 0, agentId: ownerId, structureId: "struct-test" } as const
        : { kind: "inspected", tick: 0, agentId: ownerId, target: "D4" } as const;

    const result = advanceIslandGameplay(world, [event]);
    world = result.world;
    const updated = world.gameplay!.objectives.find((item) => item.id === goal.id)!;

    expect(updated.progress).toBe(1);
    expect(result.events.some((item) => item.kind === "objective-progress")).toBe(true);
    if (goal.target === 1) {
      expect(updated.completed).toBe(true);
      expect(result.events.some((item) => item.kind === "objective-completed")).toBe(true);
    }
  }, 15000);

  it("forms a persistent alliance from repeated reciprocal trust", () => {
    const world = initializeIslandGameplay(makeFallbackWorld(22));
    const [first, second, third] = world.agents;
    const trusted = {
      ...world,
      agents: world.agents.map((agent, index) => ({
        ...agent,
        relationships: {
          ...agent.relationships,
          ...(index === 0 ? {
            [second!.id]: { trust: 0.7, lastInteraction: 3 },
            [third!.id]: { trust: 0.7, lastInteraction: 3 },
          } : {}),
          ...(index === 1 ? { [first!.id]: { trust: 0.7, lastInteraction: 3 } } : {}),
          ...(index === 2 ? { [first!.id]: { trust: 0.7, lastInteraction: 3 } } : {}),
        },
      })),
    };

    const result = advanceIslandGameplay(initializeIslandGameplay(trusted), []);

    expect(result.world.gameplay?.alliances).toHaveLength(1);
    expect(result.world.gameplay?.alliances[0]?.members).toContain(first!.id);
    expect(result.events.some((event) => event.kind === "alliance-formed")).toBe(true);
  }, 15000);

  it("exiles a repeatedly betraying member after a trust-weighted alliance vote", () => {
    const world = initializeIslandGameplay(makeFallbackWorld(23));
    const [betrayer, victim] = world.agents;
    const prepared = {
      ...world,
      gameplay: {
        ...world.gameplay!,
        alliances: [{
          id: "alliance-test",
          name: "The Shoreline Pact",
          members: [betrayer!.id, victim!.id],
          formedAtTick: 0,
          stash: [],
        }],
      },
      agents: world.agents.map((agent, index) => index === 0
        ? { ...agent, inventory: [{ kind: "wood", qty: 12 }] }
        : index === 1
          ? { ...agent, relationships: { ...agent.relationships, [betrayer!.id]: { trust: -0.8, lastInteraction: 4 } } }
          : agent),
    };

    const betrayal = {
      kind: "stolen",
      tick: 4,
      from: betrayer!.id,
      to: victim!.id,
      item: "water",
      amount: 1,
      detected: true,
      trustDelta: -0.5,
    } as const satisfies SimEvent;
    const once = advanceIslandGameplay(prepared, [betrayal]);
    const twice = advanceIslandGameplay(once.world, [betrayal]);

    expect(once.world.gameplay?.exiles).toHaveLength(0);
    expect(twice.world.gameplay?.exiles[0]?.agentId).toBe(betrayer!.id);
    expect(twice.world.gameplay?.exiles[0]?.returnAtTick).toBeGreaterThan(4);
    expect(twice.events.some((event) => event.kind === "exile-started")).toBe(true);
    expect(twice.world.agents[0]!.inventory).toContainEqual({ kind: "water", qty: 1 });
    expect(twice.world.agents[0]!.inventory).toContainEqual({ kind: "berries", qty: 1 });

    const exile = twice.world.gameplay!.exiles[0]!;
    const readyToReturn = {
      ...twice.world,
      clock: { ...twice.world.clock, tick: exile.returnAtTick },
    };
    const returned = advanceIslandGameplay(readyToReturn, []);
    expect(returned.world.gameplay?.exiles).toHaveLength(0);
    expect(returned.world.agents.find((agent) => agent.id === betrayer!.id)?.location).toBe(twice.world.structures[0]!.tile);
    expect(returned.events.some((event) => event.kind === "exile-returned")).toBe(true);
  }, 15000);

  it("schedules the same seeded island twist for equivalent worlds", () => {
    const left = initializeIslandGameplay(makeFallbackWorld(91));
    const right = initializeIslandGameplay(makeFallbackWorld(91));
    expect(left.gameplay?.nextTwistTick).toBe(right.gameplay?.nextTwistTick);
  }, 15000);
});
