/**
 * Fast deterministic context synthesis — phase × tier templates, no LLM call.
 *
 * Builds the **ideal conversation chain** for native function calling models.
 * The gather/synthesize phases reconstruct proper multi-turn message structure
 * (user → assistant+tool_call → tool_result → user_nudge) instead of flattening
 * everything into a single user message. Independent testing with Ollama/cogito:14b
 * confirmed that FC models need this multi-turn structure to correctly sequence
 * tool calls — a single user blob causes them to repeat the last successful tool.
 *
 * Orient/produce/verify phases use single-user messages since there are no prior
 * tool results to structure.
 */
import { Effect } from "effect";
import type { LLMMessage } from "@reactive-agents/llm-provider";
import type { KernelMessage } from "../strategies/kernel/kernel-state.js";
import { formatToolSchemaCompact } from "../strategies/kernel/tool-utils.js";
import type { SynthesisInput } from "./synthesis-types.js";

function isToolResultMessage(m: KernelMessage): m is Extract<KernelMessage, { role: "tool_result" }> {
  return m.role === "tool_result";
}

function isAssistantMessage(m: KernelMessage): m is Extract<KernelMessage, { role: "assistant" }> {
  return m.role === "assistant";
}

/** Compact tool reference for required + missing tools. */
function buildToolHint(input: SynthesisInput): string {
  const missingTools = input.requiredTools.filter((t) => !input.toolsUsed.has(t));
  if (missingTools.length === 0) return "";
  const schemas = input.availableTools.filter((t) => missingTools.includes(t.name));
  if (schemas.length === 0) return "";
  return `Required tools (call these):\n${schemas.map(formatToolSchemaCompact).join("\n")}`;
}

/** Max full turns to include per tier — older turns get summarized. */
const FULL_TURNS_BY_TIER: Record<string, number> = {
  local: 2,
  mid: 3,
  large: 5,
  frontier: 8,
};

/** Max chars for tool call arguments in reconstructed assistant messages. */
const ARG_BUDGET_BY_TIER: Record<string, number> = {
  local: 100,
  mid: 200,
  large: 400,
  frontier: 600,
};

/** Truncate a JSON argument value, preserving structure hints. */
function truncateArguments(
  args: Record<string, unknown>,
  budget: number,
): Record<string, unknown> {
  const serialized = JSON.stringify(args);
  if (serialized.length <= budget) return args;
  const truncated: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && value.length > 80) {
      truncated[key] = `${value.slice(0, 60)}... [${value.length} chars]`;
    } else {
      truncated[key] = value;
    }
  }
  return truncated;
}

interface TurnGroup {
  assistant: LLMMessage;
  toolResults: LLMMessage[];
}

/**
 * Reconstruct multi-turn conversation from the kernel transcript.
 *
 * Applies tier-adaptive windowing: only the last N turns are preserved as
 * full multi-turn messages. Older turns are summarized into a single compact
 * user message — mirroring applyMessageWindow's compaction strategy.
 *
 * Tool call arguments are truncated per tier budget so large payloads
 * (e.g. file-write content) don't bloat the synthesized context.
 */
function reconstructConversationTurns(
  input: SynthesisInput,
  resultBudget: number,
): readonly LLMMessage[] {
  const transcript = input.transcript;
  const tier = input.tier ?? "mid";
  const maxFullTurns = FULL_TURNS_BY_TIER[tier] ?? 3;
  const argBudget = ARG_BUDGET_BY_TIER[tier] ?? 200;

  // First pass: group into turns (assistant+tool_call → tool_results)
  const turns: TurnGroup[] = [];
  let currentAssistant: LLMMessage | null = null;
  let currentResults: LLMMessage[] = [];

  for (let i = 0; i < transcript.length; i++) {
    const msg = transcript[i]!;

    if (isAssistantMessage(msg)) {
      // Flush prior turn
      if (currentAssistant) {
        turns.push({ assistant: currentAssistant, toolResults: currentResults });
      }
      const toolCalls = ("toolCalls" in msg && msg.toolCalls) ? msg.toolCalls : undefined;
      if (toolCalls && toolCalls.length > 0) {
        currentAssistant = {
          role: "assistant",
          content: [
            ...(msg.content ? [{ type: "text" as const, text: msg.content }] : []),
            ...toolCalls.map((tc: { id?: string; name: string; arguments?: Record<string, unknown> }) => ({
              type: "tool_use" as const,
              id: tc.id ?? `tc-${i}`,
              name: tc.name,
              input: truncateArguments((tc.arguments ?? {}) as Record<string, unknown>, argBudget),
            })),
          ],
        };
        currentResults = [];
      } else {
        currentAssistant = null;
        currentResults = [];
      }
    } else if (isToolResultMessage(msg) && currentAssistant) {
      const content = msg.content.length > resultBudget
        ? `${msg.content.slice(0, resultBudget)}\n[... ${msg.content.length - resultBudget} chars truncated]`
        : msg.content;
      currentResults.push({
        role: "tool",
        content,
        ...(msg.toolCallId ? { toolCallId: msg.toolCallId } : {}),
        ...(msg.toolName ? { toolName: msg.toolName } : {}),
      } as LLMMessage);
    }
  }
  // Flush final turn
  if (currentAssistant) {
    turns.push({ assistant: currentAssistant, toolResults: currentResults });
  }

  if (turns.length === 0) return [];

  // Window: keep last N turns as full multi-turn, summarize older ones
  if (turns.length <= maxFullTurns) {
    return turns.flatMap((t) => [t.assistant, ...t.toolResults]);
  }

  const oldTurns = turns.slice(0, turns.length - maxFullTurns);
  const recentTurns = turns.slice(turns.length - maxFullTurns);

  const summaryParts = oldTurns.map((turn) => {
    const content = turn.assistant.content;
    const toolNames = Array.isArray(content)
      ? content.filter((b: any) => b.type === "tool_use").map((b: any) => b.name).join(", ")
      : "";
    const results = turn.toolResults
      .map((r) => (typeof r.content === "string" ? r.content : "").slice(0, 80))
      .join("; ");
    return toolNames ? `called ${toolNames} → ${results}` : "";
  }).filter(Boolean);

  const summary: LLMMessage = {
    role: "user",
    content: `[Prior work: ${summaryParts.join(" | ")}]`,
  };

  return [summary, ...recentTurns.flatMap((t) => [t.assistant, ...t.toolResults])];
}

