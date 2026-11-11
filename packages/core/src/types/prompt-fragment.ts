/**
 * Prompt-fragment contract: every piece of model-visible text the harness
 * authors (persona, rules, guidance lines, the outstanding-requirements tail,
 * exit-gate and answer-turn text, adapter hooks, built-in tool descriptions)
 * is a fragment with a stable id, a default, and a user override path.
 *
 * Why (2026-11-10 internal prompt audit, sections 6-7): many model-visible
 * texts had no override path and some were never traced. This module is the
 * shared contract only. The registry of default texts and the call sites live
 * in the packages that author the text (reasoning kernel, tools); the config
 * surface lives in runtime; the trace schema reads `PromptAssembled`.
 *
 * Modality-neutral (Plan 9 principle 8): fragments render to `TextPart[]`, so
 * a slot can join multimodal message content without a string round-trip.
 */
import type { TextPart } from "./content.js";
import { sha256Hex } from "../utils/sha256.js";

// ── Identity ──────────────────────────────────────────────────────────────────

/**
 * Stable, dotted fragment id, e.g. `"guidance.finish.no-contract"`,
 * `"tail.outstanding"`, `"exit-gate.deny"`, `"tool.web-search.description"`.
 *
 * A template-literal type, not a closed literal union and not a brand:
 * - The concrete id list belongs to the registry that owns the default text
 *   (kernel, tools). A closed union here would force a core edit per fragment
 *   and break every exhaustive switch on each addition.
 * - Tool-description ids embed user tool names, which core cannot enumerate.
 * - Ids are config keys (`withHarness({ prompts })`, JSON-persisted). A brand
 *   would force casts on every literal key; the template type still rejects
 *   undotted keys at compile time.
 *
 * Owning packages may export a narrower literal union that extends this one
 * (for example the kernel's registry ids) for autocomplete.
 */
export type PromptFragmentId = `${string}.${string}`;

/** Fragment id of a tool's wire description: `tool.<toolName>.description`. */
export type ToolDescriptionFragmentId = `tool.${string}.description`;

/**
 * Where a fragment lands in the request:
 * - `system`: the cached system-prompt prefix.
 * - `tail`: the per-turn message tail after the last cache breakpoint.
 * - `guidance`: one line of the rendered `Guidance:` block.
 * - `tool-result`: text the harness adds to a tool result (recovery suffix, adapter hook).
 * - `tool-description`: a tool's wire description.
 */
export type PromptFragmentSlot = "system" | "tail" | "guidance" | "tool-result" | "tool-description";

/**
 * A render input. JSON-safe so the vars can ride the trace and the
 * `prompt.fragment` compose context unchanged.
 */
export type PromptFragmentVar = string | number | boolean | null | ReadonlyArray<string | number>;

/** Render inputs, keyed by name. Empty object for a fragment with no vars. */
export type PromptFragmentVars = Readonly<Record<string, PromptFragmentVar>>;

// ── Definition (registry entry) ──────────────────────────────────────────────

/**
 * One registry entry: the harness default for a fragment. Defined by the
 * package that authors the text; core never holds default prose.
 *
 * @typeParam V The vars this fragment renders from.
 */
export interface PromptFragmentDefinition<V extends PromptFragmentVars = PromptFragmentVars> {
  /** Stable id. Never renamed once shipped: it is a public config key. */
  readonly id: PromptFragmentId;
  /** Where the rendered text lands in the request. */
  readonly slot: PromptFragmentSlot;
  /**
   * Package (and module, when useful) that owns the default text, e.g.
   * `"@reactive-agents/reasoning"`. Used for docs generation and attribution.
   */
  readonly owner: string;
  /** One-line, user-facing statement of what the fragment tells the model and when. */
  readonly summary: string;
  /** Render the default content. Pure and deterministic: same vars, same parts. */
  readonly render: (vars: V) => ReadonlyArray<TextPart>;
}

// ── Overrides ────────────────────────────────────────────────────────────────

/**
 * Context handed to a {@link PromptFragmentTransform}. The default text is
 * included so a user can inspect what the harness would have sent. This is
 * also the fragment-specific part of the planned `prompt.fragment` compose
 * tag's ctx.
 */
export interface PromptFragmentCtx {
  /** Fragment being rendered. */
  readonly id: PromptFragmentId;
  /** Where it lands. */
  readonly slot: PromptFragmentSlot;
  /** Vars the default rendered from. */
  readonly vars: PromptFragmentVars;
  /** Default rendered content, text parts joined with `""`. */
  readonly defaultText: string;
}

