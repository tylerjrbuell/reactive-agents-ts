// File: src/context/context-manager.ts
//
// ContextManager — single owner of all context presented to the LLM each turn.
//
// Design principles:
//   1. Pure function: no side effects, no LLM calls, no Effect services.
//   2. Testable in isolation with plain mock state objects.
//   3. Deterministic: same inputs → same structure (environment timestamps vary by design).
//   4. Single responsibility: systemPrompt + messages are the only two things the model sees.
//
// The ContextManager replaces the scattered auto-forward, steeringNudge, and
// ad-hoc USER message injection patterns. All harness signals flow through
// GuidanceContext → rendered in the Guidance: section of the system prompt.

import type { LLMMessage, ModelCalibration, ProviderAdapter } from "@reactive-agents/llm-provider";
import type { KernelState, KernelInput } from "../strategies/kernel/kernel-state.js";
import type { ContextProfile } from "./context-profile.js";
import { buildStaticContext } from "./context-engine.js";
import type { KernelMessage } from "../strategies/kernel/kernel-state.js";
import type { ToolSchema } from "../strategies/kernel/utils/tool-formatting.js";
import {
  buildSystemPrompt,
  buildConversationMessages,
} from "../strategies/kernel/phases/context-utils.js";
import {
  buildToolElaborationInjection,
  type ToolElaborationInjectionConfig,
} from "../strategies/kernel/utils/tool-gating.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Aggregated harness signals for the current iteration.
 * All mid-loop guidance that previously fired as stray USER messages now lives here,
 * rendered deterministically into the system prompt's Guidance: section.
 */
export interface GuidanceContext {
  /** Required tools not yet called this run. */
  readonly requiredToolsPending: readonly string[];
  /** True when the loop-detection oracle fired on this iteration. */
  readonly loopDetected: boolean;
  /** Guidance from the Intelligent Context Synthesis (ICS) system. */
  readonly icsGuidance?: string;
  /** Guidance from the oracle / quality gate. */
  readonly oracleGuidance?: string;
  /** Recovery hint when an error occurred on the previous round. */
  readonly errorRecovery?: string;
  /** Post-act harness reminder surfaced after a tool round (progress / finish cues). */
  readonly actReminder?: string;
  /** Adapter quality-check hint rendered before accepting a prose final answer. */
  readonly qualityGateHint?: string;
  /** Reserved for Task 17 — evidence grounding redirect when claims lack tool support. */
  readonly evidenceGap?: string;
}

/** Output of ContextManager.build() — the only two things the LLM sees. */
export interface ContextManagerOutput {
  /** The complete system prompt for this iteration. */
  readonly systemPrompt: string;
  /** The curated conversation message thread for this iteration. */
  readonly messages: LLMMessage[];
}

/** Optional extras for ContextManager.build(). */
export interface ContextManagerOptions {
  /**
   * When set, tool elaboration hints are appended after the tool schema block.
   * Mirrors the think-phase call to buildToolElaborationInjection.
   */
  readonly toolElaboration?: ToolElaborationInjectionConfig;
  /**
   * Pre-filtered tool schemas to render into the static context and
   * tool elaboration sections. Think.ts supplies the classification-pruned,
   * context-pressure-narrowed list so the system prompt matches the FC tools.
   * Falls back to input.availableToolSchemas when omitted.
   */
  readonly availableTools?: readonly ToolSchema[];
  /**
   * Optional custom/system-prompt body wrapped with harness content.
   * Falls back to input.systemPrompt when omitted.
   */
  readonly systemPromptBody?: string;
}

// ── ContextManager ────────────────────────────────────────────────────────────

/**
 * ContextManager — pure context assembly for every LLM turn.
 *
 * Called by the think phase once per iteration. Returns the exact
 * `systemPrompt` and `messages` to pass to `llm.stream()`.
 *
 * Optional calibration (Phase 6) can be layered on top to tune profile
 * values without changing this function's interface.
 */
