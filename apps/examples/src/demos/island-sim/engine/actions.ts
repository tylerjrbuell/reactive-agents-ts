import type { ActionRequest, AgentState, IslandGameplay, WorldState } from "../world/schema.js";
import type { Rng } from "./rng.js";
import type { SimEvent } from "./events.js";
import { resolveInteraction } from "./interactions.js";
import { addInventoryItem, removeInventoryItem } from "./inventory.js";
import { initializeIslandGameplay } from "./gameplay.js";

/** Result of applying one autonomous survivor action. */
export type ActionResult = {
  ok: boolean;
  world: WorldState;
  events: SimEvent[];
  reason?: string;
};

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
type MutableAgent = Mutable<AgentState> & {
  needs: Mutable<AgentState["needs"]>;
  inventory: Array<Mutable<AgentState["inventory"][number]>>;
};
type MutableAlliance = Omit<Mutable<IslandGameplay["alliances"][number]>, "members" | "stash"> & {
  members: string[];
  stash: Array<Mutable<IslandGameplay["campCache"][number]>>;
};
type MutableGameplay = Omit<Mutable<IslandGameplay>, "campCache" | "alliances" | "idols"> & {
  campCache: Array<Mutable<IslandGameplay["campCache"][number]>>;
  alliances: MutableAlliance[];
  idols: Array<Mutable<NonNullable<IslandGameplay["idols"]>[number]>>;
  poisonedSpring?: string;
};
type MutableWorld = Omit<Mutable<WorldState>, "agents" | "gameplay" | "resources" | "structures"> & {
  agents: MutableAgent[];
  gameplay: MutableGameplay;
  resources: Array<Mutable<WorldState["resources"][number]>>;
  structures: Array<Mutable<WorldState["structures"][number]>>;
};

function distance(left: string, right: string): number {
  return Math.max(
    Math.abs(left.charCodeAt(0) - right.charCodeAt(0)),
    Math.abs(Number(left.slice(1)) - Number(right.slice(1))),
  );
}

function fail(world: WorldState, agentId: string, reason: string): ActionResult {
  return {
    ok: false,
    world,
    events: [{ kind: "action-failed", tick: world.clock.tick, agentId, reason }],
    reason,
  };
}

function cacheForAgent(gameplay: MutableGameplay, agentId: string) {
  return gameplay.alliances.find((alliance) => alliance.members.includes(agentId));
}

function addToCache(
  cache: Array<{ kind: string; qty: number }>,
  kind: string,
  quantity: number,
): void {
  const existing = cache.find((item) => item.kind === kind);
  if (existing) existing.qty += quantity;
  else cache.push({ kind, qty: quantity });
}

function takeFromCache(
  cache: Array<{ kind: string; qty: number }>,
  kind: string,
): boolean {
  const item = cache.find((candidate) => candidate.kind === kind && candidate.qty > 0);
  if (!item) return false;
  item.qty -= 1;
  for (let index = cache.length - 1; index >= 0; index -= 1) {
    if (cache[index]!.qty <= 0) cache.splice(index, 1);
  }
  return true;
}

function atCamp(world: WorldState, agent: AgentState): boolean {
  const camp = world.structures.find((structure) => structure.kind === "camp") ?? world.structures[0];
  return Boolean(camp && distance(camp.tile, agent.location) <= 1);
}

