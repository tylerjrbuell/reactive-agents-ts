import type { AgentState } from "../world/schema.js";

/** Apply trust update between two agents */
export function applyTrust(a: AgentState, b: AgentState, delta: number, tick: number = 0): { a: AgentState; b: AgentState } {
  const relA = a.relationships[b.id] ?? { trust: 0, lastInteraction: 0 };
  const relB = b.relationships[a.id] ?? { trust: 0, lastInteraction: 0 };
  const newRelA = { ...relA, trust: Math.max(-1, Math.min(1, relA.trust + delta)), lastInteraction: tick };
  const newRelB = { ...relB, trust: Math.max(-1, Math.min(1, relB.trust + delta)), lastInteraction: tick };
  return {
    a: { ...a, relationships: { ...a.relationships, [b.id]: newRelA } },
    b: { ...b, relationships: { ...b.relationships, [a.id]: newRelB } },
  };
}

/** Average inbound trust as reputation */
export function reputationOf(agent: AgentState, others: readonly AgentState[]): number {
  if (others.length === 0) return 0;
  let sum = 0;
  for (const o of others) {
    const rel = o.relationships[agent.id];
    if (rel) sum += rel.trust;
  }
  return sum / others.length;
}
