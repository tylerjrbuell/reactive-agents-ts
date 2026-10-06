import { ActionRequest, ActionType } from "../world/schema.js";
import { WorldState } from "../world/schema.js";
import { Perception } from "../engine/perceive.js";

/**
 * A decision returned by a DecisionMaker.
 */
export interface Decision {
  /** The goal or motivation behind the decision */
  goal: string;
  /** A short summary of the reasoning */
  reasoningSummary: string;
  /** The plan as a list of steps */
  plan: string[];
  /** The action to take */
  action: ActionRequest;
  /** Confidence in the decision (0-1) */
  confidence?: number;
  /** Probabilities for each action (optional) */
  probabilities?: Record<string, number>;
  /** Whether the decision is calibrated (optional) */
  calibrated?: boolean;
}

/**
 * A function that produces a Decision given world state and perception.
 */
export interface DecisionMaker {
  decide(input: {
    world: WorldState;
    agentId: string;
    perception: Perception;
  }): Promise<Decision>;
}

/**
 * Helper to find the Chebyshev distance between two tile IDs.
 */
function distance(a: string, b: string): number {
  const colA = a.charCodeAt(0);
  const rowA = parseInt(a.slice(1), 10);
  const colB = b.charCodeAt(0);
  const rowB = parseInt(b.slice(1), 10);
  return Math.max(Math.abs(colA - colB), Math.abs(rowA - rowB));
}

/**
 * Creates a scripted decision maker that follows a simple heuristic:
 * 1. If any need is critical (>=9), choose the corresponding action (eat, drink, rest) if the needed resource is visible.
 * 2. Otherwise, gather the nearest visible resource.
 * 3. If no resources are visible, inspect.
 */
export function makeScriptedDecisionMaker(): DecisionMaker {
  return {
    async decide({ world, agentId, perception }) {
      const self = perception.self;
      const tick = perception.tick;
      const needs = self.needs;

      // Determine critical need
      let criticalNeed: keyof typeof needs | undefined;
      if (needs.hunger >= 9) criticalNeed = "hunger";
      else if (needs.thirst >= 9) criticalNeed = "thirst";
      else if (needs.energy >= 9) criticalNeed = "energy";

      // Map critical need to action and target
      if (criticalNeed) {
        const actionMap: Record<keyof typeof needs, ActionType> = {
          hunger: "eat",
          thirst: "drink",
          energy: "rest",
        };
        const actionType = actionMap[criticalNeed];
        // Look for the needed resource in inventory or visible resources
        let target: string | undefined;
        if (actionType === "eat") {
          const food = perception.visibleResources.find(
            r => r.kind === "berries" || r.kind === "fish" || r.kind === "meat"
          );
          if (food) target = food.kind;
        } else if (actionType === "drink") {
          const water = perception.visibleResources.find(r => r.kind === "water");
          if (water) target = water.kind;
        }
        // For rest, no target needed
        if (target !== undefined || actionType === "rest") {
          return {
            goal: `Address critical ${criticalNeed}`,
            reasoningSummary: `${criticalNeed} at ${needs[criticalNeed]}, choosing ${actionType}`,
            plan: [actionType],
            action: { type: actionType, target },
            confidence: 0.9,
            probabilities: { [actionType]: 0.9 },
            calibrated: false,
          };
        }
        // If we cannot satisfy the critical need, fall through to gathering
      }

      // Gather nearest visible resource
      const visibleResources = perception.visibleResources;
      if (visibleResources.length > 0) {
        const nearest = visibleResources.reduce((best, res) =>
          distance(self.location, res.tile) < distance(self.location, best.tile) ? res : best
        );
        return {
          goal: `Gather ${nearest.kind}`,
          reasoningSummary: `Nearest ${nearest.kind} at ${nearest.tile}`,
          plan: ["gather", nearest.kind],
          action: { type: "gather", target: nearest.kind },
          confidence: 0.8,
          probabilities: { gather: 0.8 },
          calibrated: false,
        };
      }

      // Default to inspect
      return {
        goal: "Understand surroundings",
        reasoningSummary: "No urgent needs or visible resources, inspecting",
        plan: ["inspect"],
        action: { type: "inspect", target: undefined },
        confidence: 0.7,
        probabilities: { inspect: 0.7 },
        calibrated: false,
      };
    },
  };
}