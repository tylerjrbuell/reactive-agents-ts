import type { AgentState, ActionRequest, WorldState } from "../world/schema.js";
import type { Rng } from "./rng.js";
import type { SimEvent } from "./events.js";
import type { ActionResult } from "./actions.js";
import { addInventoryItem, removeInventoryItem } from "./inventory.js";

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
type MutableAgent = Mutable<AgentState> & {
  needs: Mutable<AgentState["needs"]>;
  inventory: Array<Mutable<AgentState["inventory"][number]>>;
};
type MutableWorld = Omit<Mutable<WorldState>, "agents"> & { agents: MutableAgent[] };

function distance(left: string, right: string): number {
  return Math.max(
    Math.abs(left.charCodeAt(0) - right.charCodeAt(0)),
    Math.abs(Number(left.slice(1)) - Number(right.slice(1))),
  );
}

function hasTrait(agent: AgentState, ...traits: string[]): boolean {
  return traits.some((trait) => agent.personality.traits.includes(trait));
}

function chooseItem(agent: AgentState, requested: string | undefined): string | undefined {
  if (requested && agent.inventory.some((item) => item.kind === requested && item.qty > 0)) return requested;
  return agent.inventory.find((item) => item.qty > 0)?.kind;
}

function targetFor(world: WorldState, actor: AgentState, targetId: string | undefined): AgentState | undefined {
  if (!targetId || targetId === actor.id) return undefined;
  const target = world.agents.find((agent) => agent.id === targetId && agent.status !== "dead");
  return target && distance(actor.location, target.location) <= 1 ? target : undefined;
}

function failure(world: WorldState, tick: number, agentId: string, reason: string): ActionResult {
  return {
    ok: false,
    world,
    events: [{ kind: "action-failed", tick, agentId, reason }],
    reason,
  };
}

function trust(agent: AgentState, otherId: string): number {
  return agent.relationships[otherId]?.trust ?? 0;
}

