import type { ToolDefinition } from "../types.js";
import { detectCompletionGaps } from "./completion-gaps.js";

export interface PulseInput {
  question: string | undefined;
  entropy: { composite: number; shape: string; momentum: number; history?: readonly number[] } | undefined;
  controllerDecisionLog: readonly string[];
  steps: readonly { type: string; content: string; metadata?: Record<string, unknown> }[];
  iteration: number;
  maxIterations: number;
  tokens: number;
  tokenBudget: number;
  task: string;
  allToolSchemas: readonly { name: string; description: string; parameters: readonly unknown[] }[];
  toolsUsed: ReadonlySet<string>;
  requiredTools: readonly string[];
}

export const pulseTool: ToolDefinition = {
  name: "pulse",
  description:
    "Take the pulse of your current execution. Returns entropy signal, behavioral analysis, " +
    "context pressure, and an actionable recommendation. " +
    "Optional question: 'am I ready to answer?', 'should I change approach?', 'how much context do I have left?'. " +
    "Call when stuck, unsure, or before calling final-answer.",
  parameters: [
    {
      name: "question",
      type: "string",
      description:
        "Optional focus question: 'am I ready to answer?' | 'should I change approach?' | 'how much context do I have left?'",
      required: false,
    },
  ],
  returnType: "object",
  riskLevel: "low",
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function",
  category: "data",
};

const META_TOOLS = new Set([
  "final-answer", "task-complete", "context-status",
  "scratchpad-write", "scratchpad-read", "brief", "pulse", "find", "recall",
]);

export function buildPulseResponse(input: PulseInput): unknown {
  const signal = buildSignal(input.entropy);
  const behavior = buildBehavior(input.steps);
  const context = buildContext(input);
  const controller = { decisionsThisRun: [...input.controllerDecisionLog], pendingDecisions: [] };
  const { readyToAnswer, blockers } = checkReadiness(input);
  const recommendation = buildRecommendation(signal, behavior, context, blockers, input.iteration);
  return { signal, behavior, context, controller, recommendation, readyToAnswer, blockers };
}

function buildSignal(entropy: PulseInput["entropy"]) {
  if (!entropy) return { grade: "unknown", composite: -1, shape: "unknown", momentum: 0, confidence: "low" };
  const grade = computeGrade(entropy.composite);
  return { grade, composite: entropy.composite, shape: entropy.shape, momentum: entropy.momentum, confidence: "medium" };
}

function computeGrade(composite: number): string {
  if (composite <= 0.3) return "A";
  if (composite <= 0.45) return "B";
  if (composite <= 0.65) return "C";
  if (composite <= 0.75) return "D";
  return "F";
}

function buildBehavior(steps: PulseInput["steps"]) {
  const actions = steps.filter((s) => s.type === "action");
  const observations = steps.filter((s) => s.type === "observation");
  const actionCounts = new Map<string, number>();
  for (const a of actions) {
    try {
      const parsed = JSON.parse(a.content) as { tool?: string; input?: string };
      const key = `${parsed.tool}::${parsed.input ?? ""}`;
      actionCounts.set(key, (actionCounts.get(key) ?? 0) + 1);
    } catch { /* ignore */ }
  }
  const repeatedActions = [...actionCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key.split("::")[0] ?? key);
  const repeatedInvocations = [...actionCounts.values()].filter((c) => c > 1).reduce((sum, c) => sum + (c - 1), 0);
  const loopScore = actions.length > 0 ? repeatedInvocations / actions.length : 0;
  const successCount = observations.filter((o) => (o.metadata as any)?.observationResult?.success !== false).length;
  const toolSuccessRate = observations.length > 0 ? successCount / observations.length : 1;
  const uniqueTools = new Set(actions.map((a) => { try { return (JSON.parse(a.content) as any).tool ?? ""; } catch { return ""; } }));
  const actionDiversity = actions.length > 0 ? uniqueTools.size / actions.length : 1;
  return { loopScore, toolSuccessRate, repeatedActions, actionDiversity };
}

function buildContext(input: PulseInput) {
  const { tokens, tokenBudget, iteration, maxIterations } = input;
  const pressurePct = tokens / tokenBudget;
  const pressureLevel = pressurePct >= 0.9 ? "critical" : pressurePct >= 0.75 ? "high" : pressurePct >= 0.5 ? "moderate" : "low";
  return {
    iterationsUsed: iteration,
    iterationsRemaining: Math.max(0, maxIterations - iteration),
    tokens,
    pressureLevel,
    headroomTokens: Math.max(0, tokenBudget - tokens),
    atRiskSections: pressurePct >= 0.75 ? ["history"] : [],
  };
}

function checkReadiness(input: PulseInput): { readyToAnswer: boolean; blockers: string[] } {
  const blockers: string[] = [];
  const { toolsUsed, requiredTools, iteration, steps } = input;
  const missingRequired = requiredTools.filter((t) => !toolsUsed.has(t));
  if (missingRequired.length > 0) blockers.push(`Required tools not yet called: ${missingRequired.join(", ")}`);
  if (iteration < 1) blockers.push("Need at least 1 iteration before finalizing.");
  const hasRealWork = [...toolsUsed].some((t) => !META_TOOLS.has(t));
  if (!hasRealWork && requiredTools.length === 0) blockers.push("No tools have been used yet — do some work before answering.");
  const gaps = detectCompletionGaps(input.task, toolsUsed, input.allToolSchemas, steps);
  for (const gap of gaps) blockers.push(gap);
  return { readyToAnswer: blockers.length === 0, blockers };
}

function buildRecommendation(
  signal: ReturnType<typeof buildSignal>,
  behavior: ReturnType<typeof buildBehavior>,
  context: ReturnType<typeof buildContext>,
  blockers: string[],
  iteration: number,
): string {
  if (behavior.loopScore > 0.7) return "You may be repeating the same actions — try a different approach or rephrase your query.";
  if (signal.shape === "flat" && iteration > 3) return "Entropy is not decreasing. Your current approach may not be working. Consider pivoting strategy.";
  if (signal.shape === "oscillating") return "Oscillating reasoning detected. Commit to one approach rather than switching back and forth.";
  if (context.pressureLevel === "critical") return "Context is nearly full. Finalize your answer soon or key history will be compressed away.";
  if (context.pressureLevel === "high") return "Context pressure is high. Avoid large tool results — use recall() for storage.";
  if (blockers.length > 0) return `Not ready to finalize: ${blockers[0]}`;
  return "Execution is on track. Continue with your current approach.";
}
