/**
 * Living skills, for any UI that shows how an agent's stored skills evolve:
 * confidence tiers in words, a line diff between two skill versions, and one
 * timeline entry per lifecycle event (`SkillActivated`, `SkillRefined`,
 * `SkillRolledBack`, `SkillPromoted`). Pure and framework-free: it reads the
 * event fields the framework reports and never infers a change it did not report.
 */

/** A stored skill's confidence tier (`SkillRecord.confidence`). */
export type SkillConfidenceTier = "tentative" | "trusted" | "expert";

/** The confidence tiers in promotion order. */
export const SKILL_CONFIDENCE_TIERS: readonly SkillConfidenceTier[] = ["tentative", "trusted", "expert"];

/**
 * A confidence value in words (`Tentative`, `Trusted`, `Expert`); an unknown
 * value is returned as is so a new tier still shows.
 */
export function skillConfidenceLabel(confidence: string): string {
  return SKILL_CONFIDENCE_TIERS.includes(confidence as SkillConfidenceTier)
    ? confidence.charAt(0).toUpperCase() + confidence.slice(1)
    : confidence;
}

/** One line of a version diff. */
export interface SkillDiffLine {
  /** `same` in both, `add` only in the newer text, `del` only in the older one. */
  readonly kind: "same" | "add" | "del";
  readonly text: string;
}

/** Above this many lines on each side the diff falls back to delete-all + add-all. */
const MAX_DIFF_LINES = 2000;

/**
 * Line diff from `before` to `after` (longest common subsequence). Lines in
 * both read `same`; removed lines `del`, added lines `add`, deletions before
 * additions at each change. Inputs over 2000 lines on either side diff as a
 * full replace rather than paying the quadratic table.
 */
export function skillLineDiff(before: string, after: string): SkillDiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return [...a.map((text) => ({ kind: "del" as const, text })), ...b.map((text) => ({ kind: "add" as const, text }))];
  }
  // lcs[i][j] = length of the LCS of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: SkillDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: "del", text: a[i]! });
      i++;
    } else {
      out.push({ kind: "add", text: b[j]! });
      j++;
    }
  }
  while (i < a.length) out.push({ kind: "del", text: a[i++]! });
  while (j < b.length) out.push({ kind: "add", text: b[j++]! });
  return out;
}

/** Added and removed line counts of a diff. */
export function skillDiffStats(diff: readonly SkillDiffLine[]): { readonly added: number; readonly removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of diff) {
    if (l.kind === "add") added++;
    else if (l.kind === "del") removed++;
  }
  return { added, removed };
}

/** The fields of a skill lifecycle event this module reads (`_tag` plus the event's own fields). */
export interface SkillLifecycleEventLike {
  readonly _tag: string;
  readonly skillName?: string;
  readonly taskId?: string;
  // SkillActivated
  readonly version?: number;
  readonly trigger?: string;
  // SkillRefined
  readonly previousVersion?: number;
  readonly newVersion?: number;
  // SkillRolledBack
  readonly fromVersion?: number;
  readonly toVersion?: number;
  readonly reason?: string;
  // SkillPromoted
  readonly fromConfidence?: string;
  readonly toConfidence?: string;
}

/** The lifecycle event kinds a timeline shows. */
export type SkillLifecycleKind = "activated" | "refined" | "rolled-back" | "promoted";

/** One timeline entry. */
export interface SkillLifecycleEntry {
  readonly kind: SkillLifecycleKind;
  readonly skillName: string;
  /** What happened, in words (`Promoted Tentative → Trusted`). */
  readonly label: string;
  /** The run the event belongs to, when the producer reported one. */
  readonly taskId?: string;
}

const TAG_KIND: Readonly<Record<string, SkillLifecycleKind>> = {
  SkillActivated: "activated",
  SkillRefined: "refined",
  SkillRolledBack: "rolled-back",
  SkillPromoted: "promoted",
};

/** Event `_tag`s {@link skillLifecycleEntryOf} reads. */
export const SKILL_LIFECYCLE_TAGS: readonly string[] = Object.keys(TAG_KIND);

const ACTIVATION_TRIGGER: Readonly<Record<string, string>> = {
  model: "loaded by the agent",
  bootstrap: "at the start of the run",
  harness: "by the harness",
};

const v = (n: number | undefined): string => (typeof n === "number" ? `v${n}` : "?");

/**
 * A lifecycle event as a timeline entry, or `undefined` for any other event or
 * one without a skill name.
 */
export function skillLifecycleEntryOf(event: SkillLifecycleEventLike): SkillLifecycleEntry | undefined {
  const kind = TAG_KIND[event._tag];
  if (!kind || typeof event.skillName !== "string" || event.skillName === "") return undefined;
  let label: string;
  switch (kind) {
    case "activated": {
      const how = event.trigger ? ACTIVATION_TRIGGER[event.trigger] ?? event.trigger : undefined;
      label = `Used ${v(event.version)}${how ? `, ${how}` : ""}`;
      break;
    }
    case "refined":
      label = `Refined ${v(event.previousVersion)} → ${v(event.newVersion)}`;
      break;
    case "rolled-back":
      label = `Rolled back ${v(event.fromVersion)} → ${v(event.toVersion)}${
        event.reason === "regression" ? " (success rate fell)" : event.reason === "manual" ? " (by hand)" : ""
      }`;
      break;
    case "promoted":
      label = `Promoted ${skillConfidenceLabel(event.fromConfidence ?? "?")} → ${skillConfidenceLabel(event.toConfidence ?? "?")}`;
      break;
  }
  return {
    kind,
    skillName: event.skillName,
    label,
    ...(typeof event.taskId === "string" && event.taskId !== "" ? { taskId: event.taskId } : {}),
  };
}
