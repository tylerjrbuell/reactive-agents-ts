// File: src/context/context-curator.ts
//
// ContextCurator (Phase 1 Sprint 2 S2.5) — formalizes the per-iteration prompt
// authorship seam mandated by North Star v2.3.
//
// Why a port:
//   - Today, ContextManager.build() is a singleton object reached directly
//     from think.ts. There is nothing structural stopping a future contributor
//     from adding a *second* path to assemble system prompts (the very gap
//     G-3 / G-4 created in earlier phases).
//   - By reifying "the curator" as a typed port, we make "the prompt has a
//     single author" a property we can assert at the type level and pin in
//     a gate scenario.
//   - Slice A is intentionally a wrapper: the production curator delegates
//     to the existing ContextManager so behavior is byte-identical. The
//     trust-aware render primitive (renderObservationForPrompt) is shipped
//     here so downstream curators can wrap untrusted observation content in
//     <tool_output> blocks before inlining it into the system prompt.
//
// Lifecycle:
//   - Runs ONCE per kernel iteration, inside the think phase, before the
//     LLM stream is opened. Producing Prompt is a pure function of state +
//     input + profile + guidance + adapter (+ options).
//   - It is NOT the place for per-tool formatting decisions (those live in
//     act/tool-formatting). Per-iteration vs per-tool lifecycles are kept
//     deliberately separate so the curator's contract stays stable.

import type { LLMMessage, ProviderAdapter } from "@reactive-agents/llm-provider";
import type { KernelState, KernelInput } from "../strategies/kernel/kernel-state.js";
import type { ContextProfile } from "./context-profile.js";
import type { ToolSchema } from "../strategies/kernel/utils/tool-formatting.js";
import type { ObservationResult } from "../types/observation.js";
import type { ReasoningStep } from "../types/step.js";
import {
  ContextManager,
  type ContextManagerOptions,
  type GuidanceContext,
} from "./context-manager.js";

// ─── Prompt ────────────────────────────────────────────────────────────────────

/**
 * The complete payload the curator hands to the LLM stream call.
 *
 * Every field MUST come from a single curator invocation — think.ts may not
 * splice in additional content after the curator returns (driver instructions
 * are appended explicitly and tracked separately).
 */
export interface Prompt {
  /** System prompt body — agent identity, environment, tools, guidance. */
  readonly systemPrompt: string;
  /**
   * Conversation thread the LLM sees this turn (windowed/compacted upstream).
   *
   * NOTE: kept mutable to match LLMService.stream's signature; treat as
   * append-only — think.ts must not splice into this array after the curator
   * returns. (If a downstream pass must add a hint, it should re-run the
   * curator with updated guidance, not mutate the result.)
   */
  readonly messages: LLMMessage[];
}

// ─── CuratorOptions ────────────────────────────────────────────────────────────

/**
 * Curator-specific options. Extends ContextManagerOptions so callers can
 * still pass the underlying tool/system-prompt overrides without juggling
 * two option bags.
 *
 * S2.5 Slice B introduces `includeRecentObservations` — when set, the curator
 * authors a "Recent tool observations:" section at the tail of the system
 * prompt, rendering each step through {@link renderObservationForPrompt} so
 * untrusted tool output is wrapped in `<tool_output>` blocks before inlining.
 *
 * Default off — Slice A's byte-identical wrapping behavior is preserved when
 * the option is absent or zero.
 */
export interface CuratorOptions extends ContextManagerOptions {
  /**
   * When > 0, append a "Recent tool observations:" section showing the last
   * N observation steps (each rendered with trust-aware wrapping). When
   * absent or 0, no section is appended and the curator is byte-identical
   * to ContextManager.build (Slice A semantics).
   */
  readonly includeRecentObservations?: number;
}

// ─── ContextCurator port ───────────────────────────────────────────────────────

/**
 * The sole authority for what an LLM iteration sees.
 *
 * Production injects `defaultContextCurator`. Tests can swap in fakes to
 * verify wiring — e.g. assert the kernel never calls `llm.stream` without
 * first running the curator.
 */
