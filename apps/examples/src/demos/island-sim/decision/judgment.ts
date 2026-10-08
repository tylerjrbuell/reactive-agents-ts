import type { ActionRequest } from "../world/schema.js";
import type { Perception } from "../engine/perceive.js";
import type { Decision, DecisionMaker } from "./types.js";

/** List of all action types (must match the schema literals). */
export const ALL_ACTION_TYPES = [
  "move",
  "gather",
  "hunt",
  "build",
  "craft",
  "eat",
  "drink",
  "rest",
  "trade",
  "share",
  "help",
  "talk",
  "steal",
  "sabotage",
  "inspect",
  "play",
  "gift",
] as const;
export type ActionType = typeof ALL_ACTION_TYPES[number];

/** Structural subset of the judgment answer we need. */
export interface JudgmentAnswerLike {
  kind: "choice" | "score" | "noul";
  value?: string;
  confidence?: number;
  calibrated?: boolean;
  probabilities?: Record<string, number>;
}

/** Agent-like interface for judgment. */
export interface JudgmentAgentLike {
  judge(input: {
    state: unknown;
    questions: Record<string, unknown>;
  }): Promise<Record<string, JudgmentAnswerLike>>;
}

/**
 * Build a decision maker from a judgment agent.
 * @param agent The judgment agent.
 * @param opts Optional configuration (minConfidence).
 */
export function makeJudgmentDecisionMaker(agent: JudgmentAgentLike, opts: { minConfidence?: number } = {}): DecisionMaker {
  const minConf = opts.minConfidence ?? 0;
  return {
    async decide({ world, agentId, perception }) {
      // Build questions for the judgment agent.
      // Action choice: list of action types.
      // Target choice: visible resource kinds and agent names.
      const visibleResourceKinds = [...new Set(perception.visibleResources.map(r => r.kind))];
      const visibleAgentNames = [...new Set(perception.visibleAgents.map(a => a.name))];
      const targetChoices = [...visibleResourceKinds, ...visibleAgentNames];
      
      // Build criteria for choice questions - map action types to descriptions
      const actionCriteria: Record<string, string> = {};
      for (const action of ALL_ACTION_TYPES) {
        actionCriteria[action] = action;
      }
      
      // Build criteria for target choices
      const targetCriteria: Record<string, string> = {};
      for (const target of targetChoices) {
        targetCriteria[target] = target;
      }
      
      // Score criteria - must be an array of descriptions indexed from zero
      const urgencyCriteria = ["Very Low", "Low", "Medium", "High", "Very High"] as const;

      const questions = {
        action: { type: "choice", criteria: actionCriteria },
        target: { type: "choice", criteria: targetCriteria },
        urgency: { type: "score", criteria: urgencyCriteria },
      } as const;

      const rawAnswers = await agent.judge({
        state: perceiveRender(perception),
        questions,
      });

      // Extract action answer.
      const actionAns = rawAnswers.action as JudgmentAnswerLike | undefined;
      let actionType: ActionType = "inspect";
      let target: string | undefined = undefined;
      let confidence = 0.0;
      let calibrated = false;
      let probabilities: Record<string, number> = {};

      if (actionAns && actionAns.kind === "choice" && typeof actionAns.value === "string" && actionAns.value.length > 0) {
        const val = actionAns.value;
        // Accept the value as action type; we will validate against ALL_ACTION_TYPES.
        if (ALL_ACTION_TYPES.includes(val as ActionType)) {
          actionType = val as ActionType;
          confidence = actionAns.confidence ?? 0.0;
          calibrated = actionAns.calibrated ?? false;
          // If probabilities are provided, use them; else create a simple distribution.
          if (actionAns.probabilities) {
            probabilities = actionAns.probabilities;
          } else {
            // Assign remaining probability to other actions? We'll just set the chosen action probability to confidence.
            probabilities = { [actionType]: confidence };
          }
        }
      }
      // If action is not valid, fallback to inspect.
      if (!ALL_ACTION_TYPES.includes(actionType)) {
        actionType = "inspect";
        target = undefined;
        confidence = 0.0;
        calibrated = false;
        probabilities = { inspect: 0.0 };
      }

      // Extract target answer if action expects a target.
      // For simplicity, we'll get target from rawAnswers.target if present and relevant.
      const targetAns = rawAnswers.target as JudgmentAnswerLike | undefined;
      if (targetAns && targetAns.kind === "choice" && typeof targetAns.value === "string" && targetAns.value.length > 0) {
        const tval = targetAns.value as string;
        // Only set target if the action type expects a target (e.g., gather, eat, etc.)
        // For simplicity, we'll set target if the action type is not one of the non-target actions.
        const noTargetActions = new Set(["rest", "inspect"]);
        if (!noTargetActions.has(actionType as ActionType)) {
          target = resolveTarget(perception, actionType, tval) ?? tval;
        }
      }

      // Build decision.
      const goal = "Survive and thrive";
      const reasoningSummary = `Chose ${actionType}${target ? ` ${target}` : ""}`;
      const plan = target ? [actionType, target] : [actionType];

      return {
        goal,
        reasoningSummary,
        plan,
        action: { type: actionType, target },
        confidence,
        probabilities,
        calibrated,
      };
    },
  };
}

