/**
 * Tool Surface Resolver — ONE place computes what the model can see and call
 * each iteration (Adaptive Harness Overhaul Phase 2, pillar 6 seed,
 * 2026-07-07).
 *
 * Born from the 2026-07-07 rw-7/8/9 100%→0 regression: visibility was decided
 * by four sequential filter sites across two packages, with `requiredTools`
 * acting as an implicit visibility floor in three of them. When a task
 * declared a minimal requiredTools list, the other floors silently vanished
 * and an explicitly-requested tool (file-write) became invisible under lazy
 * disclosure. Diagnosing it took a debug tap because NO site could say WHY a
 * tool was hidden.
 *
 * This module unifies the kernel's per-iteration stages behind one call:
 *   1. context-pressure narrowing  (final-answer-only, non-lazy arm)
 *   2. lazy disclosure / classification pruning  (computePromptSchemas —
 *      moved here verbatim from think.ts, its unit pins unchanged)
 *   3. required-tools gate narrowing  (previously buildToolSchemas in
 *      context-utils.ts)
 * and returns a per-tool REASON map so the next rw-9-class diagnosis is one
 * trace line (`tool-surface-resolved`), not a debug tap.
 *
 * Two invariants the resolver enforces BY CONSTRUCTION (property-tested in
 * tool-surface.test.ts):
 *   - FLOOR: explicit `allowedTools` and META tools always survive pruning.
 *   - NEVER-PRUNE-TO-META-ONLY: a prune that strands the model with zero
 *     domain tools falls back to the unpruned set.
 *
 * Still outside the resolver (documented, deliberate):
 *   - The recall overflow gate (think.ts) — it needs the assembled
 *     conversation window, which is built AFTER the prompt schemas. Its
 *     verdict is appended to the trace event's reason map by the caller.
 *   - The runtime's build-time 5-stage prep (tool-schemas.ts) — produces the
 *     run-level `availableToolSchemas` this resolver consumes per iteration.
 *     Merging it is the follow-up wave of Phase 2.
 */

import type { ToolSchema } from "../attend/tool-formatting.js";
import { META_TOOLS as META_TOOL_SET } from "../../state/kernel-constants.js";

/**
 * Pure prune-set computation for the think-phase tool disclosure.
 *
 * Determines which tools the model actually sees this step. Two load-bearing
 * guarantees (P0 fix 2026-06-04, classifier-prunes-task-tool):
 *  - FLOOR: the caller's explicit `allowedTools` whitelist always survives the
 *    prune in BOTH the lazy and the non-lazy (RA_LAZY_TOOLS=0) arm. The floor
 *    only ADDS to the visible set — it never turns allowedTools into a hard
 *    restriction (that gate lives in act.ts).
 *  - NEVER-PRUNE-TO-META-ONLY: if the pre-prune set had ≥1 non-META domain tool
 *    but the post-prune set has 0, the classifier stranded the model — fall back
 *    to the unpruned set. Does NOT fire for legitimately pure-META tasks.
 */
export function computePromptSchemas(opts: {
  effectiveSchemas: readonly ToolSchema[];
  lazyMode: boolean;
  pressureCritical: boolean;
  hasClassification: boolean;
  classifiedRequired: readonly string[];
  classifiedRelevant: readonly string[];
  allowedTools: readonly string[];
  toolsUsed: Iterable<string>;
  discovered: Iterable<string>;
  pruneMinTools: number;
}): readonly ToolSchema[] {
  const {
    effectiveSchemas,
    lazyMode,
    pressureCritical,
    hasClassification,
    classifiedRequired,
    classifiedRelevant,
    allowedTools,
    toolsUsed,
    discovered,
    pruneMinTools,
  } = opts;

  let promptSchemas: readonly ToolSchema[];
  if (lazyMode) {
    const allowed = new Set<string>([
      ...classifiedRequired,
      ...classifiedRelevant,
      ...toolsUsed,
      ...discovered,
      ...allowedTools,
    ]);
    promptSchemas = effectiveSchemas.filter(
      (ts) => allowed.has(ts.name) || META_TOOL_SET.has(ts.name),
    );
  } else {
    promptSchemas =
      hasClassification && !pressureCritical && effectiveSchemas.length > pruneMinTools
        ? effectiveSchemas.filter(
            (ts) =>
              classifiedRequired.includes(ts.name) ||
              classifiedRelevant.includes(ts.name) ||
              allowedTools.includes(ts.name) ||
              META_TOOL_SET.has(ts.name),
          )
        : effectiveSchemas;
  }

  // Never-prune-to-meta-only guard: when domain tools existed pre-prune but the
  // prune left only META tools, the classifier stranded the model. Restore the
  // unpruned set so the model can still act. Pure-META tasks (0 domain tools
  // pre-prune) are legitimate and do not trip this.
  const preNonMeta = effectiveSchemas.some((ts) => !META_TOOL_SET.has(ts.name));
  const postNonMeta = promptSchemas.some((ts) => !META_TOOL_SET.has(ts.name));
  if (preNonMeta && !postNonMeta) {
    return effectiveSchemas;
  }
  return promptSchemas;
}

