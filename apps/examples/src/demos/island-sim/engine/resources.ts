import type { WorldState, ResourceNode } from "../world/schema.js";

/** Kinds that replenish over time; everything else (wood, stone) is finite driftwood and rock. */
const RENEWABLE_KINDS = new Set(["berries", "water", "fish"]);
const BASE_REGROWTH_PER_DAY: Record<string, number> = { berries: 3, water: 3, fish: 3 };

/** Regrowth rate for a resource kind. Non-renewables return 0 regardless of input. */
export function regrowthPolicyFor(kind: string): number {
  return RENEWABLE_KINDS.has(kind) ? BASE_REGROWTH_PER_DAY[kind] ?? 1 : 0;
}

/** Deplete a resource node, clamped at zero */
export function depleteResource(world: WorldState, resourceId: string, amount: number): WorldState {
  return {
    ...world,
    resources: world.resources.map((node) =>
      node.id === resourceId
        ? { ...node, quantity: Math.max(0, node.quantity - amount) }
        : node
    ),
  };
}

/** Regrow resources based on days elapsed, respecting initialQuantity caps; a storm day salts the land. */
export function regrowResources(world: WorldState, daysElapsed: number): WorldState {
  const suppressed = world.weather.condition === "storm";
  return {
    ...world,
    resources: world.resources.map((node) => ({
      ...node,
      quantity: Math.min(
        node.initialQuantity,
        node.quantity + (suppressed ? 0 : node.regrowthPerDay * daysElapsed),
      ),
    })),
  };
}
