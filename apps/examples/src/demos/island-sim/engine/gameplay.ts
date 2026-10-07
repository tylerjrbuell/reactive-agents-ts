import type { AgentState, AllianceSchema, ExileSchema, IslandGameplay, IslandObjectiveSchema, WorldState } from "../world/schema.js";
import { addInventoryItem, INVENTORY_CAPACITY, inventoryUnits } from "./inventory.js";
import type { SimEvent } from "./events.js";

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
type MutableRelationship = Mutable<AgentState["relationships"][string]>;
type MutableAgent = Mutable<AgentState> & {
  needs: Mutable<AgentState["needs"]>;
  inventory: Array<Mutable<AgentState["inventory"][number]>>;
  relationships: Record<string, MutableRelationship>;
};
type MutableObjective = Mutable<typeof IslandObjectiveSchema.Type>;
type MutableAlliance = Omit<Mutable<typeof AllianceSchema.Type>, "members" | "stash"> & {
  members: string[];
  stash: Array<Mutable<IslandGameplay["campCache"][number]>>;
};
type MutableExile = Mutable<typeof ExileSchema.Type>;
type MutableGameplay = Omit<Mutable<IslandGameplay>, "campCache" | "objectives" | "alliances" | "exiles" | "betrayalCounts"> & {
  campCache: Array<Mutable<IslandGameplay["campCache"][number]>>;
  objectives: MutableObjective[];
  alliances: MutableAlliance[];
  exiles: MutableExile[];
  betrayalCounts: Record<string, number>;
};
type MutableWorld = Omit<Mutable<WorldState>, "agents" | "gameplay" | "clock" | "weather"> & {
  agents: MutableAgent[];
  gameplay: MutableGameplay;
  clock: Mutable<WorldState["clock"]>;
  weather: Mutable<WorldState["weather"]>;
};

const OBJECTIVE_TEMPLATES = [
  { kind: "gather", title: "Secure three useful supplies", target: 3 },
  { kind: "explore", title: "Learn the island's paths", target: 3 },
  { kind: "help", title: "Help a fellow castaway", target: 1 },
  { kind: "build", title: "Make the camp safer", target: 1 },
] as const;

function mutableWorld(world: WorldState): MutableWorld {
  const copy = structuredClone(world) as MutableWorld;
  if (!copy.gameplay) {
    copy.gameplay = {
      campCache: [],
      objectives: [],
      alliances: [],
      exiles: [],
      betrayalCounts: {},
      nextTwistTick: 24,
      twistCount: 0,
    };
  }
  return copy;
}

function deterministicTwistTick(seed: number, count: number): number {
  return 24 * (count + 1) + Math.abs(Math.trunc(seed + count * 17)) % 5;
}

/** Attach deterministic personal objectives, the shared rescue goal, and island systems to a world. */
export function initializeIslandGameplay(world: WorldState): WorldState {
  if (world.gameplay) return world;
  const next = mutableWorld(world);
  next.gameplay.objectives = next.agents
    .filter((agent) => agent.status !== "dead")
    .map((agent, index) => {
      const template = OBJECTIVE_TEMPLATES[index % OBJECTIVE_TEMPLATES.length]!;
      return {
        id: `objective-${agent.id}`,
        kind: template.kind,
        title: template.title,
        ownerId: agent.id,
        target: template.target,
        progress: 0,
        completed: false,
      };
    });
  next.gameplay.objectives.push({
    id: "objective-rescue",
    kind: "rescue",
    title: "Build a signal fire and make contact",
    target: 3,
    progress: 0,
    completed: false,
  });
  next.gameplay.nextTwistTick = deterministicTwistTick(world.seed, 0);
  return next;
}

function trustBetween(agent: AgentState, otherId: string): number {
  return agent.relationships[otherId]?.trust ?? 0;
}

function updateTrust(world: MutableWorld, fromId: string, toId: string, delta: number, tick: number): void {
  const from = world.agents.find((agent) => agent.id === fromId);
  const to = world.agents.find((agent) => agent.id === toId);
  if (!from || !to) return;
  const fromRelationship = from.relationships[toId] ?? { trust: 0, lastInteraction: tick };
  const toRelationship = to.relationships[fromId] ?? { trust: 0, lastInteraction: tick };
  from.relationships[toId] = {
    trust: Math.max(-1, Math.min(1, fromRelationship.trust + delta)),
    lastInteraction: tick,
  };
  to.relationships[fromId] = {
    trust: Math.max(-1, Math.min(1, toRelationship.trust + delta)),
    lastInteraction: tick,
  };
}

function allianceForAgent(gameplay: MutableGameplay, agentId: string): MutableAlliance | undefined {
  return gameplay.alliances.find((alliance) => alliance.members.includes(agentId));
}

