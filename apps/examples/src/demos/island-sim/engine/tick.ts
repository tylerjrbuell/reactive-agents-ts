import { WorldState, AgentState } from "../world/schema.js";
import { SimEvent } from "./events.js";
import { applyAction } from "./actions.js";
import { decayNeeds } from "./needs.js";
import { regrowResources } from "./resources.js";
import { perceive } from "./perceive.js";
import { Rng, makeRng } from "./rng.js";
import { advanceIslandGameplay, initializeIslandGameplay } from "./gameplay.js";
import type { Decision } from "../decision/types.js";
import type { Perception } from "./perceive.js";

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
type MutableAgent = Mutable<AgentState> & { needs: Mutable<AgentState["needs"]> };
type MutableWorld = Omit<Mutable<WorldState>, "agents" | "clock" | "weather"> & {
  agents: MutableAgent[];
  clock: Mutable<WorldState["clock"]>;
  weather: Mutable<WorldState["weather"]>;
};

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
  world = initializeIslandGameplay(world);
  const activeExiles = new Set(
    (world.gameplay?.exiles ?? [])
      .filter((exile) => world.clock.tick < exile.returnAtTick)
      .map((exile) => exile.agentId),
  );
  // 1. Snapshot decisions for living agents (parallel, no RNG)
  const livingAgents = world.agents.filter(a => a.status !== "dead" && !activeExiles.has(a.id));
  const decisionPromises = livingAgents.map(async agent => {
    const perception = perceive(world, agent.id);
    const decision = await maker.decide({ world, agentId: agent.id, perception });
    return [agent.id, decision] as const;
  });
  const decisionPairs = await Promise.all(decisionPromises);
  const decisions = Object.fromEntries(decisionPairs);

  // 2. Apply actions sequentially in agent-id order using RNG
  const agentsSorted = [...livingAgents].sort((a, b) => a.id.localeCompare(b.id));
  let newWorld = structuredClone(world) as MutableWorld;
  const events: SimEvent[] = [];
  const tick = world.clock.tick;

  for (const agent of agentsSorted) {
    const agentId = agent.id;
    const decision = decisions[agentId];
    if (!decision) continue;
    const actionResult = applyAction(newWorld, agentId, decision.action, rng);
    if (actionResult.ok) {
      newWorld = actionResult.world as MutableWorld;
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
  const postDecayAgents: MutableAgent[] = [];
  for (const agent of newWorld.agents) {
    if (agent.status === "dead" || activeExiles.has(agent.id)) {
      postDecayAgents.push(agent);
      continue;
    }
    const exerted = events.some((event) => {
      switch (event.kind) {
        case "agent-moved":
        case "resource-gathered":
        case "built":
        case "hunted":
          return event.agentId === agent.id;
        default:
          return false;
      }
    });
    const decayed = decayNeeds(agent, weather, tick, exerted) as MutableAgent;
    // Check if any need >= 10 for two consecutive ticks? Simplified: if any need >= 10, mark as dead
    if (
      decayed.needs.hunger >= 10 ||
      decayed.needs.thirst >= 10 ||
      decayed.needs.energy >= 10
    ) {
      decayed.status = "dead";
      events.push({
        kind: "agent-died",
        tick,
        agentId: decayed.id,
        cause: "need_exceeded",
      });
    } else if (weather.condition === "storm" && exerted && decayed.needs.energy >= 9 && decayed.status === "alive") {
      decayed.status = "injured";
      events.push({ kind: "injured", tick, agentId: decayed.id, cause: "working through the storm" });
    }
    postDecayAgents.push(decayed);
  }
  newWorld.agents = postDecayAgents;

  // 4. Advance weather on day rollover using a deterministic RNG based on world seed and tick
  // This ensures weather changes are independent of action RNG consumption.
  const clock = newWorld.clock;
  let weatherChanged = false;
  if (clock.hour === 23) {
    // day rollover: pick new weather based on world seed and tick
    const weatherSeed = world.seed * 1234567 + tick;
    const weatherRng = makeRng(weatherSeed);
    const conditions = ["sunny", "rain", "storm", "cloudy"] as const;
    const conditionIdx = weatherRng.int(0, conditions.length - 1);
    const newCondition = conditions[conditionIdx];
    // temperature range -5 to 35
    const tempC = weatherRng.int(-5, 35);
    newWorld.weather = { condition: newCondition, tempC };
    weatherChanged = true;
    // advance day, reset hour
    clock.day += 1;
    clock.hour = 0;
  } else {
    clock.hour += 1;
  }
  clock.tick += 1;

  // 5. Regrow resources on day rollover; a storm day salts the land.
  if (weatherChanged) {
    newWorld = regrowResources(newWorld, 1) as MutableWorld;
  }

  // 6. Resolve persistent goals, alliances, exile votes, and scheduled island twists.
  const gameplay = advanceIslandGameplay(newWorld, events);
  newWorld = gameplay.world as MutableWorld;
  events.push(...gameplay.events);

  return { world: newWorld, events, decisions };
}