/** Build the user-role steering message that directs the model's next action. */
function buildSteeringNudge(input: SynthesisInput): string {
  const { requiredTools, toolsUsed, lastErrors, taskPhase, iteration, maxIterations } = input;
  const missingTools = requiredTools.filter((t) => !toolsUsed.has(t));
  const completedRequired = requiredTools.filter((t) => toolsUsed.has(t));
  const urgency =
    iteration >= maxIterations - 2 ? ` (${maxIterations - iteration} iterations remaining)` : "";

  const lines: string[] = [];

  if (completedRequired.length > 0) {
    lines.push(`Completed: ${completedRequired.map((t) => `${t} ✓`).join(", ")}`);
  }

  if (lastErrors.length > 0) {
    for (const err of lastErrors) {
      lines.push(`Error: ${err} — skip this, use data from other calls`);
    }
  }

  switch (taskPhase) {
    case "orient":
      lines.push("Start by calling your first required tool.");
      break;
    case "gather":
      if (missingTools.length > 0) {
        lines.push(`Now call ${missingTools[0]} with the appropriate arguments.${urgency}`);
      }
      break;
    case "synthesize":
      lines.push("All required tools have been called. Provide your final summary now — describe what was accomplished.");
      break;
    case "produce":
      lines.push(`Produce the output now.${urgency}`);
      break;
    case "verify":
      lines.push("Output has been written successfully. Summarize what was accomplished and provide your final answer.");
      break;
  }

  return lines.join("\n");
}

function buildOrientMessages(input: SynthesisInput): readonly LLMMessage[] {
  const toolHint = buildToolHint(input);
  const sections = [
    input.task,
    ...(toolHint ? [toolHint] : []),
    buildSteeringNudge(input),
  ];
  return [{ role: "user", content: sections.join("\n\n") }];
}

/**
 * Gather phase: prior tools have been called, more are needed.
 * Builds proper multi-turn conversation: task → assistant(tool_call) → tool_result → nudge.
 */
function buildGatherMessages(input: SynthesisInput): readonly LLMMessage[] {
  const resultBudget = input.tier === "local" ? 300 : input.tier === "mid" ? 500 : 800;
  const toolHint = buildToolHint(input);
  const nudge = buildSteeringNudge(input);

  const turns = reconstructConversationTurns(input, resultBudget);

  if (turns.length > 0) {
    const nudgeParts = [nudge, ...(toolHint ? [toolHint] : [])];
    return [
      { role: "user", content: input.task },
      ...turns,
      { role: "user", content: nudgeParts.join("\n\n") },
    ];
  }

  const sections = [input.task, ...(toolHint ? [toolHint] : []), nudge];
  return [{ role: "user", content: sections.join("\n\n") }];
}

/**
 * Synthesize phase: all required tools called, model should produce final output.
 * Preserves multi-turn structure so the model sees the full tool conversation.
 */
function buildSynthesizeMessages(input: SynthesisInput): readonly LLMMessage[] {
  const resultBudget = input.tier === "local" ? 400 : input.tier === "mid" ? 700 : 1200;
  const toolHint = buildToolHint(input);
  const nudge = buildSteeringNudge(input);

  const turns = reconstructConversationTurns(input, resultBudget);

  if (turns.length > 0) {
    const nudgeParts = [nudge, ...(toolHint ? [toolHint] : [])];
    return [
      { role: "user", content: input.task },
      ...turns,
      { role: "user", content: nudgeParts.join("\n\n") },
    ];
  }

  const sections = [input.task, ...(toolHint ? [toolHint] : []), nudge];
  return [{ role: "user", content: sections.join("\n\n") }];
}

function buildProduceMessages(input: SynthesisInput): readonly LLMMessage[] {
  return [{ role: "user", content: `${input.task}\n\n${buildSteeringNudge(input)}` }];
}

function buildVerifyMessages(input: SynthesisInput): readonly LLMMessage[] {
  const lastWrite = [...input.transcript]
    .reverse()
    .find((m) => isToolResultMessage(m) && m.toolName.includes("write"));

  const sections = [
    input.task,
    ...(lastWrite ? [`Output written:\n${lastWrite.content.slice(0, 400)}`] : []),
    buildSteeringNudge(input),
  ];
  return [{ role: "user", content: sections.join("\n\n") }];
}

/**
 * Fast deterministic synthesis — no LLM call.
 * Builds the ideal conversation chain for each task phase.
 * Gather/synthesize phases emit multi-turn messages with proper FC structure;
 * orient/produce/verify use single user messages.
 */
export function fastSynthesis(
  input: SynthesisInput,
): Effect.Effect<readonly LLMMessage[], never, never> {
  return Effect.sync(() => {
    switch (input.taskPhase) {
      case "orient":
        return buildOrientMessages(input);
      case "gather":
        return buildGatherMessages(input);
      case "synthesize":
        return buildSynthesizeMessages(input);
      case "produce":
        return buildProduceMessages(input);
      case "verify":
        return buildVerifyMessages(input);
      default:
        return buildGatherMessages(input);
    }
  });
}
