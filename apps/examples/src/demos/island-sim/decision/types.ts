import type { ActionRequest, AgentState, WorldState } from "../world/schema.js";
import type { Perception } from "../engine/perceive.js";
import { INVENTORY_CAPACITY, inventoryUnits } from "../engine/inventory.js";

/** A deterministic autonomous decision with a short, inspectable rationale. */
export type Decision = {
  goal: string;
  reasoningSummary: string;
  plan: string[];
  action: ActionRequest;
  confidence?: number;
  probabilities?: Record<string, number>;
  calibrated?: boolean;
};

/** Contract implemented by scripted and model-backed survivor decision makers. */
export type DecisionMaker = {
  decide(input: { world: WorldState; agentId: string; perception: Perception }): Promise<Decision>;
};

function distance(a: string, b: string): number {
  return Math.max(
    Math.abs(a.charCodeAt(0) - b.charCodeAt(0)),
    Math.abs(Number(a.slice(1)) - Number(b.slice(1))),
  );
}

function inventoryCount(agent: AgentState, kind: string): number {
  return agent.inventory.find((item) => item.kind === kind)?.qty ?? 0;
}

function hasFood(agent: AgentState): string | undefined {
  return agent.inventory.find((item) => ["berries", "fish", "meat"].includes(item.kind) && item.qty > 0)?.kind;
}

function nearbyStep(world: WorldState, agent: AgentState, target: string): string | undefined {
  return world.terrain
    .filter((tile) => tile.biome !== "ocean" && distance(agent.location, tile.tile) === 1)
    .sort((left, right) => distance(left.tile, target) - distance(right.tile, target) || left.tile.localeCompare(right.tile))[0]
    ?.tile;
}

function campTile(world: WorldState): string | undefined {
  return world.structures.find((structure) => structure.kind === "camp")?.tile ?? world.structures[0]?.tile;
}

function availableCacheItem(world: WorldState, agentId: string, kind: string): boolean {
  const alliance = world.gameplay?.alliances.find((entry) => entry.members.includes(agentId));
  return Boolean(
    alliance?.stash.some((item) => item.kind === kind && item.qty > 0)
      || world.gameplay?.campCache.some((item) => item.kind === kind && item.qty > 0),
  );
}

function decision(goal: string, reasoningSummary: string, action: ActionRequest, confidence = 0.9): Decision {
  return {
    goal,
    reasoningSummary,
    plan: [action.type, ...(action.target ? [action.target] : [])],
    action,
    confidence,
    probabilities: { [action.type]: confidence },
    calibrated: false,
  };
}

function moveToward(world: WorldState, agent: AgentState, target: string, goal: string): Decision | undefined {
  if (agent.location === target) return undefined;
  const step = nearbyStep(world, agent, target);
  return step ? decision(goal, `Move one safe step toward ${target}`, { type: "move", target: step }, 0.8) : undefined;
}

function chooseVisibleResource(perception: Perception, kinds: readonly string[]): Perception["visibleResources"][number] | undefined {
  return perception.visibleResources
    .filter((resource) => kinds.includes(resource.kind) && resource.quantity > 0)
    .sort((left, right) => distance(perception.self.location, left.tile) - distance(perception.self.location, right.tile)
      || right.quantity - left.quantity
      || left.tile.localeCompare(right.tile))[0];
}

/** Water from the tainted spring sickens whoever drinks it, so clean sources win unless neither is close. */
function chooseWater(perception: Perception, poisonedSpring: string | undefined): Perception["visibleResources"][number] | undefined {
  const water = perception.visibleResources.filter((resource) => resource.kind === "water" && resource.quantity > 0);
  const clean = water.filter((resource) => resource.tile !== poisonedSpring);
  return chooseVisibleResource({ ...perception, visibleResources: clean.length > 0 ? clean : water }, ["water"]);
}

