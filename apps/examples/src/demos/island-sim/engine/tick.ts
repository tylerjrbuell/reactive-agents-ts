import { WorldState, AgentState, ActionRequest } from "../world/schema.js";
import { SimEvent } from "./events.js";
import { applyAction } from "./actions.js";
import { decayNeeds, needsCritical } from "./needs.js";
import { applyTrust } from "./social.js";
import { regrowResources } from "./resources.js";
import { perceive } from "./perceive.js";
import { Rng } from "./rng.js";

export interface TickResult {
  world: WorldState;
  events: SimEvent[];
  decisions: Record<string, Decision>;
}

/** Run a single tick of the simulation */
export async function runTick(
  world: WorldState,
  maker: { decide: (input: { world: WorldState; agentId: string; perception: Perception }) => Promise<Decision> },
  rng: Rng
): Promise<TickResult> {
  // 1. Snapshot decisions for living agents (parallel, no RNG)
  const livingAgents = world.agents.filter(a => a.status !== "dead");
  const decisionPromises = livingAgents.map(async agent => {
    const perception = perceive(world, agent.id);
    const decision = await maker.decide({ world, agentId: agent.id, perception });
    return [agent.id, decision] as const;
  });
  const decisionPairs = await Promise.all(decisionPromises);
  const decisions = Object.fromEntries(decisionPairs);

  // 2. Apply actions sequentially in agent-id order using RNG
  const agentsSorted = [...livingAgents].sort((a, b) => a.id.localeCompare(b.id));
  let newWorld = structuredClone(world) as WorldState;
  const events: SimEvent[] = [];
  const tick = world.clock.tick;

  for (const agent of agentsSorted) {
    const agentId = agent.id;
    const decision = decisions[agentId];
    if (!decision) continue;
    const actionResult = applyAction(newWorld, agentId, decision.action, rng);
    if (actionResult.ok) {
      newWorld = actionResult.world;
      events.push(...actionResult.events);
    } else {
      // action failed, record failure event
      events.push({
        kind: "action-failed",
        tick,
        agentId,
        reason: actionResult.reason ?? "unknown",
      });
    }
  }

  // 3. Decay needs and check for death
  const weather = newWorld.weather;
  const postDecayAgents: AgentState[] = [];
  for (const agent of newWorld.agents) {
    let updated = decayNeeds(agent, weather);
    // Check if any need >= 10 for two consecutive ticks? Simplified: if any need >= 10, mark as dead
    if (
      updated.needs.hunger >= 10 ||
      updated.needs.thirst >= 10 ||
      updated.needs.energy >= 10
    ) {
      updated.status = "dead";
      events.push({
        kind: "agent-died",
        tick,
        agentId: updated.id,
        cause: "need_exceeded",
      });
    }
    postDecayAgents.push(updated);
  }
  newWorld.agents = postDecayAgents;

  // 4. Advance weather on day rollover
  const clock = newWorld.clock;
  let weatherChanged = false;
  if (clock.hour === 23) {
    // day rollover: pick new weather
    const conditions = ["sunny", "rain", "storm", "cloudy"];
    const conditionIdx = rng.int(0, conditions.length - 1);
    const newCondition = conditions[conditionIdx];
    // temperature range -5 to 35
    const tempC = rng.int(-5, 35);
    newWorld.weather = { condition: newCondition, tempC };
    weatherChanged = true;
    // advance day, reset hour
    clock.day += 1;
    clock.hour = 0;
  } else {
    clock.hour += 1;
  }
  clock.tick += 1;

  // 5. Regrow resources on day rollover
  if (weatherChanged) {
    // Assuming one day has passed
    newWorld = regrowResources(newWorld, 1);
  }

  // 6. Update trust from this tick's events
  // We'll look for events that indicate interactions: traded, shared, talked, etc.
  // For simplicity, we'll apply a small trust delta for any social event.
  const socialEvents = events.filter(e =>
    e.kind === "traded" ||
    e.kind === "shared" ||
    e.kind === "talked"
  );
  for (const ev of socialEvents) {
    if (ev.kind === "traded" || ev.kind === "shared" || ev.kind === "talked") {
      const fromId = (ev as { from?: string }).from;
      const toId = (ev as { to?: string }).to;
      if (fromId && toId) {
        const fromAgent = newWorld.agents.find(a => a.id === fromId);
        const toAgent = newWorld.agents.find(a => a.id === toId);
        if (fromAgent && toAgent) {
          const { a: updatedFrom, b: updatedTo } = applyTrust(fromAgent, toAgent, 0.1);
          // replace agents in newWorld
          const fromIdx = newWorld.agents.findIndex(a => a.id === fromId);
          const toIdx = newWorld.agents.findIndex(a => a.id === toId);
          if (fromIdx !== -1) newWorld.agents[fromIdx] = updatedFrom;
          if (toIdx !== -1) newWorld.agents[toIdx] = updatedTo;
        }
      }
    }
  }

  return { world: newWorld, events, decisions };
}