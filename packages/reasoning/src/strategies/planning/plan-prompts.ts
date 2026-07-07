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

import type { PlanStep } from "../../types/plan.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type ModelTier = "frontier" | "large" | "mid" | "local";

export interface ToolSummary {
  name: string;
  signature: string;
  /** Tool-level description — what the tool does. Lets the planner pick the
   *  right tool and (for free-form tools like CLIs) shape valid arguments. */
  description?: string;
  /** Per-parameter detail (type/required/description). The param descriptions
   *  often carry example invocations weak planners need to avoid inventing
   *  invalid argument shapes. */
  params?: ReadonlyArray<{
    name: string;
    type: string;
    required?: boolean;
    description?: string;
  }>;
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
  "toolArgs": "object (optional) — ALL required arguments for the tool. Use {{from_step:sN}} to inject a SHORT distilled excerpt of a previous step result (capped ~380 chars — safe for queries/ids); use {{from_step:sN:full}} ONLY when transferring whole content (e.g. file contents to write); {{from_step:sN:summary}} gives a 500-char distilled slice. NEVER template a search/tool result into a search query — extract the specific names or terms you need into a fresh, short query instead",
  "toolHints": ["string"] (optional) — tool names available for composite steps",
  "dependsOn": ["string"] (optional) — step IDs that must complete first",
  "rationale": { "why": "string (≤280 chars) — REQUIRED for tool_call steps: WHY this tool and these args advance the goal", "confidence": "number 0-1 (optional)" }
}`;

const PLAN_STEP_EXAMPLE = `{
  "steps": [
    {
      "title": "Fetch recent commits",
      "instruction": "Get the last 10 commits from the main branch",
      "type": "tool_call",
      "toolName": "github/list_commits",
      "toolArgs": { "owner": "acme", "repo": "app", "perPage": 10 },
      "rationale": { "why": "Need the raw commit list before any summarization can begin", "confidence": 0.95 }
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
      "dependsOn": ["s2"],
      "rationale": { "why": "Deliver the finished summary to the requesting user via the messaging channel", "confidence": 0.9 }
    }
  ]
}`;

/**
 * Render an `AVAILABLE TOOLS` block with tool descriptions + per-param detail.
 * Shared by the plan generator and the patch (recovery) prompt so neither path
 * is tool-blind — a name+signature alone forces weak models to invent argument
 * shapes from priors (the gh-cli "--limit"/"commit" hallucinations).
 */
function renderToolLines(tools: ToolSummary[]): string {
  return tools
    .map((t) => {
      let line = `- ${t.name}${t.signature}`;
      if (t.description) line += ` — ${t.description}`;
      if (t.params && t.params.length > 0) {
        const paramLines = t.params
          .map((p) => {
            const flags = p.required ? "required" : "optional";
            const desc = p.description ? `: ${p.description}` : "";
            return `    • ${p.name} (${p.type}, ${flags})${desc}`;
          })
          .join("\n");
        line += `\n${paramLines}`;
      }
      return line;
    })
    .join("\n");
}

/**
 * Build the few-shot example for the planner. When real tools are available it
 * anchors the example on the FIRST actual tool (real name + real param names)
 * so a weak model copies a valid call shape — the hardcoded fictional example
 * (`github/list_commits({owner, repo, perPage})`) taught arg shapes that don't
 * exist on the real tools, and weak planners cargo-culted them (the gh-cli
 * owner/repo leak). Placeholder values stay abstract (`<value>`) so no specific
 * (and possibly wrong) argument content is suggested. Falls back to the generic
 * structure-only example when no tools are available.
 */
const WRITE_TOOL_PATTERNS = ["write", "send", "post", "create", "save", "upload", "publish"];

function isWriteTool(name: string): boolean {
  const lower = name.toLowerCase();
  return WRITE_TOOL_PATTERNS.some((p) => lower.includes(p));
}

function buildPlanExample(tools: ToolSummary[]): string {
  const first = tools[0];
  if (!first) return PLAN_STEP_EXAMPLE;

  // When a write-type tool is available alongside a fetch tool, generate a
  // 3-step example showing the correct pattern: fetch → analysis → write.
  // This prevents weak models from merging synthesis + file I/O into one
  // "analysis" step, which has no tools and can never call file-write.
  const writeTool = tools.find((t) => isWriteTool(t.name));
  const fetchTool = writeTool ? (tools.find((t) => t !== writeTool) ?? first) : first;

  if (writeTool && writeTool !== fetchTool) {
    const fetchArgs =
      fetchTool.params && fetchTool.params.length > 0
        ? `{ ${fetchTool.params.map((p) => `"${p.name}": "<value>"`).join(", ")} }`
        : "{}";
    const writeArgs =
      writeTool.params && writeTool.params.length > 0
        ? `{ ${writeTool.params
            .map((p) =>
              p.name === "content" || p.name === "message" || p.name === "body"
                ? `"${p.name}": "{{from_step:s2}}"`
                : `"${p.name}": "<value>"`,
            )
            .join(", ")} }`
        : `{ "content": "{{from_step:s2}}" }`;

    return `{
  "steps": [
    {
      "title": "Fetch the needed data",
      "instruction": "Call ${fetchTool.name} to get the data the goal requires",
      "type": "tool_call",
      "toolName": "${fetchTool.name}",
      "toolArgs": ${fetchArgs},
      "rationale": { "why": "Need this data before synthesis can begin", "confidence": 0.9 }
    },
    {
      "title": "Synthesize the result",
      "instruction": "Analyze and compose the data from the previous step into the required format",
      "type": "analysis",
      "dependsOn": ["s1"]
    },
    {
      "title": "Write the output",
      "instruction": "Call ${writeTool.name} to persist or deliver the synthesized result",
      "type": "tool_call",
      "toolName": "${writeTool.name}",
      "toolArgs": ${writeArgs},
      "dependsOn": ["s2"],
      "rationale": { "why": "The goal requires persisting the output — call ${writeTool.name} with the composed content from s2", "confidence": 0.95 }
    }
  ]
}`;
  }

  // Fallback: 2-step example (single tool or no identifiable write tool)
  const toolArgs =
    first.params && first.params.length > 0
      ? `{ ${first.params.map((p) => `"${p.name}": "<value>"`).join(", ")} }`
      : "{}";

  return `{
  "steps": [
    {
      "title": "Fetch the needed data",
      "instruction": "Call ${first.name} to get the data the goal requires",
      "type": "tool_call",
      "toolName": "${first.name}",
      "toolArgs": ${toolArgs},
      "rationale": { "why": "Need this data before it can be analyzed or formatted", "confidence": 0.9 }
    },
    {
      "title": "Produce the final answer",
      "instruction": "Analyze the data from the previous step and write the final answer",
      "type": "analysis",
      "dependsOn": ["s1"]
    }
  ]
}`;
}

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
    `- Use at most ONE "analysis" step for pure text reasoning/synthesis — no tool side-effects.\n` +
    `- CRITICAL: If the goal requires a side-effect tool (write a file, send a message, POST to an API), that action MUST be a separate "tool_call" step AFTER any "analysis" step. Pass the composed content via {{from_step:sN}} as the tool argument. Never put file I/O or network calls inside an "analysis" step.\n` +
    `- Use {{from_step:sN}} in toolArgs to pass previous step results to tool calls.\n` +
    `- Combine all text reasoning into one "analysis" step — never split reasoning into multiple analysis steps.\n\n` +
    `GOAL:\n${input.goal}`,
  );

  // Section 2: Available Tools — render description + per-param detail when
  // available so the planner sees tool semantics (not just a bare signature).
  // A name+signature alone forces weak models to invent argument shapes from
  // priors (the gh-cli "--limit" hallucination); descriptions + param examples
  // anchor them on a valid invocation.
  if (input.tools.length > 0) {
    sections.push(`AVAILABLE TOOLS:\n${renderToolLines(input.tools)}`);
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
  schemaSection += `- MANDATORY: include a "rationale" object with a "why" string (≤280 chars) explaining specifically why THIS tool with THESE arguments advances the goal. Generic rationales ("call the tool") are not acceptable. Optionally include "confidence" (0-1).\n`;
  schemaSection += `- Include ALL required parameters in toolArgs\n`;
  schemaSection += `- To use output from a PREVIOUS step as an argument value, use {{from_step:sN}} where N is an EARLIER step number\n`;
  schemaSection += `- A step can ONLY reference steps that come BEFORE it (e.g., s3 can reference s1 or s2, NOT s3 itself)\n`;
  schemaSection += `- Example: s3 with {"message": "{{from_step:s2}}"} passes s2's result as the "message" argument\n`;

  if (isSmallModel) {
    schemaSection += `\nEXAMPLE:\n${buildPlanExample(input.tools)}\n`;
    schemaSection += `\nJSON only, no explanation:`;
  }

  sections.push(schemaSection);

  return sections.join("\n\n");
}