function formAlliances(world: MutableWorld, events: SimEvent[]): void {
  const living = world.agents.filter((agent) => agent.status !== "dead");
  const assigned = new Set(world.gameplay.alliances.flatMap((alliance) => alliance.members));
  const candidates = new Map<string, Set<string>>();

  for (const agent of living) {
    if (assigned.has(agent.id)) continue;
    for (const other of living) {
      if (other.id === agent.id || assigned.has(other.id)) continue;
      if (trustBetween(agent, other.id) < 0.6 || trustBetween(other, agent.id) < 0.6) continue;
      const group = candidates.get(agent.id) ?? new Set([agent.id]);
      group.add(other.id);
      candidates.set(agent.id, group);
      const otherGroup = candidates.get(other.id);
      if (otherGroup) for (const member of otherGroup) group.add(member);
    }
  }

  const emitted = new Set<string>();
  for (const membersSet of candidates.values()) {
    const members = [...membersSet].sort();
    if (members.length < 2) continue;
    const key = members.join("|");
    if (emitted.has(key) || members.some((member) => assigned.has(member))) continue;
    emitted.add(key);
    const id = `alliance-${members.map((member) => member.replace(/[^a-zA-Z0-9-]/g, "-")).join("-")}`;
    const alliance: MutableAlliance = {
      id,
      name: members.length === 2 ? "The Shoreline Pact" : "The Shoreline",
      members,
      formedAtTick: world.clock.tick,
      stash: [],
    };
    world.gameplay.alliances.push(alliance);
    members.forEach((member) => assigned.add(member));
    events.push({ kind: "alliance-formed", tick: world.clock.tick, allianceId: id, name: alliance.name, members });
  }
}

function progressObjectives(world: MutableWorld, inputEvents: readonly SimEvent[], outputEvents: SimEvent[]): void {
  for (const event of inputEvents) {
    for (const objective of world.gameplay.objectives) {
      if (objective.completed) continue;
      let progress = 0;
      let actorId: string | undefined;
      if (event.kind === "resource-gathered" && objective.kind === "gather") {
        progress = event.amount;
        actorId = event.agentId;
      } else if (event.kind === "built" && objective.kind === "build") {
        progress = 1;
        actorId = event.agentId;
      } else if (event.kind === "built" && event.structureKind === "signal-fire" && objective.kind === "rescue") {
        progress = 1;
      } else if ((event.kind === "helped" || event.kind === "shared") && objective.kind === "help") {
        progress = 1;
        actorId = event.from;
      } else if ((event.kind === "agent-moved" || event.kind === "inspected") && objective.kind === "explore") {
        progress = 1;
        actorId = event.agentId;
      } else if (event.kind === "island-twist" && event.twist === "rescue-signal" && objective.kind === "rescue") {
        progress = 1;
      }
      if (progress === 0 || (objective.ownerId && objective.ownerId !== actorId)) continue;
      objective.progress = Math.min(objective.target, objective.progress + progress);
      outputEvents.push({
        kind: "objective-progress",
        tick: event.tick,
        agentId: objective.ownerId ?? "all",
        objectiveId: objective.id,
        title: objective.title,
        progress: objective.progress,
        target: objective.target,
      });
      if (objective.progress >= objective.target) {
        objective.completed = true;
        outputEvents.push({
          kind: "objective-completed",
          tick: event.tick,
          agentId: objective.ownerId ?? "all",
          objectiveId: objective.id,
          title: objective.title,
        });
      }
    }
  }
}

function exileLocation(world: MutableWorld, agentId: string): string {
  const origin = world.agents.find((agent) => agent.id === agentId)?.location ?? "A1";
  const land = world.terrain.filter((tile) => tile.biome !== "ocean");
  return land
    .slice()
    .sort((left, right) => {
      const distance = (tile: string) => Math.max(
        Math.abs(tile.charCodeAt(0) - origin.charCodeAt(0)),
        Math.abs(Number(tile.slice(1)) - Number(origin.slice(1))),
      );
      return distance(right.tile) - distance(left.tile) || left.tile.localeCompare(right.tile);
    })[0]?.tile ?? origin;
}

function reserveExileKit(agent: MutableAgent): void {
  const carried = agent.inventory.map((item) => ({ ...item }));
  while (inventoryUnits(carried) > INVENTORY_CAPACITY - 2) {
    const expendable = carried.findIndex((item) => !["water", "berries", "fish", "meat"].includes(item.kind));
    const index = expendable >= 0 ? expendable : carried.findIndex((item) => item.kind !== "water");
    const removeIndex = index >= 0 ? index : carried.length - 1;
    const stack = carried[removeIndex];
    if (!stack) break;
    if (stack.qty > 1) stack.qty -= 1;
    else carried.splice(removeIndex, 1);
  }
  const water = addInventoryItem(carried, "water", 1);
  const withWater = water.ok ? water.inventory : carried;
  const food = addInventoryItem(withWater, "berries", 1);
  agent.inventory = (food.ok ? food.inventory : withWater) as MutableAgent["inventory"];
}