export const ContextManager = {
  build(
    state: KernelState,
    input: KernelInput,
    profile: ContextProfile,
    guidance: GuidanceContext,
    adapter?: ProviderAdapter,
    options?: ContextManagerOptions,
  ): ContextManagerOutput {
    // Determine steering channel: calibration wins when present, else tier default.
    // local/mid tiers prefer "hybrid" (system prompt + user reminder), frontier
    // relies on system prompt only.
    const calibration: ModelCalibration | undefined = input.calibration;
    const steeringChannel: "system-prompt" | "user-message" | "hybrid" =
      calibration?.steeringCompliance ??
      (profile.tier === "local" || profile.tier === "mid" ? "hybrid" : "system-prompt");

    // Render guidance in system prompt unless the channel is pure "user-message".
    const guidanceForSystemPrompt: GuidanceContext =
      steeringChannel === "user-message" ? emptyGuidance() : guidance;

    const systemPrompt = buildIterationSystemPrompt(
      state,
      input,
      profile,
      guidanceForSystemPrompt,
      adapter,
      options,
    );

    let messages: LLMMessage[];
    if (adapter) {
      messages = buildConversationMessages(state, input, profile, adapter);
    } else {
      // Adapter-less path (tests / tools) — plain conversion, no compaction.
      messages = buildCuratedMessages(state, profile);
    }

    // Append a short user-message reminder when channel is "hybrid" or "user-message".
    if (steeringChannel === "hybrid" || steeringChannel === "user-message") {
      const reminder = buildShortGuidanceReminder(guidance);
      if (reminder) {
        messages = [...messages, { role: "user", content: reminder }];
      }
    }

    return { systemPrompt, messages };
  },
};

function emptyGuidance(): GuidanceContext {
  return {
    requiredToolsPending: [],
    loopDetected: false,
  };
}

/**
 * Build a single-line harness reminder for hybrid/user-message steering channels.
 * Returns undefined when no guidance signal is active.
 */
function buildShortGuidanceReminder(guidance: GuidanceContext): string | undefined {
  if (guidance.requiredToolsPending.length > 0) {
    return `[Harness] Required: ${guidance.requiredToolsPending.join(", ")}`;
  }
  if (guidance.loopDetected) return "[Harness] Loop detected — change approach.";
  if (guidance.actReminder) {
    return `[Harness] ${guidance.actReminder.slice(0, 120)}`;
  }
  if (guidance.evidenceGap) {
    return "[Harness] Output contains ungrounded claims — revise.";
  }
  if (guidance.errorRecovery) {
    return `[Harness] ${guidance.errorRecovery.slice(0, 120)}`;
  }
  if (guidance.oracleGuidance) {
    return `[Harness] ${guidance.oracleGuidance.slice(0, 120)}`;
  }
  return undefined;
}

// ── buildIterationSystemPrompt ────────────────────────────────────────────────

/**
 * Assemble the system prompt for a single kernel iteration.
 *
 * Sections (in order):
 *   1. Agent identity (lean, tier-adaptive) — with adapter.systemPromptPatch applied
 *   2. Environment context (date, time, timezone, platform)
 *   3. Task description
 *   4. Available tools + rules
 *   5. Adapter toolGuidance (inline reminder after schema block)
 *   6. Tool elaboration hints (opt-in via options.toolElaboration)
 *   7. Progress: (tool usage summary — what has been called)
 *   8. Prior work: (distilled observation facts if any)
 *   9. Guidance: (harness signals — required tools, loops, ICS, errors)
 */
function buildIterationSystemPrompt(
  state: KernelState,
  input: KernelInput,
  profile: ContextProfile,
  guidance: GuidanceContext,
  adapter?: ProviderAdapter,
  options?: ContextManagerOptions,
): string {
  const sections: string[] = [];

  // Tool list: explicit override > input.availableToolSchemas
  const availableTools: readonly ToolSchema[] =
    options?.availableTools ??
    ((input.availableToolSchemas ?? []) as readonly ToolSchema[]);

  // 1. Agent identity. Prefer buildSystemPrompt (honors custom systemPrompt) so
  //    callers that supply input.systemPrompt keep their identity text.
  const base = buildSystemPrompt(
    input.task,
    options?.systemPromptBody ?? input.systemPrompt,
    profile.tier,
  );
  const patched = adapter?.systemPromptPatch?.(base, profile.tier ?? "mid") ?? base;
  sections.push(patched);

  // 2-4. Static context (environment + tools + task + rules)
  const staticContext = buildStaticContext({
    task: input.task,
    profile,
    availableToolSchemas: availableTools,
    requiredTools: input.requiredTools as string[] | undefined,
    environmentContext: input.environmentContext,
  });

  // 5. Adapter toolGuidance — appended immediately after the static context
  //    so the reminder sits adjacent to the tool schema block.
  const toolGuidancePatch = adapter?.toolGuidance?.({
    toolNames: availableTools.map((t) => t.name),
    requiredTools: input.requiredTools ?? [],
    tier: profile.tier ?? "mid",
    experienceSummary: undefined,
  });
  sections.push(
    toolGuidancePatch ? `${staticContext}\n${toolGuidancePatch}` : staticContext,
  );

  // 6. Tool elaboration hints (optional)
  const toolElaborationSection = options?.toolElaboration
    ? buildToolElaborationInjection(availableTools, options.toolElaboration)
    : "";
  if (toolElaborationSection) sections.push(toolElaborationSection);

  // 7. Progress section — what tools have been called successfully so far
  const progressSection = buildProgressSection(state, input);
  if (progressSection) sections.push(progressSection);

  // 8. Prior work — distilled observation facts (not raw tool results)
  const priorWorkSection = buildPriorWorkSection(state);
  if (priorWorkSection) sections.push(priorWorkSection);

  // 9. Guidance — harness signals rendered deterministically
  const guidanceSection = buildGuidanceSection(guidance);
  if (guidanceSection) sections.push(guidanceSection);

  return sections.join("\n\n");
}