/** Nodes with a single unit remaining are prone to being claimed by someone else first; harvest only stockier nodes. */
function worthHarvesting(resource: Perception["visibleResources"][number]): boolean {
  return resource.quantity >= 2;
}

function objectiveFor(world: WorldState, agentId: string) {
  return world.gameplay?.objectives.find((objective) => objective.ownerId === agentId && !objective.completed);
}

/** The shared rescue project: raise one signal fire, drawing on carried or stashed wood. */
function rescueWork(world: WorldState, self: AgentState, perception: Perception, agentId: string): Decision | undefined {
  const signalFire = world.structures.find((structure) => structure.kind === "signal-fire");
  if (signalFire) return undefined;
  const carriedWood = inventoryCount(self, "wood");
  if (carriedWood >= 2) {
    return decision("Raise a rescue signal", "Two pieces of wood can build a signal fire", { type: "build", target: "signal-fire" });
  }
  const camp = campTile(world);
  const atCamp = camp !== undefined && distance(self.location, camp) <= 1;
  if (atCamp && carriedWood < 2 && availableCacheItem(world, agentId, "wood")) {
    return decision("Recover stashed wood", "Retrieve stored wood to build the signal fire", { type: "retrieve", target: "wood" });
  }
  const woodNode = chooseVisibleResource(perception, ["wood"]);
  if (woodNode) {
    if (woodNode.tile === self.location) {
      return decision("Cut driftwood", "Gather wood for the rescue signal", { type: "gather", target: woodNode.id }, 0.8);
    }
    const move = moveToward(world, self, woodNode.tile, "Reach driftwood for the signal fire");
    if (move) return move;
  }
  return undefined;
}

/** Scouting toward open ground keeps castaways productive instead of idling in place. */
function scoutDecision(world: WorldState, self: AgentState, perception: Perception): Decision | undefined {
  const night = world.clock.hour < 6 || world.clock.hour >= 20;
  if (night && self.needs.energy >= 3) return decision("Sleep through the dark", "Night offers nothing but cold; rest until dawn", { type: "rest" }, 0.6);
  const target = perception.visibleTiles
    .filter((tile) => tile.biome !== "ocean" && tile.tile !== self.location)
    .sort((left, right) => distance(right.tile, self.location) - distance(left.tile, self.location)
      || left.tile.localeCompare(right.tile))[0];
  if (!target) return undefined;
  return moveToward(world, self, target.tile, "Scout the island for supplies and signs") ?? undefined;
}

/** Desperation offset staggers when each castaway snaps so the camp's starving bursts never collide. */
function desperationOffset(agentId: string): number {
  const digits = agentId.replace(/\D/g, "");
  return Number(digits) % 3;
}

function socialDecision(world: WorldState, perception: Perception): Decision | undefined {
  if (world.clock.tick % 4 !== 0) return undefined;
  const self = perception.self;
  const neighbor = perception.visibleAgents
    .filter((agent) => agent.status !== "dead")
    .filter((agent) => distance(self.location, agent.location) <= 1)
    .filter((agent) => (self.relationships[agent.id]?.trust ?? 0) < 0.55)
    .sort((left, right) => left.id.localeCompare(right.id))[0];
  if (!neighbor) return undefined;
  return decision(`Build trust with ${neighbor.name}`, `Check in with a nearby castaway at hour ${world.clock.tick}`, { type: "talk", target: neighbor.id }, 0.7);
}

