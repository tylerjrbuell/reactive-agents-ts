/**
 * The judgment ledger of a run: every typed judgment the run asked (`JudgmentEvaluated`),
 * every ask that failed (`JudgmentFailed`) and every shadow comparison (`JudgmentShadow`),
 * folded from the framework events a run already publishes. Pure and framework-free: any
 * run or chat UI can render the result.
 *
 * What the events carry (core `judgment-events.ts`), and so what a row can show:
 * - `JudgmentEvaluated`: `site`, `backend`, and one answer per question id with its kind,
 *   `value` (for Noul the probability, for Score the score, for Choice the chosen option),
 *   optional `confidence` and `calibrated`, plus `latencyMs`. It does NOT carry the question
 *   text, so a row names its question by id and kind only. `site` is the runtime layer's
 *   constant (`agent.judge`) today; the real harness site appears on shadow rows.
 * - `JudgmentFailed`: `site`, `backend`, `errorTag`, `message`, `latencyMs`.
 * - `JudgmentShadow`: `site`, the `judged` answer, the `current` decision, `agreement`,
 *   `confidence`. No backend or latency.
 *
 * None of these events carries a `taskId` or any id that ties it to a call, so rows are in
 * event order and an ask is not matched to its shadow comparison.
 */

/** Event tags the ledger reads. */
export const JUDGMENT_EVENT_TAGS: readonly string[] = ["JudgmentEvaluated", "JudgmentFailed", "JudgmentShadow"];

/**
 * An answer whose confidence is below this reads as low confidence. A display threshold only:
 * the framework has no single floor (each harness site picks its own), so this flags a row for
 * a person to look at, nothing more.
 */
export const LOW_JUDGMENT_CONFIDENCE = 0.6;

/** What a ledger row is. */
export type JudgmentRowKind = "answer" | "failure" | "shadow";

/** The question kinds a judgment backend answers. */
export type JudgmentQuestionKind = "noul" | "choice" | "score";

/** One ledger row. */
export interface JudgmentRow {
  /** Stable within a run: the event's position plus the answer's position in it. */
  readonly id: string;
  readonly kind: JudgmentRowKind;
  readonly ts: number;
  /** Which consumer asked (see the module note on `agent.judge`). */
  readonly site: string;
  /** Which backend answered or failed (`jev`, `ollama`, `llm`); absent on shadow rows. */
  readonly backend?: string;
  /** Question id of an answer row. */
  readonly questionId?: string;
  readonly questionKind?: JudgmentQuestionKind;
  /** The answer as reported: a Noul probability, a Score value or the Choice made. */
  readonly answer?: string | number | boolean;
  /** Noul probability (0-1), when the answer is a Noul. */
  readonly probability?: number;
  /** Score value, when the answer is a Score. */
  readonly score?: number;
  readonly confidence?: number;
  /** `false` = an uncalibrated answer (LLM emulation); absent when the backend did not say. */
  readonly calibrated?: boolean;
  readonly latencyMs?: number;
  /** Failure rows: the `JudgmentError` tag and message. */
  readonly errorTag?: string;
  readonly message?: string;
  /** Shadow rows: the judged answer (null = the call failed), the decision used, and whether they agree. */
  readonly judged?: string | null;
  readonly current?: string;
  readonly agreement?: boolean | null;
  /** The answer's confidence is below {@link LOW_JUDGMENT_CONFIDENCE}. */
  readonly lowConfidence: boolean;
  /** The answer is reported uncalibrated. */
  readonly uncalibrated: boolean;
}

/** A run's judgments. */
export interface JudgmentLedger {
  readonly rows: readonly JudgmentRow[];
  /** Asks answered plus asks that failed: the run's judgments. Shadow comparisons are not counted. */
  readonly judgments: number;
  /** Asks that failed. */
  readonly failed: number;
  /** Answered asks with a low-confidence or uncalibrated answer. */
  readonly degraded: number;
  /** Shadow comparisons recorded. */
  readonly shadow: number;
  /** Shadow comparisons where the judged answer and the decision used disagreed. */
  readonly shadowDisagreements: number;
}

