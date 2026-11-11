/**
 * Which skills a run had active and why, read from what the run REPORTED: its
 * `SkillActivated` events and the `skills` record on `AgentStarted.config`
 * (`{ roots, catalog: [{ name, sha256 }], pinned }`). Never inferred from
 * config. Pure, framework-free: any chat or run UI can render the result.
 *
 * Why a skill was active (`via`):
 * - `pinned`: injected at bootstrap because the builder (`withSkills({ activate })`)
 *   or the run (`run(task, { skills: { activate } })`) pinned it;
 * - `relevant`: injected at bootstrap because it matched the task;
 * - `agent`: the model loaded it mid-run with `activate-skill`;
 * - `user`: the harness loaded it for a user action.
 */

/** Why a skill was active in a run. */
export type SkillActivationVia = "pinned" | "relevant" | "agent" | "user";

/** The fields of a `SkillActivated` event this module reads. */
export interface SkillActivationLike {
  readonly skillName: string;
  /** `"bootstrap"` (pin or relevance), `"model"` (activate-skill) or `"harness"`. */
  readonly trigger: string;
  readonly version?: number;
  readonly iteration?: number;
  readonly sha256?: string;
  readonly taskId?: string;
}

/** The `AgentStarted.config.skills` record (names and hashes only). */
export interface RunSkillsRecordLike {
  /** Directories scanned, in precedence order. */
  readonly roots?: readonly string[];
  /** Every skill the run could load. */
  readonly catalog?: readonly { readonly name: string; readonly sha256?: string }[];
  /** Pinned skill names (builder pins, then the run's own). */
  readonly pinned?: readonly string[];
  /** The real catalog size when the recorded list was capped. */
  readonly catalogTotal?: number;
}

/** One active skill in a run. */
export interface SkillActivationView {
  readonly name: string;
  readonly via: SkillActivationVia;
  /** Skill version the run loaded, when reported. */
  readonly version?: number;
  /** SHA-256 of the skill body the run loaded, when reported (tells versions apart). */
  readonly sha256?: string;
  /** Iteration it was loaded at (0 = bootstrap). */
  readonly iteration?: number;
}

/** A run's skills: what was active and why, plus what it could have loaded. */
export interface RunSkillsView {
  /** Active skills, first activation per name, in the order they were loaded. */
  readonly activations: readonly SkillActivationView[];
  /** Pinned names the run recorded. */
  readonly pinned: readonly string[];
  /** How many skills the run could load (its catalog size). */
  readonly available: number;
  /** Directories the run scanned, in precedence order. */
  readonly roots: readonly string[];
}

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * Why a skill was active, from the event's `trigger` and the run's pinned names.
 * A bootstrap activation of a pinned name is `pinned`, any other bootstrap
 * activation is `relevant`; an unknown trigger reads as `relevant`.
 */
export function skillActivationVia(trigger: string, name: string, pinned: readonly string[]): SkillActivationVia {
  if (trigger === "model") return "agent";
  if (trigger === "harness") return "user";
  return pinned.some((p) => sameName(p, name)) ? "pinned" : "relevant";
}

/** Short wording for a {@link SkillActivationVia}, for a chip or a tooltip. */
export function skillViaLabel(via: SkillActivationVia): string {
  switch (via) {
    case "pinned":
      return "pinned";
    case "relevant":
      return "matched the task";
    case "agent":
      return "loaded by the agent";
    case "user":
      return "added by you";
  }
}

/**
 * Build a run's {@link RunSkillsView} from its skills record and its
 * activations. The first activation of a name wins (it explains why the skill
 * came in); later ones are repeats.
 */