/** Resolve nearby character interactions against a cloned world. */
export function resolveInteraction(
  world: WorldState,
  agentId: string,
  action: ActionRequest,
  rng: Rng,
): ActionResult {
  const originalActor = world.agents.find((agent) => agent.id === agentId);
  if (!originalActor) return failure(world, world.clock.tick, agentId, "agent not found");
  const originalTarget = targetFor(world, originalActor, action.target);
  if (!originalTarget) return failure(world, world.clock.tick, agentId, "survivor is not nearby");

  const nextWorld = structuredClone(world) as MutableWorld;
  const actor = nextWorld.agents.find((agent) => agent.id === agentId) as MutableAgent;
  const target = nextWorld.agents.find((agent) => agent.id === originalTarget.id) as MutableAgent;
  const tick = world.clock.tick;
  const events: SimEvent[] = [];

  switch (action.type) {
    case "share":
    case "help": {
      const urgentNeed = target.needs.thirst >= target.needs.hunger ? "thirst" : "hunger";
      const item = action.item ?? (urgentNeed === "thirst" ? "water" : "berries");
      const need = item === "water" ? "thirst" : "hunger";
      const recovery = item === "water" ? 5 : ["berries", "fish", "meat"].includes(item) ? 4 : 0;
      if (recovery === 0) return failure(world, tick, agentId, "item cannot satisfy a survival need");
      const removed = removeInventoryItem(actor.inventory, item);
      if (!removed.ok) return failure(world, tick, agentId, `${item} is not carried`);
      if (action.type === "share") {
        const added = addInventoryItem(target.inventory, item, 1);
        if (!added.ok) return failure(world, tick, agentId, "survivor has no carry capacity");
        actor.inventory = removed.inventory;
        target.inventory = added.inventory;
        events.push({ kind: "shared", tick, from: actor.id, to: target.id, item, amount: 1, trustDelta: 0.18 });
      } else {
        actor.inventory = removed.inventory;
        target.needs[need] = Math.max(0, target.needs[need] - recovery);
        events.push({ kind: "helped", tick, from: actor.id, to: target.id, item, need, amount: recovery, trustDelta: 0.25 });
      }
      return { ok: true, world: nextWorld, events };
    }
    case "trade": {
      const given = chooseItem(actor, action.item);
      const requested = target.inventory.find((item) =>
        item.qty > 0 && (item.kind === "water" && actor.needs.thirst >= 4 || ["berries", "fish", "meat"].includes(item.kind) && actor.needs.hunger >= 4),
      )?.kind ?? chooseItem(target, undefined);
      if (!given || !requested || requested === given) return failure(world, tick, agentId, "no useful two-way trade is available");
      const actorRemoved = removeInventoryItem(actor.inventory, given);
      const targetRemoved = removeInventoryItem(target.inventory, requested);
      if (!actorRemoved.ok || !targetRemoved.ok) return failure(world, tick, agentId, "trade items are unavailable");
      const actorAdded = addInventoryItem(actorRemoved.inventory, requested, 1);
      const targetAdded = addInventoryItem(targetRemoved.inventory, given, 1);
      if (!actorAdded.ok || !targetAdded.ok) return failure(world, tick, agentId, "trade exceeds carry capacity");
      actor.inventory = actorAdded.inventory;
      target.inventory = targetAdded.inventory;
      events.push({ kind: "traded", tick, from: actor.id, to: target.id, given, received: requested, trustDelta: 0.12 });
      return { ok: true, world: nextWorld, events };
    }
    case "talk": {
      const topic = target.needs.thirst >= 7 ? "finding water" : target.needs.hunger >= 7 ? "finding food" : "the island";
      const hostile = hasTrait(actor, "hostile", "ruthless") || hasTrait(target, "hostile", "ruthless");
      const trustDelta = hostile ? -0.08 : 0.08 + (hasTrait(actor, "empathetic", "loyal") ? 0.04 : 0);
      events.push({ kind: "talked", tick, from: actor.id, to: target.id, topic, trustDelta });
      return { ok: true, world: nextWorld, events };
    }
    case "steal": {
      const item = chooseItem(target, action.item);
      if (!item) return failure(world, tick, agentId, "survivor has nothing to steal");
      const actorHasCapacity = addInventoryItem(actor.inventory, item, 1);
      if (!actorHasCapacity.ok) return failure(world, tick, agentId, "no carry capacity to steal that item");
      const bonus = (hasTrait(actor, "opportunistic", "selfish") ? 0.2 : 0) + (hasTrait(actor, "ruthless", "cynical") ? 0.1 : 0);
      const chance = Math.max(0.05, Math.min(0.95, 0.1 + actor.personality.riskTolerance * 0.5 + bonus + (actor.skills.scavenging ?? 0) * 0.015 - trust(actor, target.id) * 0.2));
      const success = rng.next() < chance;
      let detected = !success;
      let amount = 0;
      let trustDelta = -0.16;
      if (success) {
        const removed = removeInventoryItem(target.inventory, item);
        if (!removed.ok) return failure(world, tick, agentId, "item is no longer available");
        actor.inventory = actorHasCapacity.inventory;
        target.inventory = removed.inventory;
        amount = 1;
        detected = rng.next() < 0.2 + actor.personality.riskTolerance * 0.2;
        trustDelta = detected ? -0.5 : -0.25;
      }
      events.push({ kind: "stolen", tick, from: actor.id, to: target.id, item, amount, detected, trustDelta });
      return { ok: true, world: nextWorld, events };
    }
    case "sabotage": {
      const item = chooseItem(target, action.item);
      if (!item) return failure(world, tick, agentId, "survivor has no supply to sabotage");
      const traitBonus = hasTrait(actor, "ruthless", "hostile", "chaotic") ? 0.3 : 0;
      const chance = Math.max(0.05, Math.min(0.9, 0.1 + actor.personality.riskTolerance * 0.45 + traitBonus - trust(actor, target.id) * 0.15));
      const success = rng.next() < chance;
      const removed = success ? removeInventoryItem(target.inventory, item) : { ok: false, inventory: target.inventory };
      if (success && removed.ok) target.inventory = removed.inventory;
      events.push({ kind: "sabotaged", tick, from: actor.id, to: target.id, item, amount: success && removed.ok ? 1 : 0, trustDelta: success ? -0.45 : -0.15 });
      return { ok: true, world: nextWorld, events };
    }
    default:
      return failure(world, tick, agentId, "unsupported interaction");
  }
}
