import type { WorldState } from "../world/schema.js";
import type { Perception } from "./perceive.js";
import type { SimEvent } from "./events.js";
import type { Decision, DecisionMaker } from "../decision/types.js";
import type { Rng } from "./rng.js";
import { runTick } from "./tick.js";
import { makeRng } from "./rng.js";

export interface DecisionRecord {
  tick: number;
  agentId: string;
  decision: Decision;
}

export interface RunCassette {
  seed: number;
  initialWorld: WorldState;
  records: DecisionRecord[];
}

/** Records a run of the simulation for later replay */
export class CassetteRecorder {
  records: DecisionRecord[] = [];
  tick: number = 0;
  private currentWorld: WorldState;

  constructor(
    private originalInitialWorld: WorldState,
    public maker: DecisionMaker,
    private seed: number = 0
  ) {
    this.currentWorld = structuredClone(originalInitialWorld) as WorldState;
  }

  async step(): Promise<{ world: WorldState; events: SimEvent[] }> {
    // Run tick with a fresh Rng derived from seed + tick
    const rng = makeRng(this.seed + this.tick);
    const result = await runTick(this.currentWorld, this.maker, rng);
    // Record decisions
    for (const [agentId, decision] of Object.entries(result.decisions)) {
      console.log(`[CASSETTE] recording tick: ${this.tick} for agent ${agentId}`);
      this.records.push({ tick: this.tick, agentId, decision });
    }
    this.currentWorld = result.world; // update current world to the new state
    this.tick += 1;
    return { world: result.world, events: result.events };
  }

  /** Export the recorded data */
  toCassette(): RunCassette {
    return {
      seed: this.seed,
      initialWorld: structuredClone(this.originalInitialWorld) as WorldState,
      records: [...this.records],
    };
  }
}

/** Creates a DecisionMaker that replays decisions from a cassette */
export function makeReplayDecisionMaker(cassette: RunCassette): DecisionMaker {
  // Build a map from (tick, agentId) to decision for quick lookup
  const decisionMap = new Map<string, Decision>();
  for (const rec of cassette.records) {
    const key = `${rec.tick}:${rec.agentId}`;
    decisionMap.set(key, rec.decision);
  }

  return {
    async decide({ world, agentId, perception }) {
      // We can read the current tick from the world's clock.
      const tick = world.clock.tick;
      const key = `${tick}:${agentId}`;
      const decision = decisionMap.get(key);
      if (decision) {
        return decision;
      }
      // Fallback: if no decision recorded, return a safe default (inspect)
      return {
        goal: "Fallback",
        reasoningSummary: "No recorded decision for this tick/agent",
        plan: ["inspect"],
        action: { type: "inspect", target: undefined },
        confidence: 0.5,
        probabilities: { inspect: 0.5 },
        calibrated: false,
      };
    },
  };
}

/** Replay a recorded run to get the final world and events */
export async function replayRun(cassette: RunCassette): Promise<{ world: WorldState; events: SimEvent[] }> {
  console.log(`[REPLAY] cassette seed: ${cassette.seed}, records length: ${cassette.records.length}`);
  console.log(`[REPLAY] records ticks: ${cassette.records.map(r => r.tick).join(", ")}`);
  const maker = makeReplayDecisionMaker(cassette);
  let world = structuredClone(cassette.initialWorld) as WorldState;
  console.log(`[REPLAY] initial world tick: ${world.clock.tick}`);
  const allEvents: SimEvent[] = [];
  // We need to simulate each tick up to the number of recorded ticks.
  // Determine max tick from records.
  const maxTick = Math.max(...cassette.records.map(r => r.tick));
  console.log(`[REPLAY] maxTick: ${maxTick}`);
  for (let tick = 0; tick <= maxTick; tick++) {
    console.log(`[REPLAY] processing tick ${tick}`);
    const rng = makeRng(cassette.seed + tick);
    const result = await runTick(world, maker, rng);
    world = result.world;
    allEvents.push(...result.events);
  }
  return { world, events: allEvents };
}