export function runSkillsOf(input: {
  readonly record?: RunSkillsRecordLike;
  readonly activations: readonly SkillActivationLike[];
}): RunSkillsView {
  const pinned = [...(input.record?.pinned ?? [])];
  const seen = new Set<string>();
  const activations: SkillActivationView[] = [];
  for (const a of input.activations) {
    const key = a.skillName.toLowerCase();
    if (a.skillName === "" || seen.has(key)) continue;
    seen.add(key);
    activations.push({
      name: a.skillName,
      via: skillActivationVia(a.trigger, a.skillName, pinned),
      ...(typeof a.version === "number" ? { version: a.version } : {}),
      ...(typeof a.sha256 === "string" && a.sha256 !== "" ? { sha256: a.sha256 } : {}),
      ...(typeof a.iteration === "number" ? { iteration: a.iteration } : {}),
    });
  }
  const catalog = input.record?.catalog ?? [];
  return {
    activations,
    pinned,
    available: input.record?.catalogTotal ?? catalog.length,
    roots: [...(input.record?.roots ?? [])],
  };
}

type Tagged = { readonly _tag?: unknown } & Readonly<Record<string, unknown>>;

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const asStrings = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;

/** Read a `config.skills` record off an `AgentStarted` event; `undefined` when the run had no skills configured. */
export function runSkillsRecordOf(agentStarted: unknown): RunSkillsRecordLike | undefined {
  if (!isRecord(agentStarted) || !isRecord(agentStarted.config)) return undefined;
  const s = agentStarted.config.skills;
  if (!isRecord(s)) return undefined;
  const catalog = Array.isArray(s.catalog)
    ? s.catalog.filter(isRecord).flatMap((c) =>
        typeof c.name === "string" ? [{ name: c.name, ...(typeof c.sha256 === "string" ? { sha256: c.sha256 } : {}) }] : [],
      )
    : [];
  const roots = asStrings(s.roots);
  const pinned = asStrings(s.pinned);
  return {
    catalog,
    ...(roots ? { roots } : {}),
    ...(pinned ? { pinned } : {}),
    ...(typeof s.catalogTotal === "number" ? { catalogTotal: s.catalogTotal } : {}),
  };
}

/** Read a `SkillActivated` event; `undefined` for any other event. */
export function skillActivationOf(event: unknown): SkillActivationLike | undefined {
  if (!isRecord(event) || event._tag !== "SkillActivated" || typeof event.skillName !== "string") return undefined;
  return {
    skillName: event.skillName,
    trigger: typeof event.trigger === "string" ? event.trigger : "bootstrap",
    ...(typeof event.version === "number" ? { version: event.version } : {}),
    ...(typeof event.iteration === "number" ? { iteration: event.iteration } : {}),
    ...(typeof event.sha256 === "string" ? { sha256: event.sha256 } : {}),
    ...(typeof event.taskId === "string" ? { taskId: event.taskId } : {}),
  };
}

/**
 * Fold one run's events (AgentEvent objects, oldest first) into its
 * {@link RunSkillsView}. Reads the first top-level `AgentStarted` (no
 * `parentAgentId`) for the skills record and its `taskId`; a `SkillActivated`
 * that names another task is skipped, one with no `taskId` counts for this run.
 * Returns `undefined` when the run neither had skills configured nor activated any.
 */
export function foldRunSkills(events: readonly unknown[]): RunSkillsView | undefined {
  let record: RunSkillsRecordLike | undefined;
  let taskId: string | undefined;
  const activations: SkillActivationLike[] = [];
  for (const raw of events) {
    if (!isRecord(raw)) continue;
    const e = raw as Tagged;
    if (e._tag === "AgentStarted" && taskId === undefined && e.parentAgentId === undefined) {
      taskId = typeof e.taskId === "string" ? e.taskId : undefined;
      record = runSkillsRecordOf(e);
      continue;
    }
    const a = skillActivationOf(e);
    if (a && (a.taskId === undefined || taskId === undefined || a.taskId === taskId)) activations.push(a);
  }
  if (record === undefined && activations.length === 0) return undefined;
  return runSkillsOf({ ...(record ? { record } : {}), activations });
}