export interface ContextCurator {
  curate(
    state: KernelState,
    input: KernelInput,
    profile: ContextProfile,
    guidance: GuidanceContext,
    adapter?: ProviderAdapter,
    options?: CuratorOptions,
  ): Prompt;
}

// ─── Default implementation ────────────────────────────────────────────────────

/**
 * Slice A: byte-identical wrapper over ContextManager.build (preserved
 * when `includeRecentObservations` is absent).
 *
 * Slice B (this commit): the curator OWNS one section directly — the
 * "Recent tool observations:" tail. ContextManager renders the headers /
 * body / guidance; the curator then appends the trust-aware observations
 * section. Future slices migrate more sections out of ContextManager.
 */
export const defaultContextCurator: ContextCurator = {
  curate(state, input, profile, guidance, adapter, options) {
    const out = ContextManager.build(state, input, profile, guidance, adapter, options);

    const obsSection = buildRecentObservationsSection(
      state.steps,
      options?.includeRecentObservations ?? 0,
    );

    const systemPrompt = obsSection
      ? `${out.systemPrompt}\n\n${obsSection}`
      : out.systemPrompt;

    return { systemPrompt, messages: out.messages };
  },
};

// ─── Trust-aware observation render primitive ──────────────────────────────────

/**
 * Render an ObservationResult for inline placement inside the system prompt.
 *
 * Untrusted observations (web-search results, file contents, MCP outputs,
 * arbitrary user-defined tool output) are wrapped in `<tool_output>` blocks
 * so any prompt-injection content cannot escape the role boundary and be
 * interpreted as harness instructions.
 *
 * Trusted observations (framework-internal meta-tools — see
 * KNOWN_TRUSTED_TOOL_NAMES) render plainly: their content is
 * framework-controlled and must not pay the rendering tax.
 *
 * This is the primitive future curators will call when materializing
 * a "Recent observations:" section. It is exported here (not buried in
 * context-manager) so that:
 *   - The contract is independently testable
 *   - cf-NN gate scenarios can pin the wrapping behavior
 *   - Alternate curators (compression-aware, embedding-aware) reuse it
 */
export function renderObservationForPrompt(obs: ObservationResult): string {
  if (obs.trustLevel === "trusted") {
    return obs.displayText;
  }
  // Untrusted: wrap so adversarial content can't masquerade as instructions.
  // The closing tag is a literal — even if the tool output contained
  // </tool_output>, the LLM treats the wrapping as a content boundary marker
  // rather than a privileged instruction frame.
  return `<tool_output tool="${obs.toolName}">\n${obs.displayText}\n</tool_output>`;
}

// ─── Recent observations section (Slice B) ─────────────────────────────────────

/** Section header — kept as a constant so gate scenarios can pin it. */
export const RECENT_OBSERVATIONS_HEADER = "Recent tool observations:";

/**
 * Type predicate narrowing a step to "observation step with an
 * ObservationResult attached." Keeps the pipeline below straightforwardly
 * typed (no `!` non-null assertions on metadata).
 */
function hasObservationResult(
  step: ReasoningStep,
): step is ReasoningStep & { metadata: { observationResult: ObservationResult } } {
  return step.type === "observation" && step.metadata?.observationResult !== undefined;
}

/**
 * Build the "Recent tool observations:" tail section, or null when nothing
 * to render. Pipeline: filter to observation steps with results → take last
 * `limit` → render each through the trust-aware primitive → join.
 *
 * Returning null (rather than "") lets the caller distinguish "no section"
 * from "empty section" cleanly when composing the final prompt string.
 */
export function buildRecentObservationsSection(
  steps: readonly ReasoningStep[],
  limit: number,
): string | null {
  if (limit <= 0) return null;

  const recent = steps.filter(hasObservationResult).slice(-limit);
  if (recent.length === 0) return null;

  const body = recent
    .map((s) => renderObservationForPrompt(s.metadata.observationResult))
    .join("\n\n");

  return `${RECENT_OBSERVATIONS_HEADER}\n${body}`;
}
