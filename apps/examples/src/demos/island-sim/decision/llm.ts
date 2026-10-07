import type { ActionRequest, WorldState } from "../world/schema.js";
import type { Perception } from "../engine/perceive.js";
import type { Decision, DecisionMaker } from "./types.js";
import { renderPerception } from "../engine/perceive.js";
import { ALL_ACTION_TYPES } from "./judgment.js";

/**
 * Decision maker backed by a ReactiveAgents structured-output model.
 * Every decision is validated against the typed action vocabulary; any provider failure
 * degrades to the deterministic scripted maker so the simulation never stalls.
 */
export function makeLlmDecisionMaker(
  agent: { run(input: string): Promise<{ object?: unknown; objectError?: string }> },
  fallback: () => DecisionMaker = () => { throw new Error("no fallback decision maker configured"); },
): DecisionMaker {
  return {
    async decide({ world, agentId, perception }: { world: WorldState; agentId: string; perception: Perception }): Promise<Decision> {
      const prompt = [
        `You control ${perception.self.name} on an island at hour ${perception.tick}.`,
        renderPerception(perception),
        `Choose exactly one island action. Allowed types: ${ALL_ACTION_TYPES.join(", ")}.`,
        `Return JSON {"type": string, "target"?: string} where target may be a resource id, tile, or survivor id.`,
      ].join("\n\n");
      try {
        const result = await agent.run(prompt);
        const object = result.objectError ? undefined : (result.object as { type?: unknown; target?: unknown } | undefined);
        const type = object?.type;
        if (typeof type === "string" && (ALL_ACTION_TYPES as readonly string[]).includes(type)) {
          const action: ActionRequest = {
            type: type as ActionRequest["type"],
            ...(typeof object?.target === "string" && object.target.length > 0 ? { target: object.target } : {}),
          };
          return {
            goal: "Act on model judgment",
            reasoningSummary: "The model chose from live perception",
            plan: [action.type, ...(action.target ? [action.target] : [])],
            action,
            confidence: 0.7,
            probabilities: { [action.type]: 0.7 },
            calibrated: true,
          };
        }
      } catch {
        // provider failure: degrade below
      }
      const scripted = fallback();
      return scripted.decide({ world, agentId, perception });
    },
  };
}
