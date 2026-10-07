import { AgentState } from "../world/schema.js";
import { Weather } from "../world/schema.js";

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
type MutableAgent = Mutable<AgentState> & { needs: Mutable<AgentState["needs"]> };

export function decayNeeds(agent: AgentState, weather: Weather, tick: number = 0, exerted: boolean = false): AgentState {
  const newAgent = structuredClone(agent) as MutableAgent;
  // Hunger and thirst rise gradually so one unproductive hour is not fatal.
  if (tick % 4 === 0) newAgent.needs.hunger = Math.min(10, newAgent.needs.hunger + 1);
  if (tick % 4 === 0) newAgent.needs.thirst = Math.min(10, newAgent.needs.thirst + 1);
  // Energy is modeled as fatigue. Only strenuous actions add fatigue, with storms amplifying exertion.
  if (exerted) newAgent.needs.energy = Math.min(10, newAgent.needs.energy + (weather.condition === "storm" ? 2 : 1));
  return newAgent;
}

/** Return need name if at 9 or above */
export function needsCritical(agent: AgentState): "hunger" | "thirst" | "energy" | undefined {
  if (agent.needs.hunger >= 9) return "hunger";
  if (agent.needs.thirst >= 9) return "thirst";
  if (agent.needs.energy >= 9) return "energy";
  return undefined;
}