function storeSupplies(world: WorldState, agentId: string, requestedItem: string | undefined): ActionResult {
  const next = structuredClone(initializeIslandGameplay(world)) as MutableWorld;
  const agent = next.agents.find((candidate) => candidate.id === agentId);
  if (!agent) return fail(world, agentId, "agent not found");
  if (!atCamp(next, agent)) return fail(world, agentId, "camp cache is not nearby");
  if (agent.inventory.length === 0) return fail(world, agentId, "nothing to store");
  const alliance = cacheForAgent(next.gameplay, agentId);
  const cache = alliance?.stash ?? next.gameplay.campCache;
  const stored: SimEvent[] = [];
  const kept: typeof agent.inventory = [];
  for (const stack of agent.inventory) {
    if (requestedItem && stack.kind !== requestedItem) {
      kept.push(stack);
      continue;
    }
    addToCache(cache, stack.kind, stack.qty);
    stored.push({
      kind: "inventory-stored",
      tick: next.clock.tick,
      agentId,
      item: stack.kind,
      amount: stack.qty,
      cache: alliance ? "alliance" : "camp",
    });
  }
  if (stored.length === 0) return fail(world, agentId, `${requestedItem ?? "item"} is not carried`);
  agent.inventory = kept;
  return { ok: true, world: next, events: stored };
}

function retrieveSupply(world: WorldState, agentId: string, item: string | undefined): ActionResult {
  if (!item) return fail(world, agentId, "choose an item to retrieve");
  const next = structuredClone(initializeIslandGameplay(world)) as MutableWorld;
  const agent = next.agents.find((candidate) => candidate.id === agentId);
  if (!agent) return fail(world, agentId, "agent not found");
  if (!atCamp(next, agent)) return fail(world, agentId, "camp cache is not nearby");
  const alliance = cacheForAgent(next.gameplay, agentId);
  const privateCache = alliance?.stash;
  const cache = privateCache?.some((entry) => entry.kind === item && entry.qty > 0)
    ? privateCache
    : next.gameplay.campCache;
  if (!takeFromCache(cache, item)) return fail(world, agentId, `${item} is not available to you`);
  const carried = addInventoryItem(agent.inventory, item, 1);
  if (!carried.ok) return fail(world, agentId, "inventory is full");
  agent.inventory = carried.inventory;
  return {
    ok: true,
    world: next,
    events: [{
      kind: "inventory-retrieved",
      tick: next.clock.tick,
      agentId,
      item,
      amount: 1,
      cache: cache === privateCache ? "alliance" : "camp",
    }],
  };
}

function isInteraction(action: ActionRequest): boolean {
  return ["trade", "share", "help", "talk", "steal", "sabotage"].includes(action.type);
}

function heldIdol(next: MutableWorld, agentId: string, idolId: string | undefined) {
  if (!idolId) return undefined;
  const idols = next.gameplay.idols ?? [];
  return idols.find((idol) => idol.id === idolId && idol.holderId === agentId && !idol.played);
}

function removeIdol(next: MutableWorld, idolId: string): void {
  next.gameplay.idols = (next.gameplay.idols ?? []).filter((idol) => idol.id !== idolId);
}

/** Play a held advantage: arm council/social edges or apply survival effects at once. */
function playIdol(next: MutableWorld, agent: MutableAgent, idolId: string | undefined): ActionResult {
  const tick = next.clock.tick;
  const idol = heldIdol(next, agent.id, idolId);
  if (!idol) return fail(next, agent.id, "advantage is not held");
  const armed = (events: SimEvent[] = []): ActionResult => {
    idol.played = true;
    return { ok: true, world: next, events: [{ kind: "idol-played", tick, agentId: agent.id, idolId: idol.id, idolKind: idol.kind }, ...events] };
  };
  const consumed = (events: SimEvent[] = []): ActionResult => {
    removeIdol(next, idol.id);
    return { ok: true, world: next, events: [{ kind: "idol-played", tick, agentId: agent.id, idolId: idol.id, idolKind: idol.kind }, ...events] };
  };
  switch (idol.kind) {
    case "immunity-idol":
    case "extra-vote":
    case "steal-protection":
    case "trust-charm":
      return armed();
    case "healing-herbs": {
      if (agent.status !== "injured" && agent.status !== "ill") return fail(next, agent.id, "no wound or illness to heal");
      agent.status = "alive";
      agent.needs.hunger = Math.max(0, agent.needs.hunger - 2);
      return consumed([{ kind: "recovered", tick, agentId: agent.id }]);
    }
    case "supply-cache": {
      if (idol.scope === "group") {
        addToCache(next.gameplay.campCache, "berries", 2);
        addToCache(next.gameplay.campCache, "water", 1);
        return consumed();
      }
      const berries = addInventoryItem(agent.inventory, "berries", 1);
      if (!berries.ok) return fail(next, agent.id, "inventory is full");
      const water = addInventoryItem(berries.inventory, "water", 1);
      if (!water.ok) return fail(next, agent.id, "inventory is full");
      agent.inventory = water.inventory;
      return consumed();
    }
    case "storm-shelter":
      agent.needs.energy = Math.max(0, agent.needs.energy - 4);
      return consumed();
    case "signal-boost": {
      const fire = next.structures.find((structure) => structure.kind === "signal-fire");
      if (!fire) return fail(next, agent.id, "raise a signal fire first");
      return consumed();
    }
    default:
      return fail(next, agent.id, "unsupported advantage");
  }
}

