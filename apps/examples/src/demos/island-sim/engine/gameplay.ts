import type { AgentState, AllianceSchema, ExileSchema, IdolSchema, IslandGameplay, IslandObjectiveSchema, WorldState } from "../world/schema.js";
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
type MutableIdol = Mutable<typeof IdolSchema.Type>;
type MutableGameplay = Omit<Mutable<IslandGameplay>, "campCache" | "objectives" | "alliances" | "exiles" | "betrayalCounts" | "idols"> & {
  campCache: Array<Mutable<IslandGameplay["campCache"][number]>>;
  objectives: MutableObjective[];
  alliances: MutableAlliance[];
  exiles: MutableExile[];
  betrayalCounts: Record<string, number>;
  idols: MutableIdol[];
  idolClues: string[];
  discovered: string[];
  poisonedSpring?: string;
  nextCouncilTick?: number;
  lastVote?: { tick: number; votes: Array<{ voterId: string; targetId: string }>; exiledId?: string };
};

/** Exploration turns the seeded hidden facts into playable discoveries: scanning in place, or pushing to the far frontier. */
function discoverSecrets(world: MutableWorld, inputEvents: readonly SimEvent[], events: SimEvent[]): void {
  const camp = world.structures.find((structure) => structure.kind === "camp")?.tile ?? world.structures[0]?.tile;
  const seeker = inputEvents.find((event) => event.kind === "inspected")
    ?? inputEvents.find((event) => event.kind === "agent-moved" && camp !== undefined
      && Math.max(Math.abs(event.to.charCodeAt(0) - camp.charCodeAt(0)), Math.abs(Number(event.to.slice(1)) - Number(camp.slice(1)))) >= 2);
  if (!seeker) return;
  const remaining = world.hidden.secrets.filter((secret) => !world.gameplay.discovered.includes(secret));
  const secret = remaining[0];
  if (!secret) return;
  const seekerId = seeker.kind === "agent-moved" || seeker.kind === "inspected" ? seeker.agentId : "all";
  world.gameplay.discovered.push(secret);
  const lowered = secret.toLowerCase();
  if (lowered.includes("cache")) {
    addToGameplayCache(world.gameplay.campCache, "berries", 3);
    addToGameplayCache(world.gameplay.campCache, "wood", 2);
    events.push({ kind: "discovered", tick: world.clock.tick, agentId: seekerId, secret, description: `A buried supply cache: ${secret}.` });
    return;
  }
  if (lowered.includes("spring") || lowered.includes("water") || lowered.includes("poison")) {
    const spring = world.resources
      .filter((resource) => resource.kind === "water")
      .sort((left, right) => Number(left.tile.slice(1)) - Number(right.tile.slice(1)) || left.tile.localeCompare(right.tile))[0];
    if (spring) world.gameplay.poisonedSpring = spring.tile;
    events.push({ kind: "discovered", tick: world.clock.tick, agentId: seekerId, secret, description: `A warning carved into a tree: ${secret}.` });
    return;
  }
  events.push({ kind: "discovered", tick: world.clock.tick, agentId: seekerId, secret, description: `An unsettling find: ${secret}.` });
}

/** Resting is how injured or ill castaways get back on their feet. */
function recoverAgents(world: MutableWorld, inputEvents: readonly SimEvent[], events: SimEvent[]): void {
  for (const event of inputEvents) {
    if (event.kind !== "rested") continue;
    const agent = world.agents.find((candidate) => candidate.id === event.agentId);
    if (!agent || (agent.status !== "injured" && agent.status !== "ill")) continue;
    agent.status = "alive";
    events.push({ kind: "recovered", tick: world.clock.tick, agentId: agent.id });
  }
}
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
      discovered: [],
      nextCouncilTick: 68,
      idols: [],
      idolClues: [],
    };
  }
  if (!copy.gameplay.idols) copy.gameplay.idols = [];
  if (!copy.gameplay.idolClues) copy.gameplay.idolClues = [];
  if (!copy.gameplay.starving) copy.gameplay.starving = {};
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
  next.gameplay.nextCouncilTick = councilTickForDay(COUNCIL_INTERVAL_DAYS);
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

/** Adopt tombstones from the tick's death events: mark agents dead with a retained demise record. */
function registerDeaths(world: MutableWorld, inputEvents: readonly SimEvent[], events: SimEvent[]): void {
  for (const event of inputEvents) {
    if (event.kind !== "agent-died") continue;
    const agent = world.agents.find((candidate) => candidate.id === event.agentId);
    if (!agent) continue;
    const mutableAgent = agent as MutableAgent & { demise?: { tick: number; cause: string } };
    mutableAgent.status = "dead";
    if (!mutableAgent.demise) mutableAgent.demise = { tick: event.tick, cause: event.cause };
  }
}