// ── buildCuratedMessages ──────────────────────────────────────────────────────

/**
 * Convert the kernel message thread to LLM-native format.
 *
 * Returns all messages from `state.messages` converted to LLMMessage format.
 * Sliding window compaction is handled upstream by `applyMessageWindowWithCompact`.
 */
function buildCuratedMessages(
  state: KernelState,
  _profile: ContextProfile,
): LLMMessage[] {
  if (state.messages.length === 0) return [];

  // Convert KernelMessages to LLMMessages
  return state.messages.map(kernelMessageToLLM);
}

function kernelMessageToLLM(msg: KernelMessage): LLMMessage {
  if (msg.role === "assistant") {
    if ("toolCalls" in msg && msg.toolCalls && msg.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: [
          ...(msg.content ? [{ type: "text" as const, text: msg.content }] : []),
          ...msg.toolCalls.map((tc) => ({
            type: "tool_use" as const,
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          })),
        ],
      } as LLMMessage;
    }
    return { role: "assistant", content: msg.content };
  }
  if (msg.role === "tool_result") {
    return {
      role: "tool" as const,
      toolCallId: msg.toolCallId,
      toolName: msg.toolName,
      content: msg.content,
    } as LLMMessage;
  }
  return { role: "user", content: msg.content };
}

// ── Private builders ──────────────────────────────────────────────────────────

function buildProgressSection(state: KernelState, input: KernelInput): string {
  if (state.toolsUsed.size === 0 && state.iteration === 0) return "";

  const lines: string[] = [];

  // Iteration awareness
  const maxIter = (state.meta?.maxIterations as number | undefined) ?? 10;
  lines.push(`Iteration: ${state.iteration + 1}/${maxIter}`);

  // Tools called so far
  if (state.toolsUsed.size > 0) {
    const calledList = [...state.toolsUsed].join(", ");
    lines.push(`Tools called: ${calledList}`);
  }

  // Required tool satisfaction status
  const requiredTools = (input.requiredTools ?? []) as string[];
  if (requiredTools.length > 0) {
    const pending = requiredTools.filter((t) => !state.toolsUsed.has(t));
    if (pending.length === 0) {
      lines.push(`Required tools: all satisfied ✓`);
    } else {
      lines.push(`Required tools pending: ${pending.join(", ")}`);
    }
  }

  return `Progress:\n${lines.join("\n")}`;
}

function buildPriorWorkSection(state: KernelState): string {
  // Surface observation facts extracted from steps (not raw tool results)
  const facts: string[] = [];
  for (const step of state.steps) {
    if (step.type !== "observation") continue;
    const fact = step.metadata?.extractedFact as string | undefined;
    if (fact) facts.push(`- ${fact}`);
  }
  if (facts.length === 0) return "";
  return `Prior work:\n${facts.join("\n")}`;
}

export function buildGuidanceSection(guidance: GuidanceContext): string {
  const signals: string[] = [];

  if (guidance.requiredToolsPending.length > 0) {
    signals.push(
      `REQUIRED tools not yet called: ${guidance.requiredToolsPending.join(", ")}. Call these before giving a final answer.`,
    );
  }

  if (guidance.loopDetected) {
    signals.push(
      "Loop detected: you are repeating the same tool calls. Try a different approach or synthesize what you have.",
    );
  }

  if (guidance.icsGuidance) {
    signals.push(guidance.icsGuidance);
  }

  if (guidance.oracleGuidance) {
    signals.push(guidance.oracleGuidance);
  }

  if (guidance.errorRecovery) {
    signals.push(guidance.errorRecovery);
  }

  if (guidance.actReminder) {
    signals.push(guidance.actReminder);
  }

  if (guidance.qualityGateHint) {
    signals.push(guidance.qualityGateHint);
  }

  if (guidance.evidenceGap) {
    signals.push(
      `Your answer contains claims not supported by tool results: ${guidance.evidenceGap}. Revise using only data from the Observations above.`,
    );
  }

  if (signals.length === 0) return "";
  return `Guidance:\n${signals.map((s) => `- ${s}`).join("\n")}`;
}
