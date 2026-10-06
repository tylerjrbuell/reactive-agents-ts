import { AgentState } from "../world/schema.js";
import { Weather } from "../world/schema.js";

export function decayNeeds(agent: AgentState, weather: Weather): AgentState {
  const newAgent = structuredClone(agent) as AgentState;
  // simple decay: +1 hunger, +1 thirst each tick
  newAgent.needs.hunger = Math.min(10, newAgent.needs.hunger + 1);
  newAgent.needs.thirst = Math.min(10, newAgent.needs.thirst + 1);
  // weather effects
  if (weather.condition === "storm") {
    newAgent.needs.energy = Math.max(0, newAgent.needs.energy - 2);
  } else {
    newAgent.needs.energy = Math.max(0, newAgent.needs.energy - 1);
  }
  return newAgent;
}

/** Return need name if at 9 or above */
export function needsCritical(agent: AgentState): "hunger" | "thirst" | "energy" | undefined {
  if (agent.needs.hunger >= 9) return "hunger";
  if (agent.needs.thirst >= 9) return "thirst";
  if (agent.needs.energy >= 9) return "energy";
  return undefined;
}
