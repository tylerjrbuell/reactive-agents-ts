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
    options?: ContextManagerOptions,
  ): Prompt;
}

// ─── Default implementation ────────────────────────────────────────────────────

/**
 * Slice A: thin wrapper over ContextManager.build so the seam is observable
 * without changing rendering. Future slices migrate sectional concerns
 * (Prior work, Progress, tool elaboration) inside the curator boundary.
 */
export const defaultContextCurator: ContextCurator = {
  curate(state, input, profile, guidance, adapter, options) {
    const out = ContextManager.build(state, input, profile, guidance, adapter, options);
    return { systemPrompt: out.systemPrompt, messages: out.messages };
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