/** Prune dead members, dissolve shrunken alliances into camp-stored wealth, and let survivors grieve. */
function maintainAlliances(world: MutableWorld, deathEvents: readonly SimEvent[], events: SimEvent[]): void {
  const remaining: MutableAlliance[] = [];
  for (const alliance of world.gameplay.alliances) {
    const dead = alliance.members.filter((member) => world.agents.some((agent) => agent.id === member && agent.status === "dead"));
    alliance.members = alliance.members.filter((member) => !dead.includes(member));
    if (dead.length > 0) {
      events.push({
        kind: "grief",
        tick: world.clock.tick,
        allianceId: alliance.id,
        name: alliance.name,
        agentId: dead[0]!,
        description: `${alliance.name} mourns ${dead.map((id) => world.agents.find((agent) => agent.id === id)?.name ?? id).join(", ")}.`,
      });
    }
    if (alliance.members.length < 2) {
      for (const item of alliance.stash) addToGameplayCache(world.gameplay.campCache, item.kind, item.qty);
      alliance.stash = [];
      events.push({
        kind: "alliance-dissolved",
        tick: world.clock.tick,
        allianceId: alliance.id,
        name: alliance.name,
        members: [...alliance.members, ...dead],
      });
      continue;
    }
    remaining.push(alliance);
  }
  world.gameplay.alliances = remaining;
}

function addToGameplayCache(cache: Array<Mutable<IslandGameplay["campCache"][number]>>, kind: string, qty: number): void {
  const existing = cache.find((item) => item.kind === kind);
  if (existing) existing.qty += qty;
  else cache.push({ kind, qty });
}

const PACT_NAMES = [
  "The Shoreline Pact",
  "The Tidebound",
  "The Driftwood Circle",
  "The Ember Accord",
  "The Saltwater Oath",
  "The Palmshade Pact",
  "The Reefbound",
  "The Northlight Compact",
  "The Castaway Covenant",
  "The Bonfire Bond",
  "The Undertow Alliance",
  "The Farshore Pact",
] as const;