/**
 * Model judgments speak names; the engine needs ids. Resolve a chosen target
 * against live perception: agent names to ids for social actions, resource
 * kinds to the nearest visible resource id for gathering. Returns undefined
 * when the action takes its target verbatim (item kinds, tiles, idol ids).
 */
function resolveTarget(perception: Perception, actionType: ActionType, tval: string): string | undefined {
  const social = new Set(["help", "share", "talk", "trade", "steal", "sabotage", "gift"]);
  if ((social as Set<string>).has(actionType)) {
    return perception.visibleAgents.find((agent) => agent.name === tval)?.id;
  }
  if (actionType === "gather") {
    const here = perception.self.location;
    const distance = (tile: string) => Math.max(
      Math.abs(tile.charCodeAt(0) - here.charCodeAt(0)),
      Math.abs(Number(tile.slice(1)) - Number(here.slice(1))),
    );
    return perception.visibleResources
      .filter((resource) => resource.kind === tval && resource.quantity > 0)
      .sort((left, right) => distance(left.tile) - distance(right.tile)
        || right.quantity - left.quantity
        || left.id.localeCompare(right.id))[0]?.id;
  }
  return undefined;
}

// Helper to render perception as string (we can import from perceive.ts, but to avoid circular dependency, we'll copy a simple version).
function perceiveRender(p: Perception): string {  const lines: string[] = [];
  lines.push(`Tick ${p.tick}, agent ${p.self.name} at ${p.self.location}`);
  lines.push(`Needs: hunger=${p.self.needs.hunger}, thirst=${p.self.needs.thirst}, energy=${p.self.needs.energy}`);
  lines.push(`Visible resources: ${p.visibleResources.map(r => `${r.kind}(${r.quantity})@${r.tile}`).join(", ")}`);
  lines.push(`Visible agents: ${p.visibleAgents.map(a => `${a.name}@${a.location}`).join(", ")}`);
  return lines.join("\n");
}

/** Template narrative for a decision. */
export function templateNarrative(
  action: ActionRequest,
  probabilities: Record<string, number>,
  goal: string
): Pick<Decision, "goal" | "reasoningSummary" | "plan"> {
  // Sort probabilities descending.
  const sorted = Object.entries(probabilities)
    .filter(([_, p]) => p > 0)
    .sort((a, b) => b[1] - a[1]);
  const topTwo = sorted.slice(0, 2);
  const summaryParts = topTwo.map(([act, prob]) => `${act}: ${prob.toFixed(2)}`);
  const reasoningSummary = `Chose ${action.type}${action.target ? ` ${action.target}` : ""}. ${summaryParts.join(", ")}`;
  const plan: string[] = [action.type];
  if (action.target) {
    plan.push(action.target);
  }
  return {
    goal,
    reasoningSummary,
    plan,
  };
}
