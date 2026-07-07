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
  type CompressionAppliedSidecar,
} from "../kernel/capabilities/attend/context-utils.js";
import {
  type ToolElaborationInjectionConfig,
} from "../kernel/capabilities/decide/tool-gating.js";
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
import type { GuidanceContext } from "./guidance.js";
export type { GuidanceContext };

/** Output of ContextManager.build() — the only two things the LLM sees. */
export interface ContextManagerOutput {
  /** The complete system prompt for this iteration. */
  readonly systemPrompt: string;
  /** The curated conversation message thread for this iteration. */
  readonly messages: LLMMessage[];
  /**
   * Sidecar present when a fresh CompressionRecommendation was consumed by
   * the curator on this build. Carries the data the Effect-context-capable
   * caller (think.ts) needs to publish the typed `CompressionApplied` event
   * via EventBus. Issue #119 closure (WS-4 Phase 7).
   */
  readonly compressionApplied?: CompressionAppliedSidecar;
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
    let compressionApplied: CompressionAppliedSidecar | undefined;
    if (adapter) {
      const result = buildConversationMessages(state, input, profile, adapter);
      messages = result.messages;
      compressionApplied = result.compressionApplied;
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

    return compressionApplied
      ? { systemPrompt, messages, compressionApplied }
      : { systemPrompt, messages };
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

  // ── APC-4: Shape-gated composition ───────────────────────────────────────
  // Each section's `requiredWhen(shape)` predicate is consulted.
  // Per-section behavior (see prompt-sections-default.ts):
  //   - identity            always rendered
  //   - prior-context       always (self-conditional on input.priorContext)
  //   - static-context      STRIPPED on high-confidence-trivial shape
  //                         (APC-0 evidence: -14 to -25% trivial tokens)
  //   - tool-elaboration    only when shape.needsTools
  //   - progress            always (self-conditional on iter/tools)
  //   - prior-work          always (self-conditional on observation facts)
  //   - guidance            STRIPPED on high-confidence-trivial shape
  //
  // Tool / multi-step / citation shapes keep ALL sections — APC-0 proved
  // stripping scaffold there blew up output by +42% to +136% and regressed
  // quality. The conservative-default contract guarantees parity for any
  // shape that doesn't lock in as high-confidence-trivial.
  //
  // KernelInput doesn't currently carry taskClassification — classify in
  // place. Pure regex/keyword pass, cheap. Future: thread snapshot from
  // strategy entry to avoid re-classification.
  const shapeBase = classifyTask(input.task).shape;
  // Tool-availability override: if the agent has ANY tools available, the
  // task is implicitly tool-capable regardless of what text cues say.
  // Stripping scaffold on a tools-present task hides schemas from the
  // model, causing tool calls to fail blindly. APC-0 evidence is scoped
  // to tool-LESS trivial tasks (k1/k3/f2 in bench); preserving scaffold
  // for tools-present tasks captures the lift without that quality risk.
  const toolsPresent = (input.availableToolSchemas ?? []).length > 0;
  // Caller-supplied environment context (env vars, custom fields) MUST
  // reach the LLM — it's an explicit signal that env state is task-
  // relevant. Force scaffold keep when present, even on trivial tasks.
  const envPresent =
    input.environmentContext !== undefined &&
    Object.keys(input.environmentContext as Record<string, unknown>).length > 0;
  const needsScaffold = toolsPresent || envPresent;
  const shape = needsScaffold && !shapeBase.needsTools
    ? {
        ...shapeBase,
        needsTools: true,
        reason: `${shapeBase.reason}/scaffold-override${toolsPresent ? ":tools" : ""}${envPresent ? ":env" : ""}`,
      }
    : shapeBase;
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
    { shapeGated: true },
  );
  // Resolution: APC composer (HEAD) is the canonical author. Lever 2's
  // iter-1+ skip logic for priorContext + adapter-toolGuidance + tool
  // elaboration is ported into the section render functions
  // (prompt-sections-default.ts). Static-context still rendered every iter
  // per Lever 2's empirical finding (m2 +28% when dropped mid-loop on
  // local-tier). APC-4's trivial-shape strip remains the only static-context
  // omission path.
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
