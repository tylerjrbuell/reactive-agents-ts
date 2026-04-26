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
import type { KernelState, KernelInput } from "../kernel/state/kernel-state.js";
import type { ContextProfile } from "./context-profile.js";
import type { ToolSchema } from "../kernel/capabilities/attend/tool-formatting.js";
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

    // Sprint 3.4 (G-4 closure) — Curator owns compression decisions.
    // Pass scratchpad + per-tier budget so the section can render FULL
    // tool content (looked up via storedKey) instead of forcing the model
    // to navigate "[STORED:]" markers via recall(). Per-observation cap
    // prevents context-budget blowup; recall() stays as ad-hoc retrieval
    // for older observations not surfaced by curator.
    // Lazy mode (default) skips the curator's recent-observations section.
    // The conversation thread already carries the tool result via
    // tool_result messages — the section is duplicate signal that primes
    // structurally-weird outputs on local models. Opt out via
    // RA_LAZY_TOOLS=0 to restore the section.
    const lazyMode = process.env.RA_LAZY_TOOLS !== "0";
    const obsSection = lazyMode
      ? null
      : buildRecentObservationsSection(
          state.steps,
          options?.includeRecentObservations ?? 0,
          {
            scratchpad: state.scratchpad,
            maxCharsPerObservation: profile.toolResultMaxChars,
          },
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
export function renderObservationForPrompt(
  obs: ObservationResult,
  /**
   * Sprint 3.4 (G-4) — when provided, render this content instead of
   * obs.displayText. Used by buildRecentObservationsSection to substitute
   * full scratchpad-stored content for the compressed-preview displayText
   * that tool-execution writes for context-budget reasons.
   */
  contentOverride?: string,
): string {
  const content = contentOverride ?? obs.displayText;
  if (obs.trustLevel === "trusted") {
    return content;
  }
  // Untrusted: wrap so adversarial content can't masquerade as instructions.
  // The closing tag is a literal — even if the tool output contained
  // </tool_output>, the LLM treats the wrapping as a content boundary marker
  // rather than a privileged instruction frame.
  return `<tool_output tool="${obs.toolName}">\n${content}\n</tool_output>`;
}

/**
 * Sprint 3.4 (G-4) — pick the BEST content to render for an observation.
 * Looks up full content from scratchpad when the observation has a
 * storedKey; falls back to the (possibly compressed) displayText. Caps to
 * `maxChars` and adds a truncation marker if exceeded.
 *
 * This is the core mechanism by which the curator owns compression
 * decisions: tool-execution stores the full content; the curator decides
 * what to surface per iteration based on profile budget.
 */
function selectObservationContent(
  obs: ObservationResult,
  step: ReasoningStep,
  scratchpad: ReadonlyMap<string, string> | undefined,
  maxChars: number,
): string {
  const storedKey = step.metadata?.storedKey as string | undefined;
  const fullFromScratchpad =
    storedKey && scratchpad ? scratchpad.get(storedKey) : undefined;
  const candidate = fullFromScratchpad ?? obs.displayText;
  if (candidate.length <= maxChars) return candidate;
  // Truncate and signal the model that more is available via recall.
  const head = candidate.slice(0, maxChars);
  const recallHint = storedKey
    ? `\n  ...truncated (${candidate.length - maxChars} chars). Full content available via recall("${storedKey}").`
    : `\n  ...truncated (${candidate.length - maxChars} chars).`;
  return head + recallHint;
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
export interface RecentObservationsOptions {
  /**
   * Sprint 3.4 (G-4) — scratchpad map for full-content lookup. Tool-execution
   * stores complete tool output here keyed by storedKey; the curator looks up
   * the full content and renders it (capped) instead of the compressed-preview
   * displayText. When omitted, falls back to displayText.
   */
  readonly scratchpad?: ReadonlyMap<string, string>;
  /**
   * Per-observation character cap. Defaults to 2000 if omitted. The
   * defaultContextCurator passes profile.toolResultMaxChars (tier-aware:
   * local=2000, mid=1200, large=800, frontier=600).
   */
  readonly maxCharsPerObservation?: number;
}

export function buildRecentObservationsSection(
  steps: readonly ReasoningStep[],
  limit: number,
  options?: RecentObservationsOptions,
): string | null {
  if (limit <= 0) return null;

  const recent = steps.filter(hasObservationResult).slice(-limit);
  if (recent.length === 0) return null;

  const maxChars = options?.maxCharsPerObservation ?? 2000;
  const scratchpad = options?.scratchpad;

  const body = recent
    .map((s) => {
      // Sprint 3.4 (G-4) — pull full content from scratchpad when storedKey
      // is present + cap to per-tier budget. The model sees real data, not
      // a compression marker pointing it at recall().
      const content = selectObservationContent(
        s.metadata.observationResult,
        s,
        scratchpad,
        maxChars,
      );
      return renderObservationForPrompt(s.metadata.observationResult, content);
    })
    .join("\n\n");

  return `${RECENT_OBSERVATIONS_HEADER}\n${body}`;
}