/** Gift a held shareable advantage to a living castaway. */
function giftIdol(next: MutableWorld, agent: MutableAgent, targetId: string | undefined, idolId: string | undefined): ActionResult {
  const tick = next.clock.tick;
  const idol = heldIdol(next, agent.id, idolId);
  if (!idol) return fail(next, agent.id, "advantage is not held");
  if (idol.scope !== "ally" && idol.scope !== "group") return fail(next, agent.id, "that advantage cannot be gifted");
  const target = next.agents.find((candidate) => candidate.id === targetId && candidate.status !== "dead" && candidate.id !== agent.id);
  if (!target) return fail(next, agent.id, "ally is not available");
  idol.holderId = target.id;
  return { ok: true, world: next, events: [{ kind: "idol-gifted", tick, from: agent.id, to: target.id, idolId: idol.id }] };
}

/** Apply a deterministic action to a cloned world, preserving the input on failure. */
export function applyAction(world: WorldState, agentId: string, action: ActionRequest, rng: Rng): ActionResult {
  if (isInteraction(action)) return resolveInteraction(world, agentId, action, rng);
  if (action.type === "store") return storeSupplies(world, agentId, action.target);
  if (action.type === "retrieve") return retrieveSupply(world, agentId, action.target);

  const currentAgent = world.agents.find((agent) => agent.id === agentId);
  if (!currentAgent) return fail(world, agentId, "agent not found");
  const next = structuredClone(initializeIslandGameplay(world)) as MutableWorld;
  const agent = next.agents.find((candidate) => candidate.id === agentId)!;
  const tick = world.clock.tick;

  switch (action.type) {
    case "move": {
      const destination = next.terrain.find((tile) => tile.tile === action.target);
      if (!destination || destination.biome === "ocean" || distance(agent.location, destination.tile) !== 1) {
        return fail(world, agentId, "invalid move");
      }
      const from = agent.location;
      agent.location = destination.tile;
      return { ok: true, world: next, events: [{ kind: "agent-moved", tick, agentId, from, to: agent.location }] };
    }
    case "gather": {
      const resource = next.resources.find((candidate) => candidate.id === action.target && candidate.tile === agent.location);
      if (!resource || resource.quantity <= 0) return fail(world, agentId, "no resource");
      const gathered = addInventoryItem(agent.inventory, resource.kind, 1);
      if (!gathered.ok) return fail(world, agentId, "inventory is full; store supplies at camp first");
      resource.quantity -= 1;
      agent.inventory = gathered.inventory;
      const events: SimEvent[] = [{ kind: "resource-gathered", tick, agentId, resourceId: resource.id, amount: 1 }];
      if (resource.kind === "water" && next.gameplay.poisonedSpring === resource.tile && agent.status === "alive") {
        agent.status = "ill";
        events.push({ kind: "illness", tick, agentId, cause: "poisoned spring" });
      }
      return { ok: true, world: next, events };
    }
    case "eat": {
      const food = action.target ?? agent.inventory.find((item) => ["berries", "fish", "meat"].includes(item.kind) && item.qty > 0)?.kind;
      if (!food || !["berries", "fish", "meat"].includes(food)) return fail(world, agentId, "no food carried");
      const removed = removeInventoryItem(agent.inventory, food);
      if (!removed.ok) return fail(world, agentId, "food not in inventory");
      agent.inventory = removed.inventory;
      agent.needs.hunger = Math.max(0, agent.needs.hunger - 5);
      return { ok: true, world: next, events: [{ kind: "ate", tick, agentId, food }] };
    }
    case "drink": {
      const water = action.target ?? "water";
      const removed = removeInventoryItem(agent.inventory, water);
      if (!removed.ok || water !== "water") return fail(world, agentId, "no water carried");
      agent.inventory = removed.inventory;
      agent.needs.thirst = Math.max(0, agent.needs.thirst - 6);
      return { ok: true, world: next, events: [{ kind: "drank", tick, agentId, water }] };
    }
    case "rest":
      agent.needs.energy = Math.max(0, agent.needs.energy - 4);
      return { ok: true, world: next, events: [{ kind: "rested", tick, agentId }] };
    case "build": {
      const wood = removeInventoryItem(agent.inventory, "wood", 2);
      if (!wood.ok) return fail(world, agentId, "two wood are needed to build a shelter");
      agent.inventory = wood.inventory;
      const structureKind = action.target === "signal-fire" ? "signal-fire" : "shelter";
      const structureId = `${structureKind}-${agent.id}-${tick}`;
      next.structures.push({ id: structureId, kind: structureKind, tile: agent.location, ownerId: agent.id, durability: 10 });
      return { ok: true, world: next, events: [{ kind: "built", tick, agentId, structureId, structureKind }] };
    }
    case "inspect":
      return { ok: true, world: next, events: [{ kind: "inspected", tick, agentId, target: action.target ?? agent.location }] };
    case "play":
      return playIdol(next, agent, action.target);
    case "gift":
      return giftIdol(next, agent, action.target, action.item);
    case "craft": {
      const target = action.target ?? "snare";
      if (target !== "snare") return fail(world, agentId, "this island build only crafts snares");
      const snaresHere = next.structures.filter((structure) => structure.kind === "snare" && structure.tile === agent.location).length;
      if (snaresHere >= 3) return fail(world, agentId, "enough snares here already");
      const wood = removeInventoryItem(agent.inventory, "wood", 1);
      if (!wood.ok) return fail(world, agentId, "one wood is needed to craft a snare");
      agent.inventory = wood.inventory;
      next.structures.push({ id: `snare-${agent.id}-${tick}`, kind: "snare", tile: agent.location, ownerId: agent.id, durability: 3 });
      return { ok: true, world: next, events: [{ kind: "crafted", tick, agentId, item: "snare" }] };
    }
    case "hunt": {
      const tile = next.terrain.find((candidate) => candidate.tile === agent.location);
      const snare = next.structures.find((structure) => structure.kind === "snare" && structure.tile === agent.location);
      const gameBiome = tile?.biome === "forest" || tile?.biome === "grass";
      if (!gameBiome && !snare) return fail(world, agentId, "no game on this ground; hunt in forest or grass, or set a snare");
      const yield_ = snare ? 2 : rng.next() < 0.5 ? 1 : 0;
      if (yield_ <= 0) return fail(world, agentId, "the hunt came up empty");
      const stored = addInventoryItem(agent.inventory, "meat", yield_);
      if (!stored.ok) return fail(world, agentId, "inventory is full; store supplies at camp first");
      agent.inventory = stored.inventory;
      return { ok: true, world: next, events: [{ kind: "hunted", tick, agentId, animalId: `game-${agent.location}-${tick}`, amount: yield_ }] };
    }
    default:
      return fail(world, agentId, "unsupported action");
  }
}
