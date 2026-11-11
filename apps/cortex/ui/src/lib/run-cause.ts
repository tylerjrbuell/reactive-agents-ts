/**
 * "Why it ended" for the run view: the client and the display rules over
 * `GET /api/runs/:runId/cause`, the framework's trace diagnosis (the engine
 * behind `rax-diagnose cause`; server `services/run-cause.ts`). Cortex only
 * words and links it here; it never re-derives a cause.
 */
import { CORTEX_SERVER_URL } from "$lib/constants.js";

/** How much the trace supports a verdict (framework `CauseConfidence`). */
export type CauseConfidence = "decisive" | "probable" | "insufficient-trace";
/** Who the trace says is at fault (framework `AttributionVerdict`). */
export type AttributionVerdict = "harness" | "model" | "environment" | "unattributed" | "not-failed";

/** One trace event behind a verdict; `loop` is the run view's 1-based trace row, `null` for run-level events. */
export interface RunCauseEvidence {
  readonly eventKind: string;
  readonly seq: number;
  readonly detail: string;
  readonly loop: number | null;
}

/** Wire shape of `GET /api/runs/:runId/cause` (server `RunCauseReport`). */
export type RunCauseReport =
  | { readonly available: false; readonly reason: "no-trace" | "not-a-run" }
  | {
      readonly available: true;
      readonly runId: string;
      readonly cause: string;
      readonly subCause?: string;
      readonly headline: string;
      readonly confidence: CauseConfidence;
      readonly outcomeStatus: string;
      readonly authority?: string;
      readonly evidence: readonly RunCauseEvidence[];
      readonly missing: readonly string[];
      readonly attribution: {
        readonly verdict: AttributionVerdict;
        readonly reason: string;
        readonly confidence: CauseConfidence;
        readonly divergenceLoop?: number;
        readonly target?: { readonly kind: "file" | "answer"; readonly ref: string };
        readonly evidence: readonly RunCauseEvidence[];
        readonly missing: readonly string[];
        readonly alsoMatched: readonly string[];
      };
    };

/** Fetch a run's diagnosis; throws on a network or server error. */
export async function fetchRunCause(runId: string, fetchImpl: (url: string) => Promise<Response> = (u) => fetch(u)): Promise<RunCauseReport> {
  const res = await fetchImpl(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/cause`);
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return (await res.json()) as RunCauseReport;
}

/**
 * The card opens by itself for a run that did not succeed (failed, abstained,
 * partial, stopped) and stays collapsed for a clean success.
 */
export function causeOpenByDefault(status: string, ending: string | undefined): boolean {
  if (ending === "abstained" || ending === "partial" || ending === "failed") return true;
  return status === "failed" || status === "stopped";
}

/** Badge tone for an outcome-neutral display of the attribution. */
export type CauseTone = "neutral" | "ok" | "warn" | "bad" | "accent" | "io";

/** Words and tone for who is at fault. */
export function attributionView(verdict: AttributionVerdict): { readonly label: string; readonly tone: CauseTone } {
  switch (verdict) {
    case "harness":
      return { label: "Harness", tone: "accent" };
    case "model":
      return { label: "Model", tone: "warn" };
    case "environment":
      return { label: "Environment", tone: "io" };
    case "not-failed":
      return { label: "Did not fail", tone: "ok" };
    default:
      return { label: "Cannot tell", tone: "neutral" };
  }
}

/** Plain words for a confidence level. */
export function confidenceLabel(c: CauseConfidence): string {
  return c === "decisive" ? "Decisive" : c === "probable" ? "Probable" : "Trace too thin to tell";
}

/** The part of an attribution reason after its owner, as words (`harness:stall-after-work` → `stall after work`). */
export function reasonWords(reason: string): string {
  const id = reason.includes(":") ? reason.slice(reason.indexOf(":") + 1) : reason;
  return id.replace(/-/g, " ");
}

/** One step the card lists: an evidence event, linkable when its loop is a trace row. */
export interface CauseStep {
  readonly key: string;
  readonly loop: number | null;
  readonly linked: boolean;
  readonly eventKind: string;
  readonly seq: number;
  readonly detail: string;
}

/**
 * The decisive steps: cause evidence first, then attribution evidence not
 * already listed (same `seq`), in that order. A step links only when its loop
 * is one of the run's trace rows (`loops`).
 */
export function causeSteps(report: RunCauseReport, loops: ReadonlySet<number>): CauseStep[] {
  if (!report.available) return [];
  const seen = new Set<number>();
  const out: CauseStep[] = [];
  for (const e of [...report.evidence, ...report.attribution.evidence]) {
    if (seen.has(e.seq)) continue;
    seen.add(e.seq);
    out.push({
      key: `${e.eventKind}#${e.seq}`,
      loop: e.loop,
      linked: e.loop !== null && loops.has(e.loop),
      eventKind: e.eventKind,
      seq: e.seq,
      detail: e.detail,
    });
  }
  return out;
}

/** The note shown when a run has no diagnosis. */
export function unavailableNote(reason: "no-trace" | "not-a-run"): string {
  return reason === "no-trace"
    ? "This run has no trace file, so it cannot be diagnosed. Runs record one when tracing is on."
    : "This trace is a direct model call, not an agent run.";
}
