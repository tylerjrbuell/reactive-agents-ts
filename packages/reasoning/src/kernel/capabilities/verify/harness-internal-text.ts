/**
 * Harness-authored internal text: ONE definition, shared by its producer and
 * every consumer that must keep it out of user-visible output.
 *
 * The strategy-switch handoff summary is built here ({@link buildHandoffSummary})
 * and recognised here ({@link looksLikeHarnessInternalText}) from the SAME
 * marker constants, so the two cannot drift. Small models (3B) parrot the
 * prior-context summary back as their "answer"; the verifier's parrot check and
 * the result-assembly boundary both call the recogniser and substitute the
 * honest sentinel instead of shipping scaffolding.
 *
 * Pure: no kernel-state imports, no LLM, no fs.
 */

/** Header line of the handoff summary (carries the switch number). */
export const HANDOFF_HEADER = "Strategy Switch Handoff";

/** Line labels of the handoff summary, in render order. */
export const HANDOFF_LABELS = {
  previousStrategy: "Previous strategy:",
  stepsCompleted: "Steps completed:",
  failureReason: "Failure reason:",
  toolsCalled: "Tools called:",
  keyObservations: "Key observations:",
} as const;

/** Distinctive prefix of the permanently-unavailable-tools line. */
export const HANDOFF_UNAVAILABLE_PREFIX = "Permanently unavailable tools (do not retry";

/** Prefix of the synthetic carried-failure observation text. */
export const CARRIED_OBSERVATION_PREFIX = "[Carried from prior strategy]";

/** Structural fields of a strategy handoff the summary renders. */
export interface HandoffSummaryFields {
  readonly switchNumber: number;
  readonly previousStrategy: string;
  readonly stepsCompleted: number;
  readonly failureReason: string;
  readonly toolsCalled: readonly string[];
  readonly permanentlyFailedTools: readonly string[];
  readonly keyObservations: readonly string[];
}

/** Render the handoff summary block (the ONLY producer of its text). */
export function buildHandoffSummary(h: HandoffSummaryFields): string {
  return [
    `${HANDOFF_HEADER} (switch #${h.switchNumber}):`,
    `${HANDOFF_LABELS.previousStrategy} ${h.previousStrategy}`,
    `${HANDOFF_LABELS.stepsCompleted} ${h.stepsCompleted}`,
    `${HANDOFF_LABELS.failureReason} ${h.failureReason}`,
    `${HANDOFF_LABELS.toolsCalled} ${h.toolsCalled.join(", ") || "none"}`,
    h.permanentlyFailedTools.length > 0
      ? `${HANDOFF_UNAVAILABLE_PREFIX} — synthesize without them): ${h.permanentlyFailedTools.join(", ")}`
      : null,
    `${HANDOFF_LABELS.keyObservations}\n${h.keyObservations.join("\n") || "(none)"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Minimum distinct handoff labels (at line start) that mark text as a parrot. */
const MIN_LABEL_HITS = 3;

const lineStart = (marker: string): RegExp =>
  new RegExp(`^[\\s>*\\-•]*${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m");

const STRONG_MARKERS: readonly RegExp[] = [
  lineStart(HANDOFF_HEADER),
  lineStart(HANDOFF_UNAVAILABLE_PREFIX),
  lineStart(CARRIED_OBSERVATION_PREFIX),
];
const LABEL_MARKERS: readonly RegExp[] = Object.values(HANDOFF_LABELS).map(lineStart);

/**
 * True when `text` carries harness-authored internal handoff structure: any
 * strong marker (header, unavailable-tools line, carried-observation prefix)
 * at a line start, or at least {@link MIN_LABEL_HITS} distinct handoff labels
 * at line starts. A legit answer that merely MENTIONS the words mid-sentence,
 * or a report with one or two coincidentally matching labels, does not match.
 */
export function looksLikeHarnessInternalText(text: string | null | undefined): boolean {
  if (!text) return false;
  if (STRONG_MARKERS.some((re) => re.test(text))) return true;
  return LABEL_MARKERS.filter((re) => re.test(text)).length >= MIN_LABEL_HITS;
}
