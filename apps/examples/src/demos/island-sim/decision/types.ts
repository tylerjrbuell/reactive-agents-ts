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
    .sort((left, right) => Number(right.quantity >= 2) - Number(left.quantity >= 2)
      || distance(perception.self.location, left.tile) - distance(perception.self.location, right.tile)
      || left.tile.localeCompare(right.tile))[0];
}

/** Nodes with a single unit remaining are prone to being claimed by someone else first; harvest only stockier nodes. */
function worthHarvesting(resource: Perception["visibleResources"][number]): boolean {
  return resource.quantity >= 2;
}

function objectiveFor(world: WorldState, agentId: string) {
  return world.gameplay?.objectives.find((objective) => objective.ownerId === agentId && !objective.completed);
}

function socialDecision(world: WorldState, perception: Perception): Decision | undefined {
  if (world.clock.tick % 4 !== 0) return undefined;
  const self = perception.self;
  const neighbor = perception.visibleAgents
    .filter((agent) => distance(self.location, agent.location) <= 1)
    .filter((agent) => (self.relationships[agent.id]?.trust ?? 0) < 0.55)
    .sort((left, right) => left.id.localeCompare(right.id))[0];
  if (!neighbor) return undefined;
  return decision(`Build trust with ${neighbor.name}`, `Check in with a nearby castaway at hour ${world.clock.tick}`, { type: "talk", target: neighbor.id }, 0.7);
}

/** Create a deterministic decision maker that balances immediate needs, carrying limits, goals, and relationships. */
export function makeScriptedDecisionMaker(): DecisionMaker {
  return {
    async decide({ world, agentId, perception }) {
      const self = perception.self;
      const carried = inventoryUnits(self.inventory);
      const atCamp = campTile(world) !== undefined && distance(self.location, campTile(world)!) <= 1;
      const food = hasFood(self);

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
        if (inventoryCount(self, "water") > 0) return decision("Satisfy thirst", "Drink carried water before thirst peaks", { type: "drink", target: "water" });
        if (atCamp && availableCacheItem(world, agentId, "water")) {
          return decision("Find water in the camp cache", "Retrieve water, then drink next hour", { type: "retrieve", target: "water" });
        }
        const water = chooseVisibleResource(perception, ["water"]);
        if (water?.tile === self.location && carried < INVENTORY_CAPACITY && worthHarvesting(water)) {
          return decision("Find water", "Gather drinking water here", { type: "gather", target: water.id });
        }
        if (water) {
          const move = moveToward(world, self, water.tile, "Reach fresh water");
          if (move) return move;
        }
      }

      if (self.needs.energy >= 8) return decision("Recover strength", "Rest before exhaustion", { type: "rest" });

      const objective = objectiveFor(world, agentId);
      if (objective?.kind === "help") {
        const person = perception.visibleAgents
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

      if (self.needs.thirst >= 6 && inventoryCount(self, "water") === 0) {
        const water = chooseVisibleResource(perception, ["water"]);
        if (water && carried < INVENTORY_CAPACITY) {
          const move = water.tile === self.location ? undefined : moveToward(world, self, water.tile, "Find fresh water");
          if (move) return move;
          if (water.tile === self.location && worthHarvesting(water)) return decision("Find water", "Gather fresh water", { type: "gather", target: water.id }, 0.75);
        }
      }

      const social = socialDecision(world, perception);
      if (social) return social;

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

      return decision("Understand surroundings", "No urgent need or reachable supply; inspect this place", { type: "inspect", target: self.location }, 0.6);
    },
  };
}