/** An event as Cortex and the bindings carry it. */
export interface JudgmentEventLike {
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly ts: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const isQuestionKind = (v: unknown): v is JudgmentQuestionKind => v === "noul" || v === "choice" || v === "score";

function answerRow(eventIndex: number, answerIndex: number, ts: number, p: Record<string, unknown>, a: Record<string, unknown>): JudgmentRow | undefined {
  const questionKind = isQuestionKind(a.kind) ? a.kind : undefined;
  const value = typeof a.value === "string" || typeof a.value === "number" || typeof a.value === "boolean" ? a.value : undefined;
  const confidence = num(a.confidence);
  const calibrated = typeof a.calibrated === "boolean" ? a.calibrated : undefined;
  const latencyMs = num(p.latencyMs);
  const backend = str(p.backend);
  return {
    id: `${eventIndex}:${answerIndex}`,
    kind: "answer",
    ts,
    site: str(p.site) ?? "unknown",
    ...(backend ? { backend } : {}),
    ...(str(a.id) ? { questionId: str(a.id) as string } : {}),
    ...(questionKind ? { questionKind } : {}),
    ...(value !== undefined ? { answer: value } : {}),
    ...(questionKind === "noul" && typeof value === "number" ? { probability: value } : {}),
    ...(questionKind === "score" && typeof value === "number" ? { score: value } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(calibrated !== undefined ? { calibrated } : {}),
    ...(latencyMs !== undefined ? { latencyMs } : {}),
    lowConfidence: confidence !== undefined && confidence < LOW_JUDGMENT_CONFIDENCE,
    uncalibrated: calibrated === false,
  };
}

/**
 * Fold a run's events into its judgment ledger. Events of other kinds are skipped; a
 * malformed judgment event adds no row. Rows are in event order.
 */
export function foldJudgments(events: readonly JudgmentEventLike[]): JudgmentLedger {
  const rows: JudgmentRow[] = [];
  let judgments = 0;
  let failed = 0;
  let degraded = 0;
  let shadow = 0;
  let shadowDisagreements = 0;

  events.forEach((ev, i) => {
    if (!JUDGMENT_EVENT_TAGS.includes(ev.type) || !isRecord(ev.payload)) return;
    const p = ev.payload;

    if (ev.type === "JudgmentEvaluated") {
      const answers = Array.isArray(p.answers) ? p.answers.filter(isRecord) : [];
      judgments += 1;
      let askDegraded = false;
      answers.forEach((a, j) => {
        const row = answerRow(i, j, ev.ts, p, a);
        if (!row) return;
        rows.push(row);
        if (row.lowConfidence || row.uncalibrated) askDegraded = true;
      });
      if (askDegraded) degraded += 1;
      return;
    }

    if (ev.type === "JudgmentFailed") {
      judgments += 1;
      failed += 1;
      const backend = str(p.backend);
      const latencyMs = num(p.latencyMs);
      rows.push({
        id: `${i}:0`,
        kind: "failure",
        ts: ev.ts,
        site: str(p.site) ?? "unknown",
        ...(backend ? { backend } : {}),
        errorTag: str(p.errorTag) ?? "unknown",
        message: str(p.message) ?? "",
        ...(latencyMs !== undefined ? { latencyMs } : {}),
        lowConfidence: false,
        uncalibrated: false,
      });
      return;
    }

    // JudgmentShadow
    shadow += 1;
    const confidence = num(p.confidence);
    const agreement = typeof p.agreement === "boolean" ? p.agreement : p.agreement === null ? null : undefined;
    if (agreement === false) shadowDisagreements += 1;
    rows.push({
      id: `${i}:0`,
      kind: "shadow",
      ts: ev.ts,
      site: str(p.site) ?? "unknown",
      ...(typeof p.judged === "string" || p.judged === null ? { judged: p.judged } : {}),
      ...(str(p.current) ? { current: str(p.current) as string } : {}),
      ...(agreement !== undefined ? { agreement } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      lowConfidence: confidence !== undefined && confidence < LOW_JUDGMENT_CONFIDENCE,
      uncalibrated: false,
    });
  });

  return { rows, judgments, failed, degraded, shadow, shadowDisagreements };
}

/** The run-header badge: `N judgments, K failed or degraded`. */
export interface JudgmentBadge {
  readonly text: string;
  /** `bad` when any ask failed, `warn` when only low-confidence or uncalibrated answers, else `neutral`. */
  readonly tone: "neutral" | "warn" | "bad";
}

/**
 * The header badge for a ledger, or `null` when the run asked nothing (shadow comparisons alone
 * keep the header clean; the tab still lists them).
 */
export function judgmentBadgeOf(ledger: JudgmentLedger): JudgmentBadge | null {
  if (ledger.judgments === 0) return null;
  const noun = ledger.judgments === 1 ? "judgment" : "judgments";
  const flagged = ledger.failed + ledger.degraded;
  return {
    text: flagged > 0 ? `${ledger.judgments} ${noun}, ${flagged} failed or degraded` : `${ledger.judgments} ${noun}`,
    tone: ledger.failed > 0 ? "bad" : ledger.degraded > 0 ? "warn" : "neutral",
  };
}