/**
 * Programmatic override. Return a string to replace the text, `null` to
 * disable the fragment, `undefined` to keep the default. Synchronous: prompt
 * assembly does not await user code (use `.compose()` hooks for async work).
 * A throw keeps the default and is reported on
 * {@link ResolvedPromptFragment.overrideError}.
 */
export type PromptFragmentTransform = (ctx: PromptFragmentCtx) => string | null | undefined;

/**
 * JSON-serialisable override: a string replaces the default verbatim (no var
 * interpolation; use a transform for var-dependent text), `null` disables it.
 */
export type PromptFragmentOverrideValue = string | null;

/** Any override: a serialisable value or a transform. */
export type PromptFragmentOverride = PromptFragmentOverrideValue | PromptFragmentTransform;

/**
 * Overrides keyed by fragment id. Ids absent from the map render their default.
 * Ids that match no registered fragment are ignored by resolution; the config
 * surface should warn on them.
 */
export type PromptOverrides = Readonly<Partial<Record<PromptFragmentId, PromptFragmentOverride>>>;

/**
 * The JSON-serialisable subset of {@link PromptOverrides}, for persisted
 * agent config (`withHarness({ prompts })`). Transforms go through code only.
 */
export type SerializablePromptOverrides = Readonly<Partial<Record<PromptFragmentId, PromptFragmentOverrideValue>>>;

// ── Resolution ───────────────────────────────────────────────────────────────

/**
 * Outcome of resolving one fragment:
 * - `default`: no override applied (none set, or a transform returned `undefined` or threw).
 * - `overridden`: an override replaced the text.
 * - `disabled`: an override removed the fragment; nothing is sent.
 */
export type PromptFragmentStatus = "default" | "overridden" | "disabled";

/** A fragment after overrides: what the model is sent, plus what it would have been. */
export interface ResolvedPromptFragment {
  /** Fragment id. */
  readonly id: PromptFragmentId;
  /** Where it lands. */
  readonly slot: PromptFragmentSlot;
  /** Owning package of the default (from the definition). */
  readonly owner: string;
  /** Resolution outcome. */
  readonly status: PromptFragmentStatus;
  /** Content to send. Empty when `status` is `"disabled"`. */
  readonly content: ReadonlyArray<TextPart>;
  /** Default content, always present so it stays inspectable. */
  readonly defaultContent: ReadonlyArray<TextPart>;
  /**
   * Message of the error a transform threw. Absent when no transform threw.
   * The default is kept; the caller should publish `ErrorSwallowed`.
   */
  readonly overrideError?: string;
}

/** Text of a content array, parts joined with `""`. */
export const promptFragmentText = (content: ReadonlyArray<TextPart>): string =>
  content.map((p) => p.text).join("");

/**
 * Canonical fragment hash: SHA-256 hex of {@link promptFragmentText}. One
 * definition so kernel and tools hashes compare across runs and packages.
 */
export const promptFragmentHash = (content: ReadonlyArray<TextPart>): string =>
  sha256Hex(promptFragmentText(content));

/** Message of a thrown value: its string `message` field when present, else `String(value)`. */
const thrownMessage = (thrown: unknown): string =>
  typeof thrown === "object" && thrown !== null && "message" in thrown && typeof thrown.message === "string"
    ? thrown.message
    : String(thrown);

const textContent = (text: string): ReadonlyArray<TextPart> => [{ type: "text", text }];

/**
 * Apply `overrides` to one fragment. Pure apart from calling a user
 * transform; never throws.
 */
export const resolvePromptFragment = <V extends PromptFragmentVars>(
  definition: PromptFragmentDefinition<V>,
  vars: V,
  overrides: PromptOverrides | undefined,
): ResolvedPromptFragment => {
  const defaultContent = definition.render(vars);
  const base = { id: definition.id, slot: definition.slot, owner: definition.owner, defaultContent };
  const keep: ResolvedPromptFragment = { ...base, status: "default", content: defaultContent };
  const override = overrides?.[definition.id];
  if (override === undefined) return keep;
  let value: string | null | undefined;
  if (typeof override === "function") {
    try {
      value = override({ id: definition.id, slot: definition.slot, vars, defaultText: promptFragmentText(defaultContent) });
    } catch (err) {
      return { ...keep, overrideError: thrownMessage(err) };
    }
  } else {
    value = override;
  }
  if (value === undefined) return keep;
  if (value === null) return { ...base, status: "disabled", content: [] };
  return { ...base, status: "overridden", content: textContent(value) };
};
