/**
 * kernel/state/guidance-channel.ts — the ONE guidance channel (Plan 9 Phase 4,
 * stage 3: `wiki/Planning/Implementation-Plans/2026-11-04-architecture-convergence-program.md`).
 *
 * Harness guidance (required-tools pressure, loop nudge, ICS / oracle steers,
 * error recovery, act reminders, quality-gate hints, evidence gaps, gather
 * dedup, triage steer, environment notice, todo reminder) used to be ad-hoc
 * `PendingGuidance` field writes, rendered by three separate string builders
 * (`buildGuidanceText` + `appendEnvironmentUpdate` + `appendChecklistReminder`)
 * plus a hand-copied field list in think.ts. This module is now the single
 * home for all of it:
 *
 *  - the record   : {@link PendingGuidance} (one optional field per kind);
 *  - the currency : {@link GuidanceSignal} (a tagged union over the kinds);
 *  - producers    : {@link guidanceOf} / {@link contributeGuidance} /
 *                   {@link appendGuidanceText} / {@link textSignal};
 *  - the renderer : {@link renderGuidance} (one ordered rule table) and
 *                   {@link guidanceBlockParts} (the `Guidance:` block format,
 *                   as text parts; think.ts joins them);
 *  - accounting   : {@link guidanceTurnCost} (deterministic per-turn token
 *                   estimate, recorded on `KernelMeta.guidanceCost`; measured,
 *                   NOT enforced — enforcement is the lift-gated T4 item).
 *
 * Byte contract: the rendered text and line order are exactly what the three
 * old builders produced (equivalence-gated by the replay goldens and by
 * `tests/kernel/guidance-channel.test.ts`, which carries the frozen legacy
 * renderer as its oracle). Deterministic (golden rule 5): no LLM, no clock.
 */
import { Effect } from "effect";
import { estimateTokenCount } from "@reactive-agents/llm-provider";
import type { TextPart } from "@reactive-agents/core";
import type { PendingSignalRef } from "./signal-ledger.js";

// ── The record ───────────────────────────────────────────────────────────────

/**
 * Typed harness signals collected during act/guard phases for the next think
 * turn. Rendered by {@link renderGuidance} into the `Guidance:` block (a
 * trailing request-only user message, see think.ts). Every field is optional;
 * producers set only what applies, through the producer API below.
 */
export interface PendingGuidance {
  /** Required tool names flagged by a quota-violation escalation (not normal pending state). */
  readonly requiredToolsPending?: readonly string[];
  /** True when loop detection fired and the agent is repeating without progress. */
  readonly loopDetected?: boolean;
  /** Guidance produced by the ICS coordinator (synthesis/strategy signals). */
  readonly icsGuidance?: string;
  /** Guidance from the oracle / quality gate (e.g. readyToAnswer nudge). */
  readonly oracleGuidance?: string;
  /**
   * The model's last call did not run: it named a tool off its surface, or its
   * call text for a known tool could not be parsed (the resolver's reparse
   * hint). Produced only by `lastCallNotRunHint` / `unavailableToolHint`
   * (reason/unavailable-tool-hint.ts). A FACT about the previous turn, not a
   * steer: its own kind, so a writer of `errorRecovery` cannot replace it.
   */
  readonly toolUnavailable?: string;
  /** Recovery hint when tool failures or errors occurred on the previous round. */
  readonly errorRecovery?: string;
  /** Post-act harness reminder (e.g. "you must still call X", "required tools satisfied"). */
  readonly actReminder?: string;
  /** Adapter quality-check hint rendered before accepting a prose final answer. */
  readonly qualityGateHint?: string;
  /** Evidence grounding redirect when claims lack tool support. */
  readonly evidenceGap?: string;
  /** Advisory gather-dedup nudge (C3) — a repeated (tool, args) gather was
   *  detected; hands back the existing recallable ref instead of re-fetching. */
  readonly gatherDedup?: string;
  /** E3 triage pace-action steer — names the OUTSTANDING requirements when the
   *  run enters the triage band (burnRatio ≥ 0.80). Set only under the
   *  long-horizon profile; absent → byte-identical. */
  readonly triageSteer?: string;
  /** One-shot between-turn environment notice (reflect/environment-update.ts). */
  readonly environmentUpdate?: string;
  /** Opt-in todo reminder (V5 M3-midrun, reflect/checklist-reminder.ts). */
  readonly checklistReminder?: string;
  /** Pending signal refs riding alongside the fields above (2026-10-25). */
  readonly pendingSignals?: readonly PendingSignalRef[];
}