// ── buildPatchPrompt ─────────────────────────────────────────────────────────

/**
 * Shows completed steps, failed step (with error), and pending steps.
 * Asks the LLM to rewrite only the failed/remaining portion of the plan.
 *
 * `tools` (optional) renders the same enriched AVAILABLE TOOLS block the planner
 * sees. Without it the recovery is tool-blind — the model re-invents tool names
 * and arg envelopes (e.g. patching to `gh`/`endpoint` instead of the real
 * `gh-cli`/`command`), so the patch fails for the SAME root cause it's meant to
 * fix. When provided, the few-shot example is also anchored on a real tool.
 */
export function buildPatchPrompt(
  goal: string,
  steps: PlanStep[],
  tools: ToolSummary[] = [],
): string {
  const sections: string[] = [];

  sections.push(`GOAL: ${goal}`);
  sections.push(
    `The plan encountered a failure. Review the step statuses below and rewrite the failed and remaining steps.\n`,
  );

  if (tools.length > 0) {
    sections.push(`AVAILABLE TOOLS:\n${renderToolLines(tools)}`);
  }

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
    `EXAMPLE:\n${buildPlanExample(tools)}\n\n` +
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
    // rw-1 rerun (2026-07-07): reflect declared SATISFIED while an explicit
    // goal requirement ("identify data conflicts") was never addressed —
    // step completion is not requirement coverage.
    `Decompose the GOAL into its explicit requirements (every requested field, format, count, and any required meta-commentary such as noting conflicts, caveats, or unresolved items). Only respond SATISFIED if EVERY requirement is addressed by the results — steps completing without errors is NOT sufficient.\n\n` +
    `Your FIRST LINE must be exactly one of:\n` +
    `SATISFIED: <brief summary>\n` +
    `UNSATISFIED: <which requirement is missing or wrong>\n\n` +
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
