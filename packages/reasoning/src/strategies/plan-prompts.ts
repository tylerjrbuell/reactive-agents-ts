/**
 * shared/plan-prompts.ts — Pure prompt builder functions for the Structured Plan Engine.
 *
 * Four prompt builders used by plan-execute strategy:
 * - buildPlanGenerationPrompt: initial plan generation from goal + tools
 * - buildPatchPrompt: rewrite failed/remaining steps after a failure
 * - buildStepExecutionPrompt: goal-anchored prompt for analysis/composite steps
 * - buildReflectionPrompt: post-execution reflection on step results
 *
 * All functions are pure (no Effect, no LLM calls) — string template assembly only.
 */

import type { PlanStep } from "../types/plan.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type ModelTier = "frontier" | "large" | "mid" | "local";

export interface ToolSummary {
  name: string;
  signature: string;
}

export interface PlanGenerationInput {
  goal: string;
  tools: ToolSummary[];
  pastPatterns: string[];
  modelTier: ModelTier;
  /** Per-tool minimum call counts from the classifier (e.g. { "web-search": 4 }). */
  requiredToolQuantities?: Readonly<Record<string, number>>;
}

export interface StepExecutionInput {
  goal: string;
  step: PlanStep;
  stepIndex: number;
  totalSteps: number;
  priorResults: Array<{ stepId: string; title: string; result: string }>;
  scopedTools: ToolSummary[];
}

export interface StepResult {
  stepId: string;
  title: string;
  status: string;
  result?: string;
}

// ── JSON Schema for LLMPlanStep ──────────────────────────────────────────────

const PLAN_STEP_SCHEMA = `{
  "title": "string — short name for this step",
  "instruction": "string — what the LLM or tool should do",
  "type": "tool_call" | "analysis" | "composite",
  "toolName": "string (optional) — tool to call if type is tool_call",
  "toolArgs": "object (optional) — ALL required arguments for the tool. Use {{from_step:sN}} to inject the result of a previous step as a string value",
  "toolHints": ["string"] (optional) — tool names available for composite steps",
  "dependsOn": ["string"] (optional) — step IDs that must complete first"
}`;

const PLAN_STEP_EXAMPLE = `{
  "steps": [
    {
      "title": "Fetch recent commits",
      "instruction": "Get the last 10 commits from the main branch",
      "type": "tool_call",
      "toolName": "github/list_commits",
      "toolArgs": { "owner": "acme", "repo": "app", "perPage": 10 }
    },
    {
      "title": "Summarize changes",
      "instruction": "Analyze the commits and write a brief summary",
      "type": "analysis",
      "dependsOn": ["s1"]
    },
    {
      "title": "Send summary to user",
      "instruction": "Send the commit summary via messaging",
      "type": "tool_call",
      "toolName": "messaging/send",
      "toolArgs": { "recipient": "user@example.com", "message": "{{from_step:s2}}" },
      "dependsOn": ["s2"]
    }
  ]
}`;

// ── buildPlanGenerationPrompt ────────────────────────────────────────────────

/**
 * Assembles a 4-section dynamic prompt for initial plan generation:
 * 1. Role & Goal — original task verbatim
 * 2. Available Tools — pre-filtered, with name + signature
 * 3. Past Plan Patterns — from semantic memory (if available)
 * 4. Schema & Output Instructions — tier-adaptive complexity
 */