export interface ToolSurfaceInputs {
  /** Post-augmentation schema list (meta-tools already appended by think.ts). */
  readonly augmented: readonly ToolSchema[];
  /** Schema used for the pressure-critical final-answer-only arm. */
  readonly finalAnswerSchema: ToolSchema;
  readonly lazyMode: boolean;
  readonly pressureCritical: boolean;
  readonly hasClassification: boolean;
  readonly requiredTools: readonly string[];
  readonly relevantTools: readonly string[];
  readonly allowedTools: readonly string[];
  readonly toolsUsed: Iterable<string>;
  readonly discovered: Iterable<string>;
  /** Tools the required-tools gate blocked this iteration (state.meta.gateBlockedTools). */
  readonly gateBlockedTools: readonly string[];
  /** Required tools still unsatisfied (drives the gate narrowing). */
  readonly missingRequiredTools: readonly string[];
  readonly pruneMinTools: number;
  /**
   * Contract-declared deny-list (`RunContract.constraints.forbidden-tool`, via
   * `forbiddenTools(contract)`). A HARD boundary: it is applied last and beats
   * every floor — required, allowed, and META alike. Absent/empty → the surface
   * is byte-identical to a run without a contract.
   */
  readonly forbiddenTools?: readonly string[];
  /**
   * The FULL run-level tool catalog (`KernelInput.allToolSchemas`) — the set
   * discover-tools lists from. `augmented` is the engine's PRE-FILTERED subset;
   * a discovered tool whose schema lives only here must still surface, or
   * discovery is a dead-end for exactly the built-ins the runtime filter
   * withholds (live regression 01KX6KY8ANMXC1BSQ1SNJN3DAP, 2026-07-10: model
   * called discover-tools 4 consecutive iterations, handler said "now
   * callable", surface never changed). Only names in `discovered` are resolved
   * from here — the catalog alone discloses nothing.
   */
  readonly catalog?: readonly ToolSchema[];
}

export interface ResolvedToolSurface {
  /**
   * The stage-1 (pressure-armed) schema universe the resolver pruned FROM —
   * augmented set, or final-answer-only under critical pressure (non-lazy).
   * The tool-call resolver heals model-named calls against this, not against
   * `visible`: a hallucinated-but-real tool name should still resolve.
   */
  readonly universe: readonly ToolSchema[];
  /** What the system prompt's tool reference shows this iteration. */
  readonly visible: readonly ToolSchema[];
  /**
   * What the FC `tools` parameter offers — `visible` further narrowed to
   * missing-required + META while the required-tools gate is blocking.
   * Always a subset of `visible`.
   */
  readonly callable: readonly ToolSchema[];
  /**
   * Why each tool in `augmented` is visible or hidden — first matching rule
   * wins. The rw-9 diagnosis that took a debug tap, as data.
   */
  readonly reasons: ReadonlyMap<string, string>;
}

/** First-match visibility reason for a tool that survived resolution. */
function visibleReason(
  name: string,
  inputs: ToolSurfaceInputs,
  usedSet: ReadonlySet<string>,
  discoveredSet: ReadonlySet<string>,
): string {
  if (inputs.requiredTools.includes(name)) return "required";
  if (META_TOOL_SET.has(name)) return "meta-floor";
  if (inputs.allowedTools.includes(name)) return "allowed-floor";
  if (inputs.relevantTools.includes(name)) return "relevant";
  if (usedSet.has(name)) return "already-used";
  if (discoveredSet.has(name)) return "discovered";
  return inputs.lazyMode ? "lazy-fallback (never-prune-to-meta-only)" : "unpruned";
}

/**
 * Resolve the entire per-iteration tool surface in one pass.
 *
 * Behavior-identical composition of the three legacy stages, in their
 * original order: pressure narrow → computePromptSchemas → gate narrow.
 */