/** Every guidance kind: one per renderable `PendingGuidance` field. */
export type GuidanceKind = Exclude<keyof PendingGuidance, "pendingSignals">;
/** Kinds whose payload is a single text line. */
export type GuidanceTextKind = Exclude<GuidanceKind, "requiredToolsPending" | "loopDetected">;

// ── The currency ─────────────────────────────────────────────────────────────

/** One guidance contribution. The union is closed over {@link GuidanceKind}. */
export type GuidanceSignal =
  | { readonly kind: "requiredToolsPending"; readonly tools: readonly string[] }
  | { readonly kind: "loopDetected"; readonly detected: boolean }
  | { readonly kind: GuidanceTextKind; readonly text: string };

/** A text signal, or none when `text` is absent/empty (compose with spread). */
export function textSignal(kind: GuidanceTextKind, text: string | undefined | null | false): readonly GuidanceSignal[] {
  return text ? [{ kind, text }] : [];
}

// ── Producers ────────────────────────────────────────────────────────────────

type MutableGuidance = { -readonly [K in keyof PendingGuidance]: PendingGuidance[K] };

function foldSignals(into: MutableGuidance, signals: readonly GuidanceSignal[]): MutableGuidance {
  for (const s of signals) {
    if (s.kind === "requiredToolsPending") into.requiredToolsPending = s.tools;
    else if (s.kind === "loopDetected") into.loopDetected = s.detected;
    else into[s.kind] = s.text;
  }
  return into;
}

/**
 * A fresh guidance record from `signals`. Later signals of the same kind win.
 * `refs`, when given, become `pendingSignals`. A VALUE builder only: never
 * assign it to `state.pendingGuidance` (it would drop every other pending
 * kind). State writes merge by kind through {@link contributeGuidance} /
 * {@link appendGuidanceText}; only think.ts, the consumer, clears the record
 * (drift pin: tests/kernel/seam-guidance-channel.test.ts).
 */
export function guidanceOf(signals: readonly GuidanceSignal[], refs?: readonly PendingSignalRef[]): PendingGuidance {
  const out = foldSignals({}, signals);
  if (refs !== undefined) out.pendingSignals = refs;
  return out;
}

/**
 * THE state write: merge `signals` into the prior guidance. A writer replaces
 * only the kinds it sets; every other kind survives. `refs`, when
 * given, REPLACE `pendingSignals` — `injectSignal` already returns prior refs
 * plus the new one; when absent, the prior refs survive.
 */
export function contributeGuidance(
  prior: PendingGuidance | undefined,
  signals: readonly GuidanceSignal[],
  refs?: readonly PendingSignalRef[],
): PendingGuidance {
  const out = foldSignals({ ...(prior ?? {}) }, signals);
  if (refs !== undefined) out.pendingSignals = refs;
  return out;
}

/** Append a line to a text kind (newline-joined), keeping every other field. */
export function appendGuidanceText(prior: PendingGuidance | undefined, kind: GuidanceTextKind, text: string): PendingGuidance {
  const existing = prior?.[kind];
  return contributeGuidance(prior, [{ kind, text: existing ? `${existing}\n${text}` : text }]);
}

// ── The renderer ─────────────────────────────────────────────────────────────

/** Default loop-detected line (overridable through the `nudge.loop-detected` transform). */
export const LOOP_DETECTED_DEFAULT =
  "Loop detected: you are repeating the same tool calls. Try a different approach or synthesize what you have.";

/** Render-time inputs that are not guidance state (harness transform output). */
export interface GuidanceRenderOptions {
  /** Replaces {@link LOOP_DETECTED_DEFAULT} (the `nudge.loop-detected` transform result). */
  readonly loopDetectedMessage?: string;
}

type RenderRule = (g: PendingGuidance, o: GuidanceRenderOptions) => string | undefined;
const textRule = (kind: GuidanceTextKind): RenderRule => (g) => g[kind] || undefined;

/**
 * One render rule per kind. The mapped type makes this exhaustive: a new
 * `PendingGuidance` field without a rule fails typecheck.
 */
