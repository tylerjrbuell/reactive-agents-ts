import type { WorldState, AgentState, TerrainTile, ResourceNode } from "../world/schema.js";

/** Simple Chebyshev distance on tile IDs like "A1" */
function distance(a: string, b: string): number {
  const colA = a.charCodeAt(0);
  const rowA = parseInt(a.slice(1), 10);
  const colB = b.charCodeAt(0);
  const rowB = parseInt(b.slice(1), 10);
  return Math.max(Math.abs(colA - colB), Math.abs(rowA - rowB));
}

export interface Perception {
  tick: number;
  self: AgentState;
  visibleTiles: TerrainTile[];
  visibleAgents: Array<{
    id: string;
    name: string;
    location: string;
    status: AgentState["status"];
    needs: AgentState["needs"];
    inventory: AgentState["inventory"];
  }>;
  visibleResources: ResourceNode[];
  relationships: AgentState["relationships"];
  memory: AgentState["memory"];
}

/** Build perception for an agent within radius 2 (inclusive) */
export function perceive(world: WorldState, agentId: string): Perception {
  const agent = world.agents.find(a => a.id === agentId);
  if (!agent) throw new Error("agent not found");
  const radius = 2;
  const visibleTiles = world.terrain.filter(t => distance(agent.location, t.tile) <= radius);
  const visibleAgents = world.agents
    .filter(a => a.id !== agentId && a.status !== "dead" && distance(agent.location, a.location) <= radius)
    .map(a => ({ id: a.id, name: a.name, location: a.location, status: a.status, needs: a.needs, inventory: a.inventory }));
  const visibleResources = world.resources.filter(r => distance(agent.location, r.tile) <= radius);
  return {
    tick: world.clock.tick,
    self: agent,
    visibleTiles,
    visibleAgents,
    visibleResources,
    relationships: agent.relationships,
    memory: agent.memory,
  };
}

/** Render a short text description of perception – used for LLM input */
export function renderPerception(p: Perception): string {
  const lines: string[] = [];
  lines.push(`Tick ${p.tick}, agent ${p.self.name} at ${p.self.location}`);
  lines.push(`Needs: hunger=${p.self.needs.hunger}, thirst=${p.self.needs.thirst}, energy=${p.self.needs.energy}`);
  lines.push(`Visible resources: ${p.visibleResources.map(r => `${r.kind}(${r.quantity})@${r.tile}`).join(", ")}`);
  lines.push(`Visible agents: ${p.visibleAgents.map(a => `${a.name}@${a.location} hunger=${a.needs.hunger} thirst=${a.needs.thirst} carrying=${a.inventory.map((item) => `${item.kind}(${item.qty})`).join(",") || "nothing"}`).join(", ")}`);
  return lines.join("\n");
}
