import type { WorldState, ResourceNode } from "../world/schema.js";

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

/** Regrow resources based on days elapsed, respecting initialQuantity caps */
export function regrowResources(world: WorldState, daysElapsed: number): WorldState {
  return {
    ...world,
    resources: world.resources.map((node) => ({
      ...node,
      quantity: Math.min(node.initialQuantity, node.quantity + node.regrowthPerDay * daysElapsed),
    })),
  };
}
