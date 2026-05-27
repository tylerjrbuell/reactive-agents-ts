/**
 * prompt-composer.ts — Adaptive Prompt Composer (APC-2 substrate).
 *
 * Composable replacement for the monolithic `buildIterationSystemPrompt` in
 * context-manager.ts. Each prompt section registers with:
 *   - `id`                — stable identifier (for telemetry + audit)
 *   - `requiredWhen`      — predicate over TaskShape; gates the section
 *   - `render`            — pure function building the section string
 *   - `costTokensApprox`  — self-reported budget (for cost auditing)
 *
 * The composer iterates sections in order, calling `render` and joining
 * non-empty results with double newlines.
 *
 * Two modes:
 *   - `shapeGated: false` (DEFAULT, APC-3 parity)
 *       Every section's render is called regardless of predicate.
 *       Result is byte-identical to today's monolithic builder when
 *       sections are registered in the same order.
 *
 *   - `shapeGated: true`  (APC-4 evidence-driven)
 *       Predicates evaluated; sections with `requiredWhen(shape) === false`
 *       are omitted entirely. This is the lever that closes the trivial-task
 *       token gap (APC-0 evidence: -14 to -25% on trivial subset).
 *
 * Architectural mirror of CapabilityRegistry (MOVE-2): sections are
 * load-bearing data, not magic. `auditPromptSections()` exposes the
 * registered set + their predicates + cost signatures for runtime
 * inspection.
 *
 * Reference:
 *   - APC-0: wiki/Research/Ablations/2026-05-27-apc-0-minimal-prompt-discriminator.md
 *   - Mirrors: packages/runtime/src/capabilities/registry.ts (MOVE-2)
 */
import type { LLMMessage, ProviderAdapter } from "@reactive-agents/llm-provider";
import type { KernelInput, KernelState } from "../kernel/state/kernel-state.js";
import type { TaskShape } from "../kernel/capabilities/comprehend/task-shape.js";
import type { ContextProfile } from "./context-profile.js";
import type { GuidanceContext } from "./context-manager.js";

// ── PromptSectionContext — inputs to render ───────────────────────────────────

/**
 * Everything a prompt section may consult to produce its content.
 * Sections MUST be pure functions of this context — no I/O, no Effect.
 */
export interface PromptSectionContext {
  readonly state: KernelState;
  readonly input: KernelInput;
  readonly profile: ContextProfile;
  readonly guidance: GuidanceContext;
  /**
   * Pre-execution task shape. Snapshot from `classifyTask(task).shape`,
   * threaded through KernelInput or computed once at iter 0.
   */
  readonly shape: TaskShape;
  readonly adapter?: ProviderAdapter;
  /** Free-form options bag mirroring ContextManagerOptions for compatibility. */
  readonly options?: Record<string, unknown>;
}

// ── PromptSection — registered prompt fragment ────────────────────────────────

export interface PromptSection {
  /** Stable identifier — e.g. "identity", "static-context", "guidance". */
  readonly id: string;
  /** Short human-readable description for audit output. */
  readonly description: string;
  /**
   * Predicate over TaskShape. Returns true when the section should be
   * included; false when it can be safely omitted under the given shape.
   *
   * Composer respects this ONLY when called with `shapeGated: true`.
   * The default render-all mode treats every section as required.
   *
   * Conservative-default rule: when in doubt, return true. Stripping a
   * section that's load-bearing regresses quality (APC-0 evidence).
   */
  readonly requiredWhen: (shape: TaskShape) => boolean;
  /**
   * Pure function producing the section's text. Returning `null` or an
   * empty string is equivalent to omitting the section — useful for
   * conditional content (e.g., "Prior work" is empty when no observations
   * exist).
   */
  readonly render: (ctx: PromptSectionContext) => string | null;
  /**
   * Approximate token cost when section is included. Used by
   * `auditPromptSections()` for cost transparency. Should be a rough
   * upper bound at typical density — not a hard limit.
   */
  readonly costTokensApprox: number;
}

// ── Composer ─────────────────────────────────────────────────────────────────

