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
import type { KernelState, KernelInput } from "../kernel/state/kernel-state.js";
import type { ContextProfile } from "./context-profile.js";
import type { KernelMessage } from "../kernel/state/kernel-state.js";
import type { ToolSchema } from "../kernel/capabilities/attend/tool-formatting.js";
import {
  buildConversationMessages,
} from "../kernel/capabilities/attend/context-utils.js";
import {
  type ToolElaborationInjectionConfig,
} from "../kernel/capabilities/act/tool-gating.js";
import { classifyTask } from "../kernel/capabilities/comprehend/task-classification.js";
import { composePrompt } from "./prompt-composer.js";
import {
  DEFAULT_SECTIONS,
  buildGuidanceText,
} from "./prompt-sections-default.js";

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
  /** Custom nudge text produced by a harness nudge.loop-detected transform. Overrides the default when set. */
  readonly loopDetectedMessage?: string;
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
 *   2. priorContext (optional) — cross-run memory from ExecutionEngine / strategies
 *   3. Environment context (date, time, timezone, platform)
 *   4. Task description
 *   5. Available tools + rules
 *   6. Adapter toolGuidance (inline reminder after schema block)
 *   7. Tool elaboration hints (opt-in via options.toolElaboration)
 *   8. Progress: (tool usage summary — what has been called)
 *   9. Prior work: (distilled observation facts if any)
 *   10. Guidance: (harness signals — required tools, loops, ICS, errors)
 */
function buildIterationSystemPrompt(
  state: KernelState,
  input: KernelInput,
  profile: ContextProfile,
  guidance: GuidanceContext,
  adapter?: ProviderAdapter,
  options?: ContextManagerOptions,
): string {
  // ── EXPERIMENT: minimal-signal prompt ─────────────────────────────────────
  // RA_MINIMAL_PROMPT=1 — bypasses APC entirely. Empirical APC-0 (2026-05-27)
  // discriminator established that this global mode regresses quality on
  // tool/multi-step tasks (+136% tokens, -1 quality). Kept as a manual
  // escape hatch for diagnostics; APC's shape-gated mode (APC-4) is the
  // production path that captures the same lever safely.
  if (process.env.RA_MINIMAL_PROMPT === "1") {
    const availableTools: readonly ToolSchema[] =
      options?.availableTools ??
      ((input.availableToolSchemas ?? []) as readonly ToolSchema[]);
    const minimal: string[] = [];
    if (availableTools.length > 0) {
      const compact = availableTools
        .map((t) => {
          const params = (t.parameters ?? [])
            .map((p) => `${p.name}: ${p.type}${p.required ? "" : "?"}`)
            .join(", ");
          return `- ${t.name}(${params})`;
        })
        .join("\n");
      minimal.push(`Tools:\n${compact}`);
    }
    if (input.priorContext?.trim()) {
      minimal.push(input.priorContext.trim());
    }
    minimal.push(`Task: ${input.task}`);
    const guidanceLine = buildShortGuidanceReminder(guidance);
    if (guidanceLine) minimal.push(guidanceLine);
    return minimal.join("\n\n");
  }

  // ── APC-3: Delegate to PromptComposer in parity mode ─────────────────────
  // Sections registered in `DEFAULT_SECTIONS` mirror the prior monolithic
  // build order. `shapeGated: false` (parity) means every section's render
  // runs regardless of predicate — byte-identical to legacy behavior.
  //
  // APC-4 will flip `shapeGated: true` after per-section predicates are
  // tightened with empirical evidence (APC-0 data shows this is only safe
  // on trivial-shape tasks; tool/multi-step shapes must keep full scaffold).
  // KernelInput doesn't currently carry taskClassification — classify in
  // place. Pure regex/keyword pass, cheap. APC-4 may thread the upstream
  // snapshot once strategy entries are wired to seed it on KernelInput.
  const shape = classifyTask(input.task).shape;
  const result = composePrompt(
    DEFAULT_SECTIONS,
    {
      state,
      input,
      profile,
      guidance,
      shape,
      adapter,
      options: options as Record<string, unknown> | undefined,
    },
    { shapeGated: false },
  );
  return result.text;
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

/**
 * Back-compat alias — buildGuidanceText returns `string | null`; this wraps
 * the null case to an empty string to preserve the pre-APC signature.
 */
export function buildGuidanceSection(guidance: GuidanceContext): string {
  return buildGuidanceText(guidance) ?? "";
}
