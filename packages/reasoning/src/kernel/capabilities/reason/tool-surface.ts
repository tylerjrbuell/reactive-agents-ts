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

import { filterToolsByRelevance, type ToolSchema } from "../attend/tool-formatting.js";
import { META_TOOLS as META_TOOL_SET } from "../../state/kernel-constants.js";
import type { ResolvedHarness } from "../../../harness-config.js";

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
 *
 * `heuristicRelevant` is the UNPAID fallback for the lazy allow-set. Without it,
 * "no classification" was treated as "nothing is relevant", so lazy disclosure
 * hid every domain tool and the model had to spend an iteration on
 * `discover-tools` to reach a tool the task NAMED BY NAME. Measured 2026-07-28,
 * haiku + qwen3.5, task "Use the sql-query tool …" against a 21-tool surface:
 *
 *   classifier on   iter0 visible = file-write, sql-query, sql-schema, …  6 iters
 *   classifier off  iter0 visible = file-write, recall, discover-tools    9 iters
 *
 * The extra round trip is why the paid classifier appeared to "win" that cell by
 * 8-18% — not superior classification, but being the ONLY thing that populated
 * this set. The never-prune-to-meta-only guard does not catch it either: one
 * floored builtin counts as a domain tool, so the guard sees a non-empty surface
 * while twenty tools stay hidden.
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
  /**
   * Free keyword-heuristic relevance, consulted ONLY when classification is
   * absent. Empty (the default) reproduces the pre-2026-07-28 surface exactly,
   * so every existing unit pin holds unchanged.
   */
  heuristicRelevant?: readonly string[];
  /**
   * Consumer-intent visibility floor (`withTools({ builtins: [...] })`).
   * ALWAYS in the lazy allow-set — this is the rw-9/rw-7 guarantee, previously
   * obtained by unioning these names into `classifiedRelevant`. Carried
   * separately now so `hasClassification` keeps meaning "a classifier spoke".
   */
  floorTools?: readonly string[];
  /**
   * Explicit `disclosure: "discover"`: `discover-tools` is the floor, so a
   * meta-only surface is the intended turn-1 surface, not a stranded one.
   * Skips the never-prune-to-meta-only fallback.
   */
  strictDiscover?: boolean;
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
    heuristicRelevant = [],
    floorTools = [],
  } = opts;

  let promptSchemas: readonly ToolSchema[];
  if (lazyMode) {
    const allowed = new Set<string>([
      ...classifiedRequired,
      ...classifiedRelevant,
      ...floorTools,
      // Only when the classifier said nothing — a live classification is the
      // better signal and must not be widened by keyword noise.
      ...(hasClassification ? [] : heuristicRelevant),
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
  if (preNonMeta && !postNonMeta && opts.strictDiscover !== true) {
    return effectiveSchemas;
  }
  return promptSchemas;
}

/** The discovery meta-tool, offered only while a permitted tool is still unloaded. */
const DISCOVER_TOOLS = "discover-tools";

/** Run state a meta-tool offer precondition reads (all already computed by the resolver). */
export interface OfferState {
  /** Permitted domain tools: run catalog ∪ offered set, minus deny-list and META. */
  readonly permittedDomain: readonly ToolSchema[];
  /** Names on the surface after the prune and the never-zero floor. */
  readonly flooredNames: ReadonlySet<string>;
  /** Tools the run has called so far. */
  readonly usedSet: ReadonlySet<string>;
  /** The think turn being resolved. Absent: no rule gates on the iteration. */
  readonly iteration?: number;
  /** True once a `recall(key, content)` write ran this pass. */
  readonly notesSaved?: boolean;
  /** Call time only: a tool result in the thread names a recall key (or calibration says the model uses recall). */
  readonly recallKeySurfaced?: boolean;
}

/**
 * Tools whose result never reaches the stored-result path, so running them
 * leaves nothing for `recall` to fetch: the inline meta-tools (brief / pulse /
 * todo, no ToolService round-trip), the terminal tools, `discover-tools`
 * (compression-exempt in `compressToolResult`) and `recall` itself. Every
 * other tool (domain tools, `find`, `checkpoint`, `activate-skill`) goes
 * through `compressToolResult`, which may store the result and print a
 * `recall("<key>", …)` hint, so `recall` must be offered once one has run.
 */
const RECALL_SILENT_TOOLS: ReadonlySet<string> = new Set([
  "recall",
  DISCOVER_TOOLS,
  "brief",
  "pulse",
  "todo",
  "final-answer",
  "task-complete",
  "context-status",
]);

/** The opt-in abstain meta-tool (`act/meta-tool-handlers.ts` `ABSTAIN_TOOL_NAME`). */
const ABSTAIN = "abstain";

/** One readiness rule: when the tool is useful, and what to tell a model that calls it early. */
interface MetaReadiness {
  /** True when a call can do useful work over run state. */
  readonly offered: (s: OfferState) => boolean;
  /** Reason recorded when the default (non-stable) surface hides the tool. */
  readonly hiddenReason: string;
  /** Model-facing refusal when the stable tool list keeps the tool listed and it is called early. */
  readonly notReady: string;
  /** A call shape that is always ready (e.g. a `recall` write). */
  readonly alwaysReady?: (args: Readonly<Record<string, unknown>>) => boolean;
}

/**
 * Meta-tool readiness: ONE table, read two ways. On the default surface a
 * tool with an entry is offered only while its predicate holds over run
 * state. Under the stable tool list (`harness.stableToolList`) the tool stays
 * listed and a call made before the predicate holds is refused with
 * `notReady` ({@link callNotReadyReason}). Required tools are exempt either
 * way. Why (2026-11-06): models spent early turns on `recall` before any tool
 * had run, when it could only answer "not found"; `discover-tools` with
 * nothing left to load can only answer "nothing new".
 */
const META_OFFER_PRECONDITIONS: Readonly<Record<string, MetaReadiness>> = {
  [DISCOVER_TOOLS]: {
    offered: (s) => s.permittedDomain.some((ts) => !s.flooredNames.has(ts.name)),
    hiddenReason: "hidden: nothing to discover (every permitted tool is visible)",
    notReady: "every tool you may use is already in your tool list. Call the one you need directly.",
  },
  recall: {
    // `recallKeySurfaced` (set at call time) is the sharper test: a stored
    // result named its key in the thread. The resolver falls back to "a
    // non-silent tool has run".
    offered: (s) =>
      s.notesSaved === true ||
      (s.recallKeySurfaced ?? [...s.usedSet].some((name) => !RECALL_SILENT_TOOLS.has(name))),
    hiddenReason: "hidden: nothing to recall yet (no tool has run)",
    notReady:
      "nothing is saved yet. Save a note with recall(key, content), or call a tool first: a stored result names its recall key.",
    alwaysReady: (args) => typeof args.content === "string",
  },
  [ABSTAIN]: {
    offered: (s) => s.iteration === undefined || s.iteration >= 1,
    hiddenReason: "hidden: abstain is offered after the first turn",
    notReady: "attempt the task first. Abstain only when you cannot ground an answer after trying.",
  },
};

/**
 * Call-time readiness check for the stable tool list: the model-facing reason
 * a call to `name` is refused now, or `undefined` when it may run. Reads the
 * same table the default surface hides tools by, so a precondition is declared
 * once. Required tools are never refused here.
 */
export function callNotReadyReason(
  name: string,
  args: Readonly<Record<string, unknown>>,
  state: OfferState,
  requiredTools: readonly string[],
): string | undefined {
  const rule = META_OFFER_PRECONDITIONS[name];
  if (rule === undefined || requiredTools.includes(name)) return undefined;
  if (rule.alwaysReady?.(args) === true || rule.offered(state)) return undefined;
  return rule.notReady;
}

/** The pass's pinned tool list (stable tool list mode), carried on `state.meta`. */
export interface StableToolListPin {
  /** Visible tool names, in order. Only ever grows within a pass. */
  readonly pinned: readonly string[];
  /** Names the head-truncation guard dropped on the pinning turn; never re-added unless used or discovered. */
  readonly shed: readonly string[];
  /** The iteration the list was pinned on (the only turn the guard may drop tools). */
  readonly pinnedAt: number;
}

declare module "../../state/kernel-state.js" {
  interface KernelMeta {
    /** Stable tool list pin (`harness.stableToolList`); absent when the mode is off. */
    readonly stableToolList?: StableToolListPin;
  }
}

/** Keyword top-k for the never-zero floor (spec 2026-11-06 §12.3: k=5). */
const FLOOR_KEYWORD_TOP_K = 5;

/** True when the task text names the tool (exact, spaced, or namespaced slug). */
function taskNamesTool(taskLower: string, name: string): boolean {
  const lower = name.toLowerCase();
  const slug = lower.includes("/") ? (lower.split("/").pop() ?? lower) : lower;
  return [lower, slug, slug.replace(/[-_]/g, " ")].some((v) => v.length > 0 && taskLower.includes(v));
}

/**
 * Never-zero floor (spec 2026-11-06 §12.3, F3). Called only when the pruned
 * surface holds no domain tool while the permitted set does. Draws from the
 * PERMITTED set only, never from un-opted builtins: required and builtin-floor
 * tools, tools the task names, and the free keyword top-5 (no LLM call). Empty
 * when all three are empty; `discover-tools` then stays offered over a
 * non-empty catalog.
 */
export function neverZeroFloor(
  permittedDomain: readonly ToolSchema[],
  inputs: Pick<ToolSurfaceInputs, "requiredTools" | "floorTools" | "taskText">,
): readonly ToolSchema[] {
  const taskText = inputs.taskText ?? "";
  const taskLower = taskText.toLowerCase();
  const pinned = new Set([...inputs.requiredTools, ...(inputs.floorTools ?? [])]);
  const keyword = new Set(
    taskText
      ? filterToolsByRelevance(taskText, permittedDomain).primary.slice(0, FLOOR_KEYWORD_TOP_K).map((ts) => ts.name)
      : [],
  );
  return permittedDomain.filter(
    (ts) => pinned.has(ts.name) || (taskText !== "" && taskNamesTool(taskLower, ts.name)) || keyword.has(ts.name),
  );
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
  /**
   * The task text, used to seed the lazy allow-set from the FREE keyword
   * heuristic when no classification is available (see `computePromptSchemas`).
   * Omitted → no heuristic seeding, i.e. the pre-2026-07-28 surface.
   */
  readonly taskText?: string;
  /**
   * Consumer-intent visibility floor (`KernelInput.builtinFloorTools`).
   * See `computePromptSchemas`.
   */
  readonly floorTools?: readonly string[];
  /** Resolved harness config for this run — the ONLY source for mechanism
   *  switches at this site. Threaded from `KernelInput.harness` by think.ts. */
  readonly harness: ResolvedHarness;
  /** The think turn being resolved (readiness rules that gate on it). */
  readonly iteration?: number;
  /**
   * Meta tools the caller left out of `augmented` because they are not ready
   * (e.g. `final-answer` before its visibility rule holds), with the reason.
   * Recorded in `reasons` so a tool leaving the surface always says why.
   */
  readonly withheld?: ReadonlyMap<string, string>;
  /**
   * The pass's pinned list when `harness.stableToolList` is on and an earlier
   * turn pinned it. Absent on the pinning turn. Ignored when the mode is off.
   */
  readonly pin?: StableToolListPin;
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
  heuristicSet: ReadonlySet<string>,
  strictDiscover: boolean,
  withinBudget: boolean,
): string {
  if (inputs.requiredTools.includes(name)) return "required";
  if (META_TOOL_SET.has(name)) return "meta-floor";
  // Under strict discover these lists bound permission, not visibility, so
  // they are never the reason a tool shows (a discovered tool said
  // "allowed-floor" before 2026-11-10).
  if (!strictDiscover && inputs.allowedTools.includes(name)) return "allowed-floor";
  if (!strictDiscover && inputs.relevantTools.includes(name)) return "relevant";
  if (!strictDiscover && (inputs.floorTools ?? []).includes(name)) return "builtins-floor";
  // Ranked below `relevant` so a classified run never reports this reason.
  if (heuristicSet.has(name)) return "heuristic-relevant (unclassified run)";
  if (usedSet.has(name)) return "already-used";
  if (discoveredSet.has(name)) return "discovered";
  if (withinBudget) return `within-budget (at most ${inputs.pruneMinTools} domain tools: all disclosed)`;
  return inputs.lazyMode ? "lazy-fallback (never-prune-to-meta-only)" : "unpruned";
}

/**
 * Resolve the entire per-iteration tool surface in one pass.
 *
 * Behavior-identical composition of the three legacy stages, in their
 * original order: pressure narrow → computePromptSchemas → gate narrow.
 *
 * Stable tool list (`harness.stableToolList`, opt-in): nothing narrows the
 * list after the pinning turn. The pressure arm, the offer preconditions and
 * the gate narrowing do not remove tools; readiness is refused at call time
 * ({@link callNotReadyReason}) and steering rides `Guidance:`. With a `pin`,
 * the visible list is the pinned list plus any newly visible tool appended at
 * the end (discovered, used), so the tool block keeps its prefix.
 */
export function resolveToolSurface(inputs: ToolSurfaceInputs): ResolvedToolSurface {
  const stable = inputs.harness.stableToolList === true;
  // Stable mode: the pressure arm would cut the list mid-run, so it is off.
  const pressureCritical = inputs.pressureCritical && !stable;
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
    pressureCritical && !inputs.lazyMode
      ? permitted([inputs.finalAnswerSchema])
      : augmented;

  // Explicit `.withTools({ disclosure: "discover" })` (harness.disclosureMode,
  // set from the config layer only, never a tier default): load on demand.
  // Visible = meta + required + used + discovered. allowedTools and the
  // builtin floor bound PERMISSION here (the catalog discover-tools lists
  // from), never visibility; no relevance, keyword or never-zero picks —
  // discover-tools is the floor.
  const strictDiscover = inputs.lazyMode && inputs.harness.disclosureMode === "discover";

  // Within-budget rule (2026-11-12): visibility comes from the configured tool
  // SET, not from prose similarity. Lazy disclosure saves tokens only on a
  // large set; with at most `pruneMinTools` domain tools every one is shown, so
  // "what is bitcoin worth" can never hide `crypto-price`. Explicit
  // `disclosure: "discover"` stays strict at any size. Deterministic, no LLM.
  const domainCount = effectiveSchemas.filter((ts) => !META_TOOL_SET.has(ts.name)).length;
  // A live classification or declared required tools are explicit narrowing
  // intent and keep the prune (their pins are unchanged); the default,
  // unclassified surface is what this rule governs. An enabled tool index
  // (`harness.toolIndex`, opt-in) is itself the disclosure mechanism: it lists
  // every hidden tool by name, so it keeps the prune.
  const withinBudget =
    inputs.lazyMode &&
    !strictDiscover &&
    inputs.harness.toolIndex !== true &&
    !inputs.hasClassification &&
    domainCount <= inputs.pruneMinTools;

  // Free keyword relevance over the SAME schema set the prune runs on. Computed
  // only when it can be used (no classification, lazy mode, task text present)
  // so the classified path pays nothing for it.
  const heuristicRelevant: readonly string[] =
    !strictDiscover && !withinBudget && !inputs.hasClassification && inputs.lazyMode && inputs.taskText
      ? filterToolsByRelevance(inputs.taskText, effectiveSchemas).primary.map((ts) => ts.name)
      : [];
  const heuristicSet = new Set(heuristicRelevant);

  // Stage 2 — lazy disclosure / classification pruning (+ floors + guard).
  // Skipped when the domain set is within budget (see above).
  const pruned = withinBudget ? effectiveSchemas : computePromptSchemas({
    effectiveSchemas,
    lazyMode: inputs.lazyMode,
    pressureCritical,
    hasClassification: inputs.hasClassification,
    classifiedRequired: inputs.requiredTools,
    classifiedRelevant: strictDiscover ? [] : inputs.relevantTools,
    allowedTools: strictDiscover ? [] : inputs.allowedTools,
    toolsUsed: usedSet,
    discovered: discoveredSet,
    pruneMinTools: inputs.pruneMinTools,
    heuristicRelevant,
    floorTools: strictDiscover ? [] : (inputs.floorTools ?? []),
    strictDiscover,
  });

  // Stage 2b — the permitted set's disclosure rules (spec 2026-11-06 §12.3, F3).
  // Permitted domain = run catalog ∪ offered set, minus the deny-list and META.
  const pressureArm = pressureCritical && !inputs.lazyMode;
  const permittedDomain = dedupeByName(permitted([...inputs.augmented, ...(inputs.catalog ?? [])]))
    .filter((ts) => !META_TOOL_SET.has(ts.name));
  // Never-zero floor: a surface with no domain tool while some tool is
  // permitted gets the floor's picks (the pressure arm's final-answer-only
  // narrowing is deliberate and stays).
  const floor: readonly ToolSchema[] =
    !pressureArm && !strictDiscover && !pruned.some((ts) => !META_TOOL_SET.has(ts.name)) && permittedDomain.length > 0
      ? neverZeroFloor(permittedDomain, inputs)
      : [];
  const floored = [...pruned, ...floor];
  // Offer gating (META_OFFER_PRECONDITIONS): a meta-tool whose precondition
  // fails over run state is withheld; required tools are exempt. Stable mode
  // keeps it listed (`notReady`) and refuses the call instead.
  const flooredNames = new Set(floored.map((ts) => ts.name));
  const offerState: OfferState = {
    permittedDomain,
    flooredNames,
    usedSet,
    ...(inputs.iteration !== undefined ? { iteration: inputs.iteration } : {}),
  };
  const offerHidden = new Map<string, string>();
  const notReady = new Map<string, string>();
  for (const [name, rule] of Object.entries(META_OFFER_PRECONDITIONS)) {
    if (flooredNames.has(name) && !inputs.requiredTools.includes(name) && !rule.offered(offerState)) {
      (stable ? notReady : offerHidden).set(name, rule.hiddenReason);
    }
  }
  const fresh = offerHidden.size > 0 ? floored.filter((ts) => !offerHidden.has(ts.name)) : floored;
  const floorNames = new Set(floor.map((ts) => ts.name));

  // Stable mode with a pin: the pinned list in pinned order, then any newly
  // visible tool appended (a shed tool returns only once used or discovered).
  const pin = stable ? inputs.pin : undefined;
  const pinnedSet = new Set(pin?.pinned ?? []);
  const shed = new Set(pin?.shed ?? []);
  const known = new Map(dedupeByName([...augmented, ...floor, ...permittedDomain]).map((ts) => [ts.name, ts]));
  const pinnedSchemas: readonly ToolSchema[] = (pin?.pinned ?? []).flatMap((n) => {
    const ts = known.get(n);
    return ts !== undefined && !denied.has(n) ? [ts] : [];
  });
  const visible: readonly ToolSchema[] = pin === undefined
    ? fresh
    : [
        ...pinnedSchemas,
        ...fresh.filter(
          (ts) => !pinnedSet.has(ts.name) && (!shed.has(ts.name) || usedSet.has(ts.name) || discoveredSet.has(ts.name)),
        ),
      ];

  // Stage 3 — required-tools gate narrowing (previously buildToolSchemas):
  // while the gate is actively blocking AND required tools are unsatisfied,
  // the FC offer narrows to missing-required + META so models without
  // tool_choice support stop re-selecting a previously successful tool.
  // Stable mode: off. The act-time gate refuses those calls ("required-first")
  // and `requiredToolsPending` guidance steers instead.
  const gateNarrowActive =
    !stable && inputs.gateBlockedTools.length > 0 && inputs.missingRequiredTools.length > 0;
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
  const freshNames = new Set(fresh.map((ts) => ts.name));
  const allNames = new Set([
    ...inputs.augmented.map((ts) => ts.name),
    ...discoveredFromCatalog.map((ts) => ts.name),
    ...floorNames,
    ...(pressureCritical && !inputs.lazyMode ? [inputs.finalAnswerSchema.name] : []),
    ...pinnedSet,
  ]);
  for (const name of allNames) {
    if (denied.has(name)) {
      reasons.set(name, "hidden: forbidden-by-contract (declared deny-list)");
    } else if (offerHidden.has(name)) {
      reasons.set(name, offerHidden.get(name) ?? "hidden: offer precondition");
    } else if (pinnedSet.has(name) && !visibleNames.has(name)) {
      reasons.set(name, "hidden: pinned tool no longer registered");
    } else if (!visibleNames.has(name) && shed.has(name)) {
      reasons.set(name, "hidden: shed on the pinning turn by the head-truncation guard (window too small)");
    } else if (notReady.has(name) && visibleNames.has(name)) {
      const why = (notReady.get(name) ?? "").replace(/^hidden: /, "");
      reasons.set(name, `visible: stable list, not ready (${why}); a call is refused until ready`);
    } else if (pinnedSet.has(name) && !freshNames.has(name)) {
      reasons.set(name, "visible: pinned at run start (stable tool list)");
    } else if (floorNames.has(name) && callableNames.has(name)) {
      reasons.set(name, "visible: never-zero floor (no domain tool survived the prune)");
    } else if (!visibleNames.has(name)) {
      if (pressureCritical && !inputs.lazyMode) {
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
      reasons.set(
        name,
        `visible: ${visibleReason(name, inputs, usedSet, discoveredSet, heuristicSet, strictDiscover, withinBudget)}`,
      );
    }
  }
  // Tools the caller withheld before resolution still say why (a tool leaving
  // the surface always carries a reason; census 2026-11-10: 179 did not).
  for (const [name, why] of inputs.withheld ?? []) {
    if (!reasons.has(name)) reasons.set(name, why);
  }

  // A floor tool may live only in the catalog; it must resolve like any offered tool.
  // A pinned tool resolves even on a turn its fresh rule would not show it.
  const universe = pinnedSchemas.length > 0
    ? dedupeByName([...effectiveSchemas, ...floor, ...pinnedSchemas])
    : floor.length > 0 ? [...effectiveSchemas, ...floor] : effectiveSchemas;
  return { universe, visible, callable, reasons };
}

/** First schema per name wins (the offered `augmented` schema over its catalog copy). */
function dedupeByName(xs: readonly ToolSchema[]): readonly ToolSchema[] {
  const seen = new Set<string>();
  return xs.filter((ts) => (seen.has(ts.name) ? false : (seen.add(ts.name), true)));
}