export interface ComposeOptions {
  /**
   * When true, omit any section whose `requiredWhen(ctx.shape)` returns
   * false. When false (DEFAULT), every section is rendered regardless
   * of its predicate — byte-identical-parity mode for APC-3.
   */
  readonly shapeGated?: boolean;
}

export interface ComposeResult {
  /** The composed system prompt body. */
  readonly text: string;
  /** Ordered list of section ids that contributed non-empty content. */
  readonly includedSections: readonly string[];
  /** Ordered list of section ids that were OMITTED. */
  readonly omittedSections: readonly string[];
  /** Sum of `costTokensApprox` over included sections. */
  readonly approxTokens: number;
}

/**
 * Compose a system prompt from a registered section list + a context.
 *
 * Sections are rendered in registry order, joined with `\n\n`. Empty/null
 * renders are skipped. Returns telemetry about what was/wasn't included
 * so the caller can publish audit events.
 */
export function composePrompt(
  sections: readonly PromptSection[],
  ctx: PromptSectionContext,
  opts: ComposeOptions = {},
): ComposeResult {
  const shapeGated = opts.shapeGated ?? false;
  const parts: string[] = [];
  const included: string[] = [];
  const omitted: string[] = [];
  let approxTokens = 0;

  for (const section of sections) {
    if (shapeGated && !section.requiredWhen(ctx.shape)) {
      omitted.push(section.id);
      continue;
    }
    const rendered = section.render(ctx);
    if (rendered === null || rendered.length === 0) {
      omitted.push(section.id);
      continue;
    }
    parts.push(rendered);
    included.push(section.id);
    approxTokens += section.costTokensApprox;
  }

  return {
    text: parts.join("\n\n"),
    includedSections: included,
    omittedSections: omitted,
    approxTokens,
  };
}

// ── PromptSectionRegistry — mutable ordered registry ──────────────────────────

/**
 * Mutable registry of PromptSections. Mirrors the role of
 * CapabilityRegistry: declarative, auditable, single source of truth.
 *
 * Sections are stored in registration order — this IS the composition
 * order. Callers may also pass an explicit list to `composePrompt`
 * directly without using the registry.
 */
export class PromptSectionRegistry {
  private readonly sections: PromptSection[] = [];

  /** Register a section at the end of the composition order. */
  register(section: PromptSection): this {
    if (this.sections.some((s) => s.id === section.id)) {
      throw new Error(
        `PromptSectionRegistry: section "${section.id}" is already registered`,
      );
    }
    this.sections.push(section);
    return this;
  }

  /** Return the registered sections in composition order. */
  list(): readonly PromptSection[] {
    return [...this.sections];
  }

  /** Lookup by id. Returns undefined if not registered. */
  get(id: string): PromptSection | undefined {
    return this.sections.find((s) => s.id === id);
  }

  /** Number of registered sections. */
  get size(): number {
    return this.sections.length;
  }

  /** Reset the registry. Used by tests; production should never call. */
  clear(): void {
    this.sections.length = 0;
  }
}

// ── Audit surface ────────────────────────────────────────────────────────────

export interface PromptSectionAuditEntry {
  readonly id: string;
  readonly description: string;
  readonly costTokensApprox: number;
}

/** Summarize a registry for transparency / audit output. */
export function auditPromptSections(
  registry: PromptSectionRegistry,
): readonly PromptSectionAuditEntry[] {
  return registry.list().map((s) => ({
    id: s.id,
    description: s.description,
    costTokensApprox: s.costTokensApprox,
  }));
}

// ── Default registry — populated in APC-3 ─────────────────────────────────────

/**
 * The default empty registry. APC-3 registers the 9 sections from
 * `buildIterationSystemPrompt` here so the composer ships byte-identical
 * to today's monolithic builder when called with `shapeGated: false`.
 *
 * Empty in APC-2 — substrate-only commit. Consumers must populate before
 * calling `composePrompt(defaultPromptSectionRegistry.list(), ...)`.
 */
export const defaultPromptSectionRegistry = new PromptSectionRegistry();

// Re-export to satisfy import alias patterns used elsewhere.
export type { LLMMessage };
