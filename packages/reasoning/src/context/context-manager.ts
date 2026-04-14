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

import type { LLMMessage } from "@reactive-agents/llm-provider";
import type { KernelState, KernelInput } from "../strategies/kernel/kernel-state.js";
import type { ContextProfile } from "./context-profile.js";
import { buildStaticContext, buildEnvironmentContext } from "./context-engine.js";
import type { KernelMessage } from "../strategies/kernel/kernel-state.js";

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
}

/** Output of ContextManager.build() — the only two things the LLM sees. */
export interface ContextManagerOutput {
  /** The complete system prompt for this iteration. */
  readonly systemPrompt: string;
  /** The curated conversation message thread for this iteration. */
  readonly messages: LLMMessage[];
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
  ): ContextManagerOutput {
    const systemPrompt = buildIterationSystemPrompt(state, input, profile, guidance);
    const messages = buildCuratedMessages(state, profile);
    return { systemPrompt, messages };
  },
};

// ── buildIterationSystemPrompt ────────────────────────────────────────────────

/**
 * Assemble the system prompt for a single kernel iteration.
 *
 * Sections (in order):
 *   1. Agent identity (lean, tier-adaptive)
 *   2. Environment context (date, time, timezone, platform)
 *   3. Task description
 *   4. Available tools + rules
 *   5. Progress: (tool usage summary — what has been called)
 *   6. Prior work: (distilled observation facts if any)
 *   7. Guidance: (harness signals — required tools, loops, ICS, errors)
 */
function buildIterationSystemPrompt(
  state: KernelState,
  input: KernelInput,
  profile: ContextProfile,
  guidance: GuidanceContext,
): string {
  const sections: string[] = [];

  // 1. Agent identity
  sections.push(buildIdentity(profile.tier));

  // 2-4. Static context (environment + tools + task + rules)
  sections.push(
    buildStaticContext({
      task: input.task,
      profile,
      availableToolSchemas: input.availableToolSchemas as any,
      requiredTools: input.requiredTools as string[] | undefined,
      environmentContext: input.environmentContext,
    }),
  );

  // 5. Progress section — what tools have been called successfully so far
  const progressSection = buildProgressSection(state, input);
  if (progressSection) sections.push(progressSection);

  // 6. Prior work — distilled observation facts (not raw tool results)
  const priorWorkSection = buildPriorWorkSection(state);
  if (priorWorkSection) sections.push(priorWorkSection);

  // 7. Guidance — harness signals rendered deterministically
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

function buildIdentity(tier: string): string {
  if (tier === "local") {
    return "You are a helpful assistant. Use the provided tools when needed to complete tasks.";
  }
  if (tier === "frontier" || tier === "large") {
    return "You are an expert reasoning agent. Think step by step. Use tools precisely and efficiently. Prefer concise, direct answers once you have sufficient information. When actions are independent, issue multiple tool calls in the same response — they execute in parallel.";
  }
  return "You are a reasoning agent. Think step by step and use available tools when needed. When actions are independent, issue multiple tool calls in the same response — they execute in parallel.";
}

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

  if (signals.length === 0) return "";
  return `Guidance:\n${signals.map((s) => `- ${s}`).join("\n")}`;
}