function beginExile(world: MutableWorld, alliance: MutableAlliance, agentId: string, events: SimEvent[]): void {
  const current = world.gameplay.exiles.find((exile) => exile.agentId === agentId);
  if (current) return;
  const agent = world.agents.find((item) => item.id === agentId);
  if (!agent || agent.status === "dead") return;
  const location = exileLocation(world, agentId);
  reserveExileKit(agent);
  agent.location = location;
  const returnAtTick = world.clock.tick + 12;
  const exile: MutableExile = { agentId, returnAtTick, location, reason: "The alliance voted after repeated betrayal" };
  world.gameplay.exiles.push(exile);
  events.push({
    kind: "exile-started",
    tick: world.clock.tick,
    agentId,
    location,
    returnAtTick,
    reason: exile.reason,
  });
}

function holdAllianceVote(world: MutableWorld, agentId: string, events: SimEvent[]): void {
  const alliance = allianceForAgent(world.gameplay, agentId);
  if (!alliance || alliance.members.length < 2 || (world.gameplay.betrayalCounts[agentId] ?? 0) < 2) return;
  let exileWeight = 0;
  let keepWeight = 0;
  for (const voterId of alliance.members) {
    if (voterId === agentId) continue;
    const voter = world.agents.find((agent) => agent.id === voterId);
    if (!voter || voter.status === "dead") continue;
    const trust = trustBetween(voter, agentId);
    const weight = 1 + Math.abs(trust);
    if (trust <= 0.2) exileWeight += weight;
    else keepWeight += weight;
  }
  if (exileWeight > keepWeight) beginExile(world, alliance, agentId, events);
}

function registerBetrayals(world: MutableWorld, inputEvents: readonly SimEvent[], events: SimEvent[]): void {
  for (const event of inputEvents) {
    if (event.kind !== "stolen" && event.kind !== "sabotaged") continue;
    if (!allianceForAgent(world.gameplay, event.from)) continue;
    world.gameplay.betrayalCounts[event.from] = (world.gameplay.betrayalCounts[event.from] ?? 0) + 1;
    holdAllianceVote(world, event.from, events);
  }
}

function applyTwist(world: MutableWorld, events: SimEvent[]): void {
  if (world.clock.tick < world.gameplay.nextTwistTick) return;
  const twistIndex = Math.abs(Math.trunc(world.seed + world.gameplay.twistCount * 7)) % 3;
  const tick = world.clock.tick;
  if (twistIndex === 0) {
    world.gameplay.campCache.push({ kind: "berries", qty: 2 }, { kind: "water", qty: 1 });
    events.push({ kind: "island-twist", tick, twist: "cache-found", description: "A washed-up supply cache turns up above the tide line." });
  } else if (twistIndex === 1) {
    const rescue = world.gameplay.objectives.find((objective) => objective.kind === "rescue");
    events.push({ kind: "island-twist", tick, twist: "rescue-signal", description: "A distant search plane crosses the horizon. A signal could reach it." });
    if (rescue && !rescue.completed) {
      rescue.progress = Math.min(rescue.target, rescue.progress + 1);
      events.push({ kind: "objective-progress", tick, agentId: "all", objectiveId: rescue.id, title: rescue.title, progress: rescue.progress, target: rescue.target });
      if (rescue.progress >= rescue.target) {
        rescue.completed = true;
        events.push({ kind: "objective-completed", tick, agentId: "all", objectiveId: rescue.id, title: rescue.title });
      }
    }
  } else {
    world.weather = { condition: "storm", tempC: Math.max(8, Math.min(30, world.weather.tempC - 5)) };
    events.push({ kind: "island-twist", tick, twist: "weather-front", description: "Dark clouds gather offshore. The castaways have time to secure camp." });
  }
  world.gameplay.twistCount += 1;
  world.gameplay.nextTwistTick = deterministicTwistTick(world.seed, world.gameplay.twistCount);
}

function returnExiles(world: MutableWorld, events: SimEvent[]): void {
  const remaining: MutableExile[] = [];
  for (const exile of world.gameplay.exiles) {
    if (world.clock.tick < exile.returnAtTick) {
      remaining.push(exile);
      continue;
    }
    const agent = world.agents.find((candidate) => candidate.id === exile.agentId);
    if (agent && agent.status !== "dead") {
      agent.location = world.structures[0]?.tile ?? "D4";
      events.push({ kind: "exile-returned", tick: world.clock.tick, agentId: exile.agentId, location: agent.location });
    }
  }
  world.gameplay.exiles = remaining;
}

/** Resolve trust, goals, alliances, exile votes, twists, and returns deterministically after a tick. */
export function advanceIslandGameplay(world: WorldState, inputEvents: readonly SimEvent[]): { world: WorldState; events: SimEvent[] } {
  const next = mutableWorld(initializeIslandGameplay(world));
  const events: SimEvent[] = [];
  for (const event of inputEvents) {
    if (event.kind === "traded" || event.kind === "shared" || event.kind === "helped" || event.kind === "talked") {
      updateTrust(next, event.from, event.to, event.trustDelta, event.tick);
    } else if (event.kind === "stolen" || event.kind === "sabotaged") {
      updateTrust(next, event.from, event.to, event.trustDelta, event.tick);
    }
  }
  progressObjectives(next, inputEvents, events);
  formAlliances(next, events);
  registerBetrayals(next, inputEvents, events);
  applyTwist(next, events);
  returnExiles(next, events);
  return { world: next, events };
}
