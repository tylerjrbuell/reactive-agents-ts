/**
 * Pure scoring for the calibration probes (calibration-runner.ts) plus the
 * discrimination gate a regenerated calibration set must pass before it is
 * committed.
 *
 * Why this module exists (probe v3, 2026-11-10): the v2 scorers could not tell
 * models apart. All 9 committed calibrations read `steeringCompliance:
 * "hybrid"` (the scorer returned "hybrid" when every channel passed AND when
 * none did), `systemPromptAttention: "strong"` ("moderate" was unreachable:
 * only turn 5 was checked), and `optimalToolResultChars: 2000` (the probe
 * stopped at 2000). Scorers here are graded, so every declared value is
 * reachable, and the gate checks that a set of calibrations actually spreads.
 *
 * Everything here is deterministic and zero-token; the runner owns the I/O.
 */
import type { ModelCalibration } from "./calibration.js";

// ── Text helpers ──────────────────────────────────────────────────────────────

/** Drop inline `<think>...</think>` blocks some local models leave in content. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

// ── Steering channel ──────────────────────────────────────────────────────────

/** Which channel's rule a reply obeyed: system, user, or neither/both. */
export type ChannelVerdict = "system" | "user" | "none";

/**
 * One channel-conflict pair: the system prompt and the user message give
 * contradicting format rules; `judge` reads which one the reply obeyed.
 */
export interface SteeringConflict {
  readonly system: string;
  readonly user: string;
  readonly judge: (reply: string) => ChannelVerdict;
}

const lastWord = (r: string): string =>
  r.replace(/[^A-Za-z\s]/g, " ").trim().split(/\s+/).pop()?.toUpperCase() ?? "";

/**
 * Three conflict pairs. Placing one rule in a single channel did not separate
 * models (v2 "reply BLUE", and a five-rule set, both passed in every channel
 * for every model tried), so the probe asks which channel WINS when they
 * disagree, the case harness guidance meets in practice.
 */
export const STEERING_CONFLICTS: readonly SteeringConflict[] = [
  {
    system: "End your reply with the word ALPHA.",
    user: "End your reply with the word OMEGA.",
    judge: (r) => {
      const w = lastWord(stripThinking(r));
      return w === "ALPHA" ? "system" : w === "OMEGA" ? "user" : "none";
    },
  },
  {
    system: "Write your entire reply in UPPERCASE letters.",
    user: "Write your entire reply in lowercase letters.",
    judge: (r) => {
      const t = stripThinking(r);
      if (/[A-Z]/.test(t) && t === t.toUpperCase()) return "system";
      if (/[a-z]/.test(t) && t === t.toLowerCase()) return "user";
      return "none";
    },
  },
  {
    system: "Begin your reply with the exact text 'Sure:'.",
    user: "Begin your reply with the exact text 'Okay:'.",
    judge: (r) => {
      const t = stripThinking(r);
      return t.startsWith("Sure:") ? "system" : t.startsWith("Okay:") ? "user" : "none";
    },
  },
];

/** Task appended after the user-channel rule in every conflict call. */
export const STEERING_TASK = "Name two animals that live in the sea.";

/**
 * Which channel carries steering best, from the conflict verdicts: the channel
 * that won more pairs. `hybrid` only on a real split: equal wins (including
 * zero each, when the model obeyed neither rule).
 */
export function scoreSteering(verdicts: readonly ChannelVerdict[]): ModelCalibration["steeringCompliance"] {
  const system = verdicts.filter((v) => v === "system").length;
  const user = verdicts.filter((v) => v === "user").length;
  if (system > user) return "system-prompt";
  if (user > system) return "user-message";
  return "hybrid";
}

// ── System-prompt attention ───────────────────────────────────────────────────

/** Token the system prompt requires at the end of every reply. */
export const ATTENTION_TOKEN = "[VERIFIED]";

/**
 * User turns for the attention probe. Long replies (paragraphs, lists, code)
 * push the system prompt further back; terse ones pull against the rule.
 * Models that keep the rule throughout read "strong", models that drop it on
 * some turns "moderate", models that drop it on most "weak".
 */
export const ATTENTION_TURNS: readonly string[] = [
  "Count to 3.",
  "Write a 120-word paragraph about the history of bread.",
  "Reply with only the number 7.",
  "List 8 European capitals, one per line.",
  "What is 2+2? Answer with just the digit.",
  "Write a short Python function that reverses a string.",
  "Say yes or no only: is water wet?",
  "Write a 120-word paragraph about volcanoes.",
  "One word only: the opposite of hot.",
  "Name a fruit.",
];

/** Whether a reply ends with {@link ATTENTION_TOKEN}. */
export function keepsAttentionRule(reply: string): boolean {
  return stripThinking(reply).trimEnd().endsWith(ATTENTION_TOKEN);
}

/**
 * Attention from per-turn rule compliance: the share of turns that kept the
 * rule. All turns -> strong; at least half -> moderate; fewer -> weak.
 */