/** Deal each pact a unique seeded name so the log never shows three Shorelines. */
function pactName(members: readonly string[], tick: number, taken: ReadonlySet<string>): string {
  const key = [...members].sort().join("|");
  let hash = 2166136261;
  for (const char of `${key}@${tick}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  for (let step = 0; step < PACT_NAMES.length; step += 1) {
    const name = PACT_NAMES[Math.abs(hash + step) % PACT_NAMES.length]!;
    if (!taken.has(name)) return name;
  }
  return `The Pact of ${key}`;
}

function formAlliances(world: MutableWorld, events: SimEvent[]): void {  const living = world.agents.filter((agent) => agent.status !== "dead");
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
    const taken = new Set(world.gameplay.alliances.map((alliance) => alliance.name));
    for (const event of events) {
      if (event.kind === "alliance-formed") taken.add(event.name);
    }
    const alliance: MutableAlliance = {
      id,
      name: pactName(members, world.clock.tick, taken),
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
      } else if (event.kind === "idol-played" && event.idolKind === "signal-boost" && objective.kind === "rescue") {
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

function beginExile(world: MutableWorld, agentId: string, events: SimEvent[]): void {
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
  dropIdolsOf(world, agentId);
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
  if (exileWeight > keepWeight) beginExile(world, agentId, events);
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
    const neediest = world.agents
      .filter((agent) => agent.status !== "dead")
      .sort((left, right) => left.inventory.reduce((total, item) => total + item.qty, 0) - right.inventory.reduce((total, item) => total + item.qty, 0)
        || left.id.localeCompare(right.id))[0];
    if (neediest) grantIdol(world, neediest.id, events, "tide");
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
  plantIdolClue(world);
}

/** Each twist leaves whispers behind: a clue tile marking where searching may pay off. */
function plantIdolClue(world: MutableWorld): void {
  const clues = world.gameplay.idolClues ?? [];
  if (clues.length >= 3) return;
  const camp = world.structures.find((structure) => structure.kind === "camp")?.tile ?? world.structures[0]?.tile ?? "D4";
  const land = world.terrain.filter((tile) => tile.biome !== "ocean" && tile.tile !== camp && !clues.includes(tile.tile));
  if (land.length === 0) return;
  const far = (tile: string) => Math.max(
    Math.abs(tile.charCodeAt(0) - camp.charCodeAt(0)),
    Math.abs(Number(tile.slice(1)) - Number(camp.slice(1))),
  );
  const ordered = land.slice().sort((left, right) => far(right.tile) - far(left.tile) || left.tile.localeCompare(right.tile));
  const tile = ordered[Math.abs(world.seed + world.gameplay.twistCount) % ordered.length]!.tile;
  world.gameplay.idolClues = [...clues, tile];
}

/** Once the rescue signal is out and weather permits, a boat makes contact and the story ends. */
function maybeRescue(world: MutableWorld, events: SimEvent[]): void {
  const gameplay = world.gameplay;
  if (gameplay.rescueAtTick !== undefined) return;
  const objective = gameplay.objectives.find((goal) => goal.kind === "rescue");
  if (!objective?.completed) return;
  const signalFire = world.structures.find((structure) => structure.kind === "signal-fire");
  if (!signalFire) return;
  if (world.weather.condition === "storm") return;
  gameplay.rescueAtTick = world.clock.tick;
  const survivors = world.agents.filter((agent) => agent.status !== "dead").map((agent) => agent.id);
  events.push({ kind: "rescue-arrived", tick: world.clock.tick, survivors });
}

const COUNCIL_INTERVAL_DAYS = 3;
const COUNCIL_HOUR = 20;

/** Tick of the council held on the given in-world day, at dusk. */
function councilTickForDay(day: number): number {
  return Math.max(0, (day - 1) * 24 + COUNCIL_HOUR);
}

/** How short the camp is running: 0 when stocked, up to 1 when supplies are thin. */
function campScarcity(world: MutableWorld): number {
  const living = Math.max(1, world.agents.filter((agent) => agent.status !== "dead").length);
  const food = world.resources.filter((resource) => ["berries", "fish", "meat"].includes(resource.kind)).reduce((total, resource) => total + resource.quantity, 0);
  const water = world.resources.filter((resource) => resource.kind === "water").reduce((total, resource) => total + resource.quantity, 0);
  const perHead = (food + water) / living;
  return perHead >= 4 ? 0 : 1 - perHead / 4;
}

/** Deterministic blame score: distrust, prior betrayals, and hoarding under scarcity, nudged by temperament. */
function nominationScore(world: MutableWorld, voter: MutableAgent, target: MutableAgent, scarcity: number): number {
  const trust = trustBetween(voter, target.id);
  const betrayal = world.gameplay.betrayalCounts[target.id] ?? 0;
  const hoard = target.inventory.reduce((total, item) => total + item.qty, 0) / INVENTORY_CAPACITY;
  let score = -trust * 2 + betrayal * 0.8 + scarcity * hoard * 1.5;
  if (voter.personality.traits.includes("opportunistic") || voter.personality.traits.includes("independent")) score += 0.2;
  if (voter.personality.traits.includes("empathetic") || voter.personality.traits.includes("loyal")) score -= 0.25;
  return score;
}

/** Each castaway names one target; alliance members never nominate their own. */
function councilNominee(world: MutableWorld, voter: MutableAgent, living: MutableAgent[], scarcity: number): MutableAgent | undefined {
  const alliance = allianceForAgent(world.gameplay, voter.id);
  const candidates = living.filter((candidate) => candidate.id !== voter.id && !(alliance?.members.includes(candidate.id) ?? false));
  if (candidates.length === 0) return undefined;
  return candidates
    .slice()
    .sort((left, right) => nominationScore(world, voter, right, scarcity) - nominationScore(world, voter, left, scarcity)
      || left.id.localeCompare(right.id))[0];
}

/** Survivor-style council: nominate, coordinate blocs, vote, exile the winner, and let the camp react. */
function holdTribalCouncil(world: MutableWorld, events: SimEvent[]): void {
  const tick = world.clock.tick;
  const exiledNow = new Set(world.gameplay.exiles.map((exile) => exile.agentId));
  const living = world.agents.filter((agent) => agent.status !== "dead" && !exiledNow.has(agent.id));
  if (living.length < 3) return;
  if (world.gameplay.rescueAtTick !== undefined) return;
  const due = world.gameplay.nextCouncilTick ?? councilTickForDay(3);
  if (tick < due || world.clock.hour !== COUNCIL_HOUR) return;

  events.push({ kind: "vote-called", tick });
  const scarcity = campScarcity(world);
  const votes = new Map<string, string>();
  for (const voter of living) {
    const nominee = councilNominee(world, voter, living, scarcity);
    if (nominee) votes.set(voter.id, nominee.id);
  }

  // Alliance blocs throw their weight behind the target their members already favour most.
  for (const alliance of world.gameplay.alliances) {
    const members = alliance.members.filter((member) => votes.has(member));
    if (members.length < 2) continue;
    const tally = new Map<string, number>();
    for (const member of members) {
      const target = votes.get(member)!;
      if (alliance.members.includes(target)) continue;
      tally.set(target, (tally.get(target) ?? 0) + 1);
    }
    const blocTarget = [...tally.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
    if (blocTarget) for (const member of members) votes.set(member, blocTarget);
  }

  const castVotes = [...votes.entries()].map(([voterId, targetId]) => ({ voterId, targetId }));
  // A played extra-vote doubles its holder's ballot.
  for (const idol of world.gameplay.idols) {
    if (idol.kind !== "extra-vote" || !idol.played) continue;
    const target = votes.get(idol.holderId);
    if (target) castVotes.push({ voterId: idol.holderId, targetId: target });
  }
  for (const vote of castVotes) events.push({ kind: "vote-cast", tick, voterId: vote.voterId, targetId: vote.targetId });

  const counts = new Map<string, number>();
  for (const vote of castVotes) counts.set(vote.targetId, (counts.get(vote.targetId) ?? 0) + 1);
  const rank = [...counts.entries()]
    .sort((left, right) => right[1] - left[1]
      || (world.gameplay.betrayalCounts[right[0]] ?? 0) - (world.gameplay.betrayalCounts[left[0]] ?? 0)
      || left[0].localeCompare(right[0]));
  let winner: string | undefined = rank[0]?.[0];

  // A played immunity idol negates every vote against its holder; the next-highest goes instead.
  const shield = winner ? world.gameplay.idols.find((idol) => idol.kind === "immunity-idol" && idol.played && idol.holderId === winner) : undefined;
  if (winner && shield) {
    const negatedVotes = counts.get(winner) ?? 0;
    events.push({ kind: "vote-negated", tick, agentId: winner, idolId: shield.id, negatedVotes });
    world.gameplay.idols = world.gameplay.idols.filter((idol) => idol.id !== shield.id);
    winner = rank.find(([target]) => target !== shield.holderId)?.[0];
  }

  if (winner) {
    beginExile(world, winner, events);
    for (const vote of castVotes) {
      if (vote.targetId !== winner) continue;
      updateTrust(world, winner, vote.voterId, -0.5, tick);
    }
    for (const alliance of world.gameplay.alliances) {
      if (!alliance.members.includes(winner)) continue;
      for (const allyId of alliance.members) {
        if (allyId === winner) continue;
        for (const vote of castVotes) if (vote.targetId === winner) updateTrust(world, allyId, vote.voterId, -0.2, tick);
      }
      alliance.members = alliance.members.filter((member) => member !== winner);
    }
    maintainAlliances(world, [], events);
  }
  world.gameplay.lastVote = { tick, votes: castVotes, exiledId: winner };
  world.gameplay.idols = world.gameplay.idols.filter((idol) => !(idol.kind === "extra-vote" && idol.played));
  world.gameplay.nextCouncilTick = councilTickForDay(world.clock.day + COUNCIL_INTERVAL_DAYS);
}

function returnExiles(world: MutableWorld, events: SimEvent[]): void {  const remaining: MutableExile[] = [];
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

/** Seeded idol pool: rare full-negate idols first, then rotating soft advantages. */
const IDOL_POOL = [
  { kind: "immunity-idol", scope: "self" },
  { kind: "healing-herbs", scope: "ally" },
  { kind: "extra-vote", scope: "self" },
  { kind: "supply-cache", scope: "group" },
  { kind: "immunity-idol", scope: "self" },
  { kind: "signal-boost", scope: "group" },
  { kind: "steal-protection", scope: "self" },
  { kind: "trust-charm", scope: "ally" },
  { kind: "immunity-idol", scope: "self" },
  { kind: "storm-shelter", scope: "group" },
] as const;

function idolCaps(idols: readonly { kind: string }[]): { idols: number; edges: number } {
  return {
    idols: idols.filter((idol) => idol.kind === "immunity-idol").length,
    edges: idols.filter((idol) => idol.kind !== "immunity-idol").length,
  };
}

/** Grant the next seeded pool pick to an agent when caps allow. */
function grantIdol(world: MutableWorld, agentId: string, events: SimEvent[], source: string): boolean {
  const caps = idolCaps(world.gameplay.idols);
  if (caps.idols >= 3 && caps.edges >= 4) return false;
  if (world.agents.filter((candidate) => candidate.status !== "dead").length < 2) return false;
  const agent = world.agents.find((candidate) => candidate.id === agentId);
  if (!agent || agent.status === "dead") return false;
  for (let attempt = 0; attempt < IDOL_POOL.length; attempt += 1) {
    const pick = IDOL_POOL[(world.gameplay.idols.length + attempt) % IDOL_POOL.length]!;
    if (pick.kind === "immunity-idol" && caps.idols >= 3) continue;
    if (pick.kind !== "immunity-idol" && caps.edges >= 4) continue;
    const idol: MutableIdol = {
      id: `idol-${world.seed}-${source}-${world.clock.tick}-${agent.id}`,
      kind: pick.kind,
      scope: pick.scope,
      holderId: agent.id,
      foundAtTick: world.clock.tick,
      expiresAtTick: 119,
      played: false,
    };
    if (world.gameplay.idols.some((entry) => entry.id === idol.id)) continue;
    world.gameplay.idols.push(idol);
    events.push({ kind: "idol-found", tick: world.clock.tick, agentId: agent.id, idolId: idol.id, idolKind: idol.kind, scope: idol.scope });
    return true;
  }
  return false;
}

/** Clue tiles pay off: inspecting a tile with whispers resolves into one seeded idol pool pick. */
function findIdols(world: MutableWorld, inputEvents: readonly SimEvent[], events: SimEvent[]): void {
  for (const event of inputEvents) {
    if (event.kind !== "inspected") continue;
    const clues = world.gameplay.idolClues ?? [];
    if (!clues.includes(event.target)) continue;
    world.gameplay.idolClues = clues.filter((tile) => tile !== event.target);
    if (grantIdol(world, event.agentId, events, "search")) return;
  }
}

/** Expired holdings burn at the Day 5 deadline so hoarding cannot stall councils. */
function expireIdols(world: MutableWorld, events: SimEvent[]): void {
  const remaining: MutableIdol[] = [];
  for (const idol of world.gameplay.idols) {
    if (!idol.played && world.clock.tick > idol.expiresAtTick) {
      events.push({ kind: "idol-expired", tick: world.clock.tick, agentId: idol.holderId, idolId: idol.id });
      continue;
    }
    remaining.push(idol);
  }
  world.gameplay.idols = remaining;
}

/** Held idols are lost on exile and death, dropping as re-findable pool space. */
function dropIdolsOf(world: MutableWorld, agentId: string): void {
  world.gameplay.idols = world.gameplay.idols.filter((idol) => idol.holderId !== agentId || idol.played);
}

/** Resolve trust, goals, alliances, exile votes, twists, and returns deterministically after a tick. */
export function advanceIslandGameplay(world: WorldState, inputEvents: readonly SimEvent[]): { world: WorldState; events: SimEvent[] } {
  const next = mutableWorld(initializeIslandGameplay(world));
  const events: SimEvent[] = [];
  for (const event of inputEvents) {
    if (event.kind === "traded" || event.kind === "shared" || event.kind === "helped" || event.kind === "talked") {
      updateTrust(next, event.from, event.to, event.trustDelta, event.tick);
      if ((event.kind === "helped" || event.kind === "shared") && event.trustDelta > 0) {
        const charm = next.gameplay.idols.find((idol) => idol.kind === "trust-charm" && idol.played && idol.holderId === event.from);
        if (charm) {
          updateTrust(next, event.from, event.to, 0.3, event.tick);
          next.gameplay.idols = next.gameplay.idols.filter((idol) => idol.id !== charm.id);
        }
      }
    } else if (event.kind === "stolen" || event.kind === "sabotaged") {
      updateTrust(next, event.from, event.to, event.trustDelta, event.tick);
    }
  }
  progressObjectives(next, inputEvents, events);
  registerDeaths(next, inputEvents, events);
  for (const event of inputEvents) {
    if (event.kind !== "agent-died") continue;
    dropIdolsOf(next, event.agentId);
  }
  recoverAgents(next, inputEvents, events);
  discoverSecrets(next, inputEvents, events);
  findIdols(next, inputEvents, events);
  expireIdols(next, events);
  maintainAlliances(next, inputEvents, events);
  formAlliances(next, events);
  registerBetrayals(next, inputEvents, events);
  holdTribalCouncil(next, events);
  applyTwist(next, events);
  maybeRescue(next, events);
  returnExiles(next, events);
  return { world: next, events };
}