const RENDER_RULES: { readonly [K in GuidanceKind]: RenderRule } = {
  requiredToolsPending: (g) =>
    g.requiredToolsPending && g.requiredToolsPending.length > 0
      ? `REQUIRED tools not yet called: ${g.requiredToolsPending.join(", ")}. Call these before giving a final answer.`
      : undefined,
  loopDetected: (g, o) => (g.loopDetected ? (o.loopDetectedMessage ?? LOOP_DETECTED_DEFAULT) : undefined),
  icsGuidance: textRule("icsGuidance"),
  oracleGuidance: textRule("oracleGuidance"),
  triageSteer: textRule("triageSteer"),
  toolUnavailable: textRule("toolUnavailable"),
  errorRecovery: textRule("errorRecovery"),
  actReminder: textRule("actReminder"),
  qualityGateHint: textRule("qualityGateHint"),
  gatherDedup: textRule("gatherDedup"),
  evidenceGap: (g) =>
    g.evidenceGap
      ? `Your answer contains claims not supported by tool results: ${g.evidenceGap}. Revise using only data from the Observations above.`
      : undefined,
  environmentUpdate: textRule("environmentUpdate"),
  checklistReminder: textRule("checklistReminder"),
};

/** Render order of the `Guidance:` lines (pinned; covers every kind once). */
export const GUIDANCE_RENDER_ORDER: readonly GuidanceKind[] = [
  "requiredToolsPending",
  "loopDetected",
  "icsGuidance",
  "oracleGuidance",
  "triageSteer",
  "toolUnavailable",
  "errorRecovery",
  "actReminder",
  "qualityGateHint",
  "gatherDedup",
  "evidenceGap",
  "environmentUpdate",
  "checklistReminder",
];

/** One rendered `Guidance:` line and the kind that produced it. */
export interface GuidanceLine {
  readonly kind: GuidanceKind;
  readonly line: string;
}

/**
 * The rendered block as text parts (empty when no kind is active) plus its
 * lines. Parts, not a string (Plan 9 Phase 4 stage D2): think.ts is the one
 * place they are joined into the turn's text (`contentText`, join rule `""`).
 */
export interface GuidanceRender {
  readonly parts: readonly TextPart[];
  readonly lines: readonly GuidanceLine[];
}

/**
 * Format lines as the `Guidance:` block's parts; empty when there are none.
 * Joined with `""` they read `Guidance:\n- a\n- b` (the pre-parts bytes).
 */
export function guidanceBlockParts(lines: readonly string[]): readonly TextPart[] {
  if (lines.length === 0) return [];
  return [
    { type: "text", text: "Guidance:\n" },
    ...lines.map((s, i): TextPart => ({ type: "text", text: `${i === 0 ? "" : "\n"}- ${s}` })),
  ];
}

/** THE renderer: every guidance kind reaches the model through here. */
export function renderGuidance(guidance: PendingGuidance | undefined, options: GuidanceRenderOptions = {}): GuidanceRender {
  const g = guidance ?? {};
  const lines: GuidanceLine[] = [];
  for (const kind of GUIDANCE_RENDER_ORDER) {
    const line = RENDER_RULES[kind](g, options);
    if (line) lines.push({ kind, line });
  }
  return { parts: guidanceBlockParts(lines.map((l) => l.line)), lines };
}

/**
 * Signal render stamp rule: a pending ref counts as rendered only when its
 * field carries non-blank text (array/boolean kinds never stamp).
 */
export function guidanceFieldHasText(guidance: PendingGuidance | undefined, field: keyof PendingGuidance): boolean {
  const v = guidance?.[field];
  return typeof v === "string" && v.trim().length > 0;
}

// ── Accounting (measured, not enforced) ──────────────────────────────────────

/** Guidance cost of one think turn: what the `Guidance:` message cost. */
export interface GuidanceTurnCost {
  readonly iteration: number;
  /** Kinds that rendered a line (empty when posture/transform replaced the block). */
  readonly kinds: readonly GuidanceKind[];
  readonly chars: number;
  /** Deterministic estimate (`estimateTokenCount`, the wire guard's estimator). */
  readonly tokens: number;
}

declare module "./kernel-state.js" {
  interface KernelMeta {
    /**
     * Per-turn guidance cost (Plan 8 T3 measurement). One entry per think turn
     * that sent a `Guidance:` message. Recorded only; no budget is enforced.
     */
    readonly guidanceCost?: readonly GuidanceTurnCost[];
  }
}

/** Measure the guidance message actually sent this turn; undefined when none. */
export function guidanceTurnCost(
  iteration: number,
  sentText: string | null | undefined,
  kinds: readonly GuidanceKind[],
): Effect.Effect<GuidanceTurnCost | undefined> {
  if (!sentText) return Effect.succeed(undefined);
  return estimateTokenCount([{ role: "user", content: sentText }]).pipe(
    Effect.map((tokens) => ({ iteration, kinds, chars: sentText.length, tokens })),
  );
}