/** Hold-or-play brain: burn healing when hurt, arm council edges when exposed, share edges with strained allies. */
function idolDecision(world: WorldState, self: AgentState, perception: Perception, agentId: string): Decision | undefined {
  const idols = world.gameplay?.idols?.filter((idol) => idol.holderId === agentId && !idol.played) ?? [];
  if (idols.length === 0) return undefined;
  const strainedSelf = self.needs.hunger >= 7 || self.needs.thirst >= 7 || self.status === "injured" || self.status === "ill";
  const adjacentAllies = perception.visibleAgents
    .filter((agent) => agent.status !== "dead" && agent.id !== agentId && distance(self.location, agent.location) <= 1)
    .sort((left, right) => Math.max(right.needs.hunger, right.needs.thirst) - Math.max(left.needs.hunger, left.needs.thirst));
  const strainedAlly = adjacentAllies.find((agent) => agent.needs.hunger >= 7 || agent.needs.thirst >= 7);
  const distrustedAlly = adjacentAllies.find((agent) => (self.relationships[agent.id]?.trust ?? 0) < 0.2);
  const herbs = idols.find((idol) => idol.kind === "healing-herbs");
  if (herbs && (self.status === "injured" || self.status === "ill")) {
    return decision("Use healing herbs", "A wound treated now beats days of rest", { type: "play", target: herbs.id });
  }
  if (herbs && herbs.scope !== "self" && strainedAlly && !strainedSelf) {
    return decision(`Share healing herbs with ${strainedAlly.name}`, "They are worse off; the edge helps them more", { type: "gift", target: strainedAlly.id, item: herbs.id });
  }
  const charm = idols.find((idol) => idol.kind === "trust-charm");
  if (charm && (strainedAlly ?? distrustedAlly) && !strainedSelf) {
    const ally = (strainedAlly ?? distrustedAlly)!;
    return decision(`Share a trust charm with ${ally.name}`, "An edge spent on an ally buys loyalty", { type: "gift", target: ally.id, item: charm.id });
  }
  const cache = idols.find((idol) => idol.kind === "supply-cache");
  if (cache && (self.needs.hunger >= 6 || self.needs.thirst >= 6 || strainedAlly)) {
    return decision("Open the supply cache", "Food now prevents desperation later", { type: "play", target: cache.id });
  }
  const shelter = idols.find((idol) => idol.kind === "storm-shelter");
  if (shelter && world.weather.condition === "storm" && self.needs.energy >= 6) {
    return decision("Take storm shelter", "Ride out the storm instead of burning energy", { type: "play", target: shelter.id });
  }
  const signal = idols.find((idol) => idol.kind === "signal-boost");
  if (signal && world.structures.some((structure) => structure.kind === "signal-fire")) {
    return decision("Boost the rescue signal", "The fire stands; make it seen", { type: "play", target: signal.id });
  }
  const councilIn = (world.gameplay?.nextCouncilTick ?? Number.MAX_SAFE_INTEGER) - world.clock.tick;
  const idol = idols.find((entry) => entry.kind === "immunity-idol");
  if (idol && councilIn <= 24 && (strainedSelf || (world.gameplay?.betrayalCounts[agentId] ?? 0) >= 1)) {
    return decision("Play the immunity idol", "The council is near and knives are out", { type: "play", target: idol.id });
  }
  const extra = idols.find((entry) => entry.kind === "extra-vote");
  if (extra && councilIn <= 6) {
    return decision("Play the extra vote", "Double weight at tonight's council", { type: "play", target: extra.id });
  }
  const ward = idols.find((entry) => entry.kind === "steal-protection");
  if (ward && Object.values(world.gameplay?.betrayalCounts ?? {}).some((count) => count > 0)) {
    return decision("Ward supplies", "Thieves are about; guard the pack", { type: "play", target: ward.id });
  }
  return undefined;
}

