import { WorldState, AgentState, ActionRequest } from "../world/schema.js";
import { Rng } from "./rng.js";
import { SimEvent } from "./events.js";

/** Result of applying an action */
export interface ActionResult {
  ok: boolean;
  world: WorldState;
  events: SimEvent[];
  reason?: string;
}

/** Helper: is adjacent (Chebyshev) */
function isAdjacent(a: string, b: string): boolean {
  const colA = a.charCodeAt(0);
  const rowA = parseInt(a.slice(1), 10);
  const colB = b.charCodeAt(0);
  const rowB = parseInt(b.slice(1), 10);
  return Math.max(Math.abs(colA - colB), Math.abs(rowA - rowB)) === 1;
}

/** Simple adjacency check for move */
function moveValid(agent: AgentState, target: string, world: WorldState): boolean {
  // tile exists and is not ocean
  const tile = world.terrain.find(t => t.tile === target);
  if (!tile) return false;
  if (tile.biome === "ocean") return false;
  return isAdjacent(agent.location, target);
}

export function applyAction(world: WorldState, agentId: string, action: ActionRequest, rng: Rng): ActionResult {
  const agent = world.agents.find(a => a.id === agentId);
  if (!agent) return { ok: false, world, events: [], reason: "agent not found" };
  const tick = world.clock.tick;
  const events: SimEvent[] = [];
  const newWorld = structuredClone(world) as WorldState;
  const a = newWorld.agents.find(x => x.id === agentId) as AgentState;
  switch (action.type) {
    case "move":
      if (!action.target || !moveValid(a, action.target, world)) {
        events.push({ kind: "action-failed", tick, agentId, reason: "invalid move" });
        return { ok: false, world, events };
      }
      const from = a.location;
      a.location = action.target;
      events.push({ kind: "agent-moved", tick, agentId, from, to: a.location });
      return { ok: true, world: newWorld, events };
    case "gather":
      if (!action.target) {
        events.push({ kind: "action-failed", tick, agentId, reason: "no target" });
        return { ok: false, world, events };
      }
      const res = world.resources.find(r => r.id === action.target && r.tile === a.location);
      if (!res || res.quantity <= 0) {
        events.push({ kind: "action-failed", tick, agentId, reason: "no resource" });
        return { ok: false, world, events };
      }
      const amount = Math.min(1, res.quantity);
      res.quantity -= amount;
      a.inventory.push({ kind: res.kind, qty: amount });
      events.push({ kind: "resource-gathered", tick, agentId, resourceId: res.id, amount });
      return { ok: true, world: newWorld, events };
    case "eat":
      if (!action.target) {
        events.push({ kind: "action-failed", tick, agentId, reason: "no food" });
        return { ok: false, world, events };
      }
      const foodIdx = a.inventory.findIndex(i => i.kind === action.target && i.qty > 0);
      if (foodIdx === -1) {
        events.push({ kind: "action-failed", tick, agentId, reason: "food not in inventory" });
        return { ok: false, world, events };
      }
      a.inventory[foodIdx].qty -= 1;
      a.needs.hunger = Math.max(0, a.needs.hunger - 3);
      events.push({ kind: "ate", tick, agentId, food: action.target });
      return { ok: true, world: newWorld, events };
    // ... other actions similar (drink, rest, etc.) – omitted for brevity
    default:
      events.push({ kind: "action-failed", tick, agentId, reason: "unsupported action" });
      return { ok: false, world, events };
  }
}