export function buildPlanGenerationPrompt(input: PlanGenerationInput): string {
  const sections: string[] = [];

  // Section 1: Role & Goal
  sections.push(
    `You are a planning agent. Decompose the goal into a structured plan.\n\n` +
    `PLANNING RULES:\n` +
    `- Prefer "tool_call" steps — they execute instantly without LLM overhead.\n` +
    `- When the goal asks for data about MULTIPLE distinct items (e.g. multiple currencies, products, users), create a SEPARATE tool_call step for each item — combined queries lose specificity.\n` +
    `- Parallel-safe tool_call steps with no data dependencies can execute concurrently — prefer separate steps over combined queries.\n` +
    `- Use at most ONE "analysis" step to do all reasoning/writing/composition work.\n` +
    `- Use {{from_step:sN}} in toolArgs to pass previous step results to tool calls.\n` +
    `- Never split summarizing, formatting, and composing into separate steps — combine them.\n\n` +
    `GOAL:\n${input.goal}`,
  );

  // Section 2: Available Tools
  if (input.tools.length > 0) {
    const toolLines = input.tools
      .map((t) => `- ${t.name}${t.signature}`)
      .join("\n");
    sections.push(`AVAILABLE TOOLS:\n${toolLines}`);
  } else {
    sections.push(`AVAILABLE TOOLS:\nNone — use "analysis" type steps only.`);
  }

  // Section 2b: Tool Call Requirements (from classifier)
  if (input.requiredToolQuantities && Object.keys(input.requiredToolQuantities).length > 0) {
    const lines = Object.entries(input.requiredToolQuantities)
      .map(([tool, qty]) => `- ${tool} must be called at least ${qty} time${qty > 1 ? "s" : ""} (once per entity)`)
      .join("\n");
    sections.push(`TOOL CALL REQUIREMENTS:\n${lines}`);
  }

  // Section 3: Past Plan Patterns (only if non-empty)
  if (input.pastPatterns.length > 0) {
    const patternLines = input.pastPatterns
      .map((p) => `- ${p}`)
      .join("\n");
    sections.push(`SIMILAR PAST PLANS:\n${patternLines}`);
  }

  // Section 4: Schema & Output Instructions (tier-adaptive)
  const isSmallModel = input.modelTier === "mid" || input.modelTier === "local";

  let schemaSection = `OUTPUT FORMAT:\nRespond with a JSON object containing a "steps" array. Each step has this schema:\n${PLAN_STEP_SCHEMA}\n\n`;
  schemaSection += `Step types:\n`;
  schemaSection += `- "tool_call": calls a specific tool (set toolName and toolArgs with ALL required params)\n`;
  schemaSection += `- "analysis": LLM reasoning/writing (no tool needed)\n`;
  schemaSection += `- "composite": multi-tool sub-task (set toolHints for available tools)\n`;
  schemaSection += `\nIMPORTANT for tool_call steps:\n`;
  schemaSection += `- Include ALL required parameters in toolArgs\n`;
  schemaSection += `- To use output from a PREVIOUS step as an argument value, use {{from_step:sN}} where N is an EARLIER step number\n`;
  schemaSection += `- A step can ONLY reference steps that come BEFORE it (e.g., s3 can reference s1 or s2, NOT s3 itself)\n`;
  schemaSection += `- Example: s3 with {"message": "{{from_step:s2}}"} passes s2's result as the "message" argument\n`;

  if (isSmallModel) {
    schemaSection += `\nEXAMPLE:\n${PLAN_STEP_EXAMPLE}\n`;
    schemaSection += `\nJSON only, no explanation:`;
  }

  sections.push(schemaSection);

  return sections.join("\n\n");
}

// ── buildPatchPrompt ─────────────────────────────────────────────────────────

/**
 * Shows completed steps, failed step (with error), and pending steps.
 * Asks the LLM to rewrite only the failed/remaining portion of the plan.
 */
export function buildPatchPrompt(goal: string, steps: PlanStep[]): string {
  const sections: string[] = [];

  sections.push(`GOAL: ${goal}`);
  sections.push(
    `The plan encountered a failure. Review the step statuses below and rewrite the failed and remaining steps.\n`,
  );

  const stepLines = steps.map((s) => {
    const icon =
      s.status === "completed" ? "\u2705" :
      s.status === "failed" ? "\u274C" :
      s.status === "in_progress" ? "\u25B6" :
      s.status === "skipped" ? "\u23ED" :
      "\u23F3";

    let line = `${icon} ${s.id} (${s.status}) — ${s.title}: ${s.instruction}`;
    if (s.result) line += `\n   Result: ${s.result}`;
    if (s.error) line += `\n   Error: ${s.error}`;
    return line;
  });

  sections.push(`CURRENT PLAN STATUS:\n${stepLines.join("\n")}`);

  sections.push(
    `Rewrite the failed and pending steps to recover from the error. ` +
    `Keep completed steps as-is. Respond with a JSON object containing a "steps" array ` +
    `(only the replacement steps, not the completed ones).\n\n` +
    `Each step MUST use this exact schema:\n${PLAN_STEP_SCHEMA}\n\n` +
    `EXAMPLE:\n${PLAN_STEP_EXAMPLE}\n\n` +
    `JSON only, no explanation.`,
  );

  return sections.join("\n\n");
}

// ── buildStepExecutionPrompt ─────────────────────────────────────────────────

/**
 * Goal-anchored prompt for executing a single analysis or composite step.
 * Keeps the OVERALL GOAL visible to prevent context loss.
 * For composite steps, scoped tools are included.
 */