export function resolveToolSurface(inputs: ToolSurfaceInputs): ResolvedToolSurface {
  const usedSet = new Set(inputs.toolsUsed);
  const discoveredSet = new Set(inputs.discovered);

  // Stage 0 — contract deny-list. Applied to the schema universe BEFORE any
  // floor can re-admit a tool, because `universe` is what the tool-call
  // resolver heals model-named calls against: a hallucinated forbidden name
  // must not resolve back into an executable call. Deny therefore beats
  // required / allowed / META by construction, not by ordering luck.
  const denied = new Set(inputs.forbiddenTools ?? []);
  const permitted = (xs: readonly ToolSchema[]): readonly ToolSchema[] =>
    denied.size === 0 ? xs : xs.filter((ts) => !denied.has(ts.name));

  // Discovered-from-catalog union (01KX6KY8 fix): a name the model discovered
  // whose schema exists ONLY in the full catalog joins the pre-prune set —
  // otherwise "Tools you discover become callable in your next response" is a
  // lie for every tool the runtime pre-filter withheld. Dedupe by name: the
  // `augmented` schema wins when both carry it. Runs BEFORE `permitted`, so
  // the contract deny-list beats discovery by construction; the pressure arm
  // below still replaces the whole set, so discovery never re-widens it.
  const augmentedNames = new Set(inputs.augmented.map((ts) => ts.name));
  const discoveredFromCatalog: readonly ToolSchema[] = (inputs.catalog ?? []).filter(
    (ts) => discoveredSet.has(ts.name) && !augmentedNames.has(ts.name),
  );

  const augmented = permitted([...inputs.augmented, ...discoveredFromCatalog]);

  // Stage 1 — context-pressure hard gate (non-lazy arm only; under lazy mode
  // the disclosure filter owns visibility and premature narrowing induces
  // panic dumps on local models).
  const effectiveSchemas: readonly ToolSchema[] =
    inputs.pressureCritical && !inputs.lazyMode
      ? permitted([inputs.finalAnswerSchema])
      : augmented;

  // Stage 2 — lazy disclosure / classification pruning (+ floors + guard).
  const visible = computePromptSchemas({
    effectiveSchemas,
    lazyMode: inputs.lazyMode,
    pressureCritical: inputs.pressureCritical,
    hasClassification: inputs.hasClassification,
    classifiedRequired: inputs.requiredTools,
    classifiedRelevant: inputs.relevantTools,
    allowedTools: inputs.allowedTools,
    toolsUsed: usedSet,
    discovered: discoveredSet,
    pruneMinTools: inputs.pruneMinTools,
  });

  // Stage 3 — required-tools gate narrowing (previously buildToolSchemas):
  // while the gate is actively blocking AND required tools are unsatisfied,
  // the FC offer narrows to missing-required + META so models without
  // tool_choice support stop re-selecting a previously successful tool.
  const gateNarrowActive =
    inputs.gateBlockedTools.length > 0 && inputs.missingRequiredTools.length > 0;
  const callable = gateNarrowActive
    ? visible.filter(
        (ts) => inputs.missingRequiredTools.includes(ts.name) || META_TOOL_SET.has(ts.name),
      )
    : visible;

  // Reason map over the full augmented set (plus the synthetic final-answer
  // schema if the pressure arm injected it).
  const reasons = new Map<string, string>();
  const visibleNames = new Set(visible.map((ts) => ts.name));
  const callableNames = new Set(callable.map((ts) => ts.name));
  const allNames = new Set([
    ...inputs.augmented.map((ts) => ts.name),
    ...discoveredFromCatalog.map((ts) => ts.name),
    ...(inputs.pressureCritical && !inputs.lazyMode ? [inputs.finalAnswerSchema.name] : []),
  ]);
  for (const name of allNames) {
    if (denied.has(name)) {
      reasons.set(name, "hidden: forbidden-by-contract (declared deny-list)");
    } else if (!visibleNames.has(name)) {
      if (inputs.pressureCritical && !inputs.lazyMode) {
        reasons.set(name, "hidden: pressure-critical (final-answer only)");
      } else if (inputs.lazyMode) {
        reasons.set(name, "hidden: lazy-undisclosed (not required/relevant/used/discovered/allowed/meta)");
      } else {
        reasons.set(name, "hidden: classification-pruned (not required/relevant/allowed/meta)");
      }
    } else if (!callableNames.has(name)) {
      reasons.set(
        name,
        `visible, gate-narrowed from FC: required tool(s) pending [${inputs.missingRequiredTools.join(", ")}]`,
      );
    } else {
      reasons.set(name, `visible: ${visibleReason(name, inputs, usedSet, discoveredSet)}`);
    }
  }

  return { universe: effectiveSchemas, visible, callable, reasons };
}