export function scoreAttention(perTurn: readonly boolean[]): ModelCalibration["systemPromptAttention"] {
  if (perTurn.length === 0) return "weak";
  const kept = perTurn.filter(Boolean).length;
  if (kept === perTurn.length) return "strong";
  if (kept * 2 >= perTurn.length) return "moderate";
  return "weak";
}

// ── Tool-result size ──────────────────────────────────────────────────────────

/**
 * Tool-result sizes the compression probe tries, ascending. Capped at 8000:
 * the value feeds `toolResultMaxChars` (the runtime tool-result compression
 * budget), so the probe never claims more than it measured.
 */
export const RESULT_SIZE_LADDER: readonly number[] = [1000, 2000, 4000, 8000];

/** Floor when even the smallest size fails. */
export const RESULT_SIZE_FLOOR = 500;

/**
 * The team the compression probe asks about: two games, scored at 1/4 and 3/4
 * of the result, whose sum is the answer. Finding ONE unique record did not
 * separate models (every model tried found it up to 24000 chars), and summing
 * three floored most small models at 1000; two-record aggregation spread them.
 */
export const RESULT_TARGET = { team: "otters", games: [30, 12], total: 42 } as const;

/** The question the compression probe asks about {@link buildResultPayload}. */
export const RESULT_QUESTION = `Team ${RESULT_TARGET.team} played two games. What is their total score across both? Answer with the number.`;

const TEAMS = [
  "falcons", "wolves", "hawks", "bears", "lynx", "ravens", "foxes", "sharks",
  "eagles", "tigers", "bison", "cobras", "herons", "moose", "orcas", "vipers",
] as const;

/** Game ids start here so no id can equal the total a reply is checked for. */
const GAME_ID_BASE = 101;

/**
 * A synthetic tool result of exactly `length` chars: numbered game records for
 * other teams (deterministic scores, never the total) with the target team's
 * two games at 1/4 and 3/4 of the records.
 */
export function buildResultPayload(length: number): string {
  const records: string[] = [];
  let seed = 7;
  while (records.join("").length < length + 64) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    let points = seed % 97;
    if (points === RESULT_TARGET.total) points += 1;
    const i = records.length;
    records.push(`game ${i + GAME_ID_BASE}: team ${TEAMS[i % TEAMS.length]} scored ${points} points.\n`);
  }
  // Place the targets by position within the first `length` chars.
  let used = 0;
  let fit = 0;
  while (fit < records.length && used + records[fit]!.length <= length) used += records[fit++]!.length;
  const [a, b] = RESULT_TARGET.games;
  for (const [at, points] of [[Math.floor(fit / 4), a], [Math.floor((fit * 3) / 4), b]] as const) {
    records[at] = `game ${at + GAME_ID_BASE}: team ${RESULT_TARGET.team} scored ${points} points.\n`;
  }
  return records.join("").slice(0, length);
}

/** Whether a reply states the target total anywhere. */
export function answersResultQuestion(reply: string): boolean {
  const numbers: readonly string[] = stripThinking(reply).match(/\b\d+\b/g) ?? [];
  return numbers.includes(String(RESULT_TARGET.total));
}

/**
 * Largest ladder size such that it and every smaller size passed. Sizes are
 * tried in ascending order and probing stops at the first failure.
 */
export function scoreResultSize(passedBySize: ReadonlyArray<readonly [size: number, passed: boolean]>): number {
  let best = RESULT_SIZE_FLOOR;
  for (const [size, passed] of [...passedBySize].sort((a, b) => a[0] - b[0])) {
    if (!passed) break;
    best = size;
  }
  return best;
}

// ── Discrimination gate ───────────────────────────────────────────────────────

/** Calibration fields the discrimination gate checks. */
export const GATED_FIELDS = [
  "steeringCompliance",
  "parallelCallCapability",
  "observationHandling",
  "systemPromptAttention",
  "optimalToolResultChars",
] as const;

export type GatedField = (typeof GATED_FIELDS)[number];

/** Per-field result of {@link discriminationGate}. */
export interface FieldDiscrimination {
  readonly field: GatedField;
  readonly distinct: readonly string[];
  readonly passes: boolean;
}

/** Result of {@link discriminationGate}. */
export interface DiscriminationReport {
  readonly models: number;
  readonly minModels: number;
  readonly fields: readonly FieldDiscrimination[];
  readonly passes: boolean;
}

/**
 * The gate a regenerated calibration set must pass before it is committed:
 * at least `minModels` calibrations, and every gated field takes at least 2
 * distinct values across them. A field stuck on one value across many models
 * measures the probe, not the models.
 */
export function discriminationGate(
  cals: ReadonlyArray<Pick<ModelCalibration, GatedField>>,
  minModels = 6,
): DiscriminationReport {
  const fields = GATED_FIELDS.map((field): FieldDiscrimination => {
    const distinct = [...new Set(cals.map((c) => String(c[field])))].sort();
    return { field, distinct, passes: distinct.length >= 2 };
  });
  return {
    models: cals.length,
    minModels,
    fields,
    passes: cals.length >= minModels && fields.every((f) => f.passes),
  };
}