/** Create a deterministic decision maker that balances immediate needs, carrying limits, goals, and relationships. */
export function makeScriptedDecisionMaker(): DecisionMaker {
  return {
    async decide({ world, agentId, perception }) {
      const self = perception.self;
      const carried = inventoryUnits(self.inventory);
      const atCamp = campTile(world) !== undefined && distance(self.location, campTile(world)!) <= 1;
      const food = hasFood(self);

      if (self.needs.thirst >= 6 && inventoryCount(self, "water") > 0) return decision("Satisfy thirst", "Drink carried water before it becomes urgent", { type: "drink", target: "water" });

      if (self.needs.hunger >= 8) {
        if (food) return decision("Satisfy hunger", `Eat carried ${food} before hunger peaks`, { type: "eat", target: food });
        if (atCamp && availableCacheItem(world, agentId, "berries")) {
          return decision("Find food in the camp cache", "Retrieve food, then eat next hour", { type: "retrieve", target: "berries" });
        }
        const forage = chooseVisibleResource(perception, ["berries", "fish", "meat"]);
        if (forage?.tile === self.location && carried < INVENTORY_CAPACITY && worthHarvesting(forage)) {
          return decision("Find food", `Gather ${forage.kind} here before hunger peaks`, { type: "gather", target: forage.id });
        }
        if (forage) {
          const move = moveToward(world, self, forage.tile, "Reach food before hunger peaks");
          if (move) return move;
        }
      }

      if (self.needs.thirst >= 8) {
        if (inventoryCount(self, "water") > 0) return decision("Satisfy thirst", "Drink carried water before thirst peaks", { type: "drink", target: "water" });        if (atCamp && availableCacheItem(world, agentId, "water")) {
          return decision("Find water in the camp cache", "Retrieve water, then drink next hour", { type: "retrieve", target: "water" });
        }
        const water = chooseWater(perception, world.gameplay?.poisonedSpring);
        if (water?.tile === self.location && carried < INVENTORY_CAPACITY && worthHarvesting(water)) {
          return decision("Find water", "Gather drinking water here", { type: "gather", target: water.id });
        }
        if (water) {
          const move = moveToward(world, self, water.tile, "Reach fresh water");
          if (move) return move;
        }
      }

      if (self.needs.energy >= 8) return decision("Recover strength", "Rest before exhaustion", { type: "rest" });

      const idolPlay = idolDecision(world, self, perception, agentId);
      if (idolPlay) return idolPlay;

      if ((self.status === "injured" || self.status === "ill") && self.needs.energy >= 3) {
        return decision("Heal up", `${self.status === "injured" ? "A wound" : "An illness"} needs rest to mend`, { type: "rest" }, 0.8);
      }

      const objective = objectiveFor(world, agentId);
      if (objective?.kind === "help") {
        const person = perception.visibleAgents
          .filter((agent) => agent.status !== "dead")
          .filter((agent) => distance(self.location, agent.location) <= 1)
          .filter((agent) => agent.needs.hunger >= 7 || agent.needs.thirst >= 7)
          .sort((left, right) => Math.max(right.needs.hunger, right.needs.thirst) - Math.max(left.needs.hunger, left.needs.thirst))[0];
        if (person) {
          const item = person.needs.thirst >= person.needs.hunger ? "water" : food;
          if (item && inventoryCount(self, item) > 0) {
            return decision(`Help ${person.name}`, `They need ${item}; share a carried supply`, { type: "help", target: person.id, item });
          }
        }
      }

      if (carried >= INVENTORY_CAPACITY - 2) {
        const camp = campTile(world);
        if (camp && atCamp) return decision("Put supplies away", "Free carrying room before taking more from the island", { type: "store" });
        if (camp) {
          const move = moveToward(world, self, camp, "Return to camp before the pack fills");
          if (move) return move;
        }
      }

      if (objective?.kind === "build" && inventoryCount(self, "wood") >= 2) {
        return decision("Make a rescue signal", "Use gathered wood to build a visible signal fire", { type: "build", target: "signal-fire" });
      }

      if (self.needs.hunger >= 6 && !food) {
        const forage = chooseVisibleResource(perception, ["berries", "fish", "meat"]);
        if (forage && carried < INVENTORY_CAPACITY) {
          const move = forage.tile === self.location ? undefined : moveToward(world, self, forage.tile, "Gather food before hunger rises");
          if (move) return move;
          if (forage.tile === self.location && worthHarvesting(forage)) return decision("Find food", `Gather ${forage.kind}`, { type: "gather", target: forage.id }, 0.75);
        }
      }

      if (self.needs.hunger >= 6 && !food && carried < INVENTORY_CAPACITY) {
        const ground = world.terrain.find((tile) => tile.tile === self.location);
        const snareHere = world.structures.some((structure) => structure.kind === "snare" && structure.tile === self.location);
        const gameGround = ground?.biome === "forest" || ground?.biome === "grass";
        if (gameGround || snareHere) {
          return decision("Hunt for meat", "Fresh meat beats foraging when hungry", { type: "hunt" }, 0.75);
        }
        if (inventoryCount(self, "wood") > 0) {
          return decision("Set a snare", "Trap steady meat for the hungry hours ahead", { type: "craft", target: "snare" }, 0.7);
        }
      }

      if (self.needs.thirst >= 6 && inventoryCount(self, "water") === 0) {
        const water = chooseWater(perception, world.gameplay?.poisonedSpring);
        if (water && carried < INVENTORY_CAPACITY) {
          const move = water.tile === self.location ? undefined : moveToward(world, self, water.tile, "Find fresh water");
          if (move) return move;
          if (water.tile === self.location && worthHarvesting(water)) return decision("Find water", "Gather fresh water", { type: "gather", target: water.id }, 0.75);
        }
      }

      const social = socialDecision(world, perception);
      if (social) return social;

      if ((self.needs.hunger >= 9 || self.needs.thirst >= 9) && (world.clock.tick + desperationOffset(agentId)) % 3 === 0) {
        const wanted = self.needs.thirst >= 9 ? "water" : ["berries", "fish", "meat"];
        const victim = perception.visibleAgents
          .filter((agent) => agent.status !== "dead")
          .filter((agent) => distance(self.location, agent.location) <= 1)
          .filter((agent) => agent.inventory.some((item) => Array.isArray(wanted) ? wanted.includes(item.kind) && item.qty > 0 : item.kind === wanted && item.qty > 0))
          .sort((left, right) => (right.needs.hunger + right.needs.thirst) - (left.needs.hunger + left.needs.thirst)
            || left.id.localeCompare(right.id))[0];
        if (victim) {
          return decision("Desperation takes over", `Too ${self.needs.thirst >= 9 ? "parched" : "hungry"} to keep going without; take from ${victim.name}`, { type: "steal", target: victim.id, item: Array.isArray(wanted) ? undefined : wanted }, 0.55);
        }
      }

      if (objective?.kind === "explore") {
        const nextTile = perception.visibleTiles
          .filter((tile) => tile.biome !== "ocean" && tile.tile !== self.location)
          .sort((left, right) => distance(right.tile, self.location) - distance(left.tile, self.location)
            || left.tile.localeCompare(right.tile))[0];
        if (nextTile) {
          const move = moveToward(world, self, nextTile.tile, objective.title);
          if (move) return move;
        }
      }

      const resource = chooseVisibleResource(perception, ["berries", "fish", "wood", "stone", "water"]);
      if (resource && carried < INVENTORY_CAPACITY - 1) {
        const move = resource.tile === self.location ? undefined : moveToward(world, self, resource.tile, `Gather ${resource.kind}`);
        if (move) return move;
        if (resource.tile === self.location && worthHarvesting(resource)) return decision(`Gather ${resource.kind}`, `Collect nearby ${resource.kind}`, { type: "gather", target: resource.id }, 0.75);
      }

      const rescue = rescueWork(world, self, perception, agentId);
      if (rescue) return rescue;

      const scout = scoutDecision(world, self, perception);
      if (scout) return scout;

      return decision("Scan the horizon", "No urgent need or reachable supply; sweep the shoreline for signs", { type: "inspect", target: self.location }, 0.5);
    },
  };
}