export function buildStepExecutionPrompt(input: StepExecutionInput): string {
  const sections: string[] = [];

  // Overall goal — always first and visible
  sections.push(`OVERALL GOAL: ${input.goal}`);

  // Current step context
  const stepNum = input.stepIndex + 1;
  sections.push(
    `CURRENT STEP (${stepNum} of ${input.totalSteps}): ${input.step.title}\n` +
    `INSTRUCTION: ${input.step.instruction}`,
  );

  // Prior step results
  if (input.priorResults.length > 0) {
    const resultLines = input.priorResults
      .map((r, i) => `  Step ${i + 1} (${r.stepId}) result: ${r.result}`)
      .join("\n");
    sections.push(`DATA FROM PREVIOUS STEPS:\n${resultLines}`);
  }

  // Scoped tools — only for composite steps
  if (input.scopedTools.length > 0) {
    const toolLines = input.scopedTools
      .map((t) => `- ${t.name}${t.signature}`)
      .join("\n");
    sections.push(`AVAILABLE TOOLS FOR THIS STEP:\n${toolLines}`);
  }

  sections.push(
    `RULES:\n` +
    `- Produce your answer directly — no labels, no "FINAL ANSWER:" prefix.\n` +
    `- Do NOT ask follow-up questions or offer to do something. Just produce the requested content.\n` +
    `- Your output will be passed directly to the next step, so make it complete and ready to use.\n` +
    `- Keep your analysis focused and concise. Aim for completeness, not exhaustiveness.`,
  );

  return sections.join("\n\n");
}

// ── buildReflectionPrompt ────────────────────────────────────────────────────

/**
 * Lists all step results with status. Asks the LLM to evaluate whether
 * the goal was achieved. If all steps succeeded, respond with SATISFIED.
 */
export function buildReflectionPrompt(goal: string, stepResults: StepResult[]): string {
  const sections: string[] = [];

  sections.push(`GOAL: ${goal}`);

  const resultLines = stepResults
    .map((r) => {
      const icon = r.status === "completed" ? "\u2705" : r.status === "failed" ? "\u274C" : "\u23F3";
      let line = `${icon} ${r.stepId} (${r.status}) — ${r.title}`;
      if (r.result) line += `\n   Result: ${r.result}`;
      return line;
    })
    .join("\n");

  sections.push(`STEP RESULTS:\n${resultLines}`);

  sections.push(
    `Review the results above against the original goal.\n\n` +
    `Your FIRST LINE must be exactly one of:\n` +
    `SATISFIED: <brief summary>\n` +
    `UNSATISFIED: <what is missing or wrong>\n\n` +
    `Then optionally add details on a new line. The first word MUST be either SATISFIED or UNSATISFIED.`,
  );

  return sections.join("\n\n");
}

// ── buildAugmentPrompt ──────────────────────────────────────────────────────

export interface AugmentInput {
  goal: string;
  completedSteps: Array<{ stepId: string; title: string; result?: string }>;
  reflectionFeedback: string;
  tools: ToolSummary[];
}

/**
 * Builds a prompt for generating supplementary plan steps when all existing
 * steps completed but the reflection phase determined the goal is unmet.
 *
 * Unlike patchPlan (which rewrites failed steps), augmentPlan adds NEW steps
 * to fill gaps identified by the reflector.
 */
export function buildAugmentPrompt(input: AugmentInput): string {
  const sections: string[] = [];

  sections.push(`GOAL: ${input.goal}`);

  const stepLines = input.completedSteps
    .map((s) => {
      let line = `\u2705 ${s.stepId} (completed) — ${s.title}`;
      if (s.result) line += `\n   Result: ${s.result}`;
      return line;
    })
    .join("\n");
  sections.push(`COMPLETED STEPS AND RESULTS:\n${stepLines}`);

  sections.push(`REFLECTION FEEDBACK:\n${input.reflectionFeedback}`);

  if (input.tools.length > 0) {
    const toolLines = input.tools
      .map((t) => `- ${t.name}${t.signature}`)
      .join("\n");
    sections.push(`AVAILABLE TOOLS:\n${toolLines}`);
  }

  sections.push(
    `Generate ADDITIONAL steps to address the gaps identified in the reflection feedback.\n` +
    `Do NOT re-execute completed steps. Only add new steps that fill the missing data.\n` +
    `Reference completed step results with {{from_step:sN}} where applicable.\n` +
    `Each step must follow this schema:\n${PLAN_STEP_SCHEMA}\n\n` +
    `Respond with a JSON object containing a "steps" array (only the NEW supplementary steps).\n` +
    `JSON only, no explanation.`,
  );

  return sections.join("\n\n");
}
