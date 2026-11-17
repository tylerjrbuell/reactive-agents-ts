/**
 * Continue a run a loop guard stopped (Cortex chat and Runs). The framework leaves
 * such a run resumable in its durable store (`RunRecord.loopStop`) and Cortex only
 * renders what it recorded and calls `resumeRun` through the server: the rules here
 * are wording, input checks and the "is Continue offered" decision. Server side:
 * `services/loop-stop-resume.ts`, `chat-resume.ts`, `loop-stopped-runs.ts`.
 * Rendering: `components/ContinueStopped.svelte`, `ChatContinueCard.svelte`,
 * `components/runs/LoopStoppedRuns.svelte`.
 */
import { CORTEX_SERVER_URL } from "./constants.js";

/** Why a loop guard stopped a run and what it had already done (the framework's `LoopStopSummary`). */
export interface LoopStopWire {
  readonly reason: string;
  /** The tool the run kept repeating, when the trailing actions repeat one call. */
  readonly repeatedTool?: string;
  /** Tools that already returned substantive results (not re-run on Continue), with call counts. */
  readonly toolsDone: readonly { readonly tool: string; readonly calls: number }[];
  /** Titles of checklist rows still open at the stop. */
  readonly unfinished: readonly string[];
  /** The iteration the run stopped at. */
  readonly iteration: number;
}

/** One resumable chat run (`GET /api/chat/sessions/:id/resumable`). */
export interface ResumableRunWire {
  /** The durable run id (`POST .../resume/:runId` takes this). */
  readonly runId: string;
  readonly task: string;
  readonly updatedAt: number;
  readonly loopStop: LoopStopWire;
}

/** One loop-stopped desk run (`GET /api/loop-stopped-runs`). */
export interface LoopStoppedRunWire {
  /** Cortex run id. */
  readonly runId: string;
  readonly agentId: string;
  readonly name: string | null;
  readonly startedAt: number;
  readonly durableRunId: string;
  /** The loop the run stopped at (the stop's iteration). */
  readonly checkpointIteration: number;
  readonly updatedAt: number;
  readonly loopStop: LoopStopWire;
}

/** The framework's default grant for one Continue (`DEFAULT_RESUME_ITERATIONS`); shown, and sent only when changed. */
export const DEFAULT_EXTRA_ITERATIONS = 10;
/** Most extra iterations one Continue may grant (the server's limit). */
export const MAX_EXTRA_ITERATIONS = 100;

/** The stop reason in plain words: what the loop guard saw, not its internal name. */
export function loopStopHeadline(stop: Pick<LoopStopWire, "reason">): string {
  const r = stop.reason;
  if (r.startsWith("loop_detected")) return "The agent kept repeating the same step, so it was stopped.";
  if (r === "loop_graceful") return "The agent was going in circles, so it was stopped.";
  if (r === "dispatcher-early-stop") return "The run was stopped early because it was not making progress.";
  return `The run was stopped (${r}).`;
}

const DONE_SHOWN = 6;
const LEFT_SHOWN = 5;

/** One labelled group of the stop card: a short list of mono values or titles. */
export interface LoopStopFact {
  readonly label: string;
  readonly items: readonly string[];
  /** Values are tool names (machine text) rather than prose. */
  readonly mono: boolean;
}

const capped = (all: readonly string[], shown: number): string[] =>
  all.length > shown ? [...all.slice(0, shown), `and ${all.length - shown} more`] : [...all];

/**
 * What the stop card lists under its headline: the tool it repeated, the tools
 * already done (not re-run on Continue) and the rows still open. Empty groups
 * are left out.
 */
export function loopStopFacts(stop: LoopStopWire): LoopStopFact[] {
  const facts: LoopStopFact[] = [];
  if (stop.repeatedTool) facts.push({ label: "Kept repeating", items: [stop.repeatedTool], mono: true });
  if (stop.toolsDone.length > 0) {
    facts.push({
      label: "Already done",
      items: capped(stop.toolsDone.map((t) => (t.calls > 1 ? `${t.tool} x${t.calls}` : t.tool)), DONE_SHOWN),
      mono: true,
    });
  }
  if (stop.unfinished.length > 0) facts.push({ label: "Left to do", items: capped(stop.unfinished, LEFT_SHOWN), mono: false });
  return facts;
}

/** The iteration grant a person typed, or why it is not usable. */
export type ParsedExtra = { readonly ok: true; readonly value: number } | { readonly ok: false; readonly error: string };

/** Parse the "more steps" field: empty means the default; otherwise a whole number from 1 to the limit. */
export function parseExtraIterations(text: string): ParsedExtra {
  const t = text.trim();
  if (t === "") return { ok: true, value: DEFAULT_EXTRA_ITERATIONS };
  const n = Number(t);
  if (!Number.isInteger(n) || n < 1 || n > MAX_EXTRA_ITERATIONS) {
    return { ok: false, error: `Use a whole number from 1 to ${MAX_EXTRA_ITERATIONS}.` };
  }
  return { ok: true, value: n };
}

/** What a Continue request carries. The default grant is left out so the framework's own default applies. */
export interface ContinueBody {
  readonly note?: string;
  readonly extraIterations?: number;
}

/** The request body for a note and an iteration field, or the input error to show. */
export function continueBody(note: string, extraText: string): { readonly ok: true; readonly body: ContinueBody } | { readonly ok: false; readonly error: string } {
  const extra = parseExtraIterations(extraText);
  if (!extra.ok) return extra;
  const n = note.trim();
  return {
    ok: true,
    body: {
      ...(n.length > 0 ? { note: n } : {}),
      ...(extra.value !== DEFAULT_EXTRA_ITERATIONS ? { extraIterations: extra.value } : {}),
    },
  };
}

/** The slice of a chat turn the Continue decision reads. */
export interface ContinueTurn {
  readonly role: "user" | "assistant";
  readonly streaming?: boolean;
  /** Set when the turn's run did not succeed; `ending` says how. */
  readonly runFailed?: { readonly ending?: "failed" | "partial" | "abstained" | "interrupted"; readonly terminatedBy?: string | undefined } | undefined;
}

/**
 * A one-line hint for a latest turn a loop guard ended when there is nothing to continue
 * (after the stored-run lookup): Continue needs the agent's Durable execution setting.
 * `undefined` when Continue is offered, the lookup is not done, or the turn was not a loop stop.
 */
export function loopStopHint(
  turns: readonly ContinueTurn[],
  sending: boolean,
  target: ResumableRunWire | undefined,
  lookedUp: boolean,
): string | undefined {
  if (sending || !lookedUp || target !== undefined) return undefined;
  const last = turns.at(-1);
  if (last?.role !== "assistant" || last.streaming === true) return undefined;
  if (!last.runFailed?.terminatedBy?.startsWith("loop")) return undefined;
  return "A loop guard stopped this run. To be able to continue a run like this, turn on Durable execution for this agent (Lab · Execution).";
}

/**
 * The run Continue is offered for: only when no turn is in flight, the latest
 * assistant turn is a run that failed or stopped part-way (not an abstention and
 * not one the person stopped), and the session has a loop-stopped run to continue
 * (the newest). A streamed turn carries no run stamp, so the stored run is what
 * links them.
 */
export function continueTarget(
  turns: readonly ContinueTurn[],
  sending: boolean,
  resumable: readonly ResumableRunWire[],
): ResumableRunWire | undefined {
  if (sending || resumable.length === 0) return undefined;
  const last = turns.at(-1);
  if (last?.role !== "assistant" || last.streaming === true) return undefined;
  const ending = last.runFailed?.ending;
  if (last.runFailed === undefined || ending === "abstained" || ending === "interrupted") return undefined;
  return [...resumable].sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

/** Server answer to a Continue: the run finished (maybe stopped again), or the server's reason. */
export type ContinueResult =
  | { readonly ok: true; readonly success: boolean; readonly resumable: boolean }
  | { readonly ok: false; readonly status: number; readonly error: string };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const realFetch: Fetch = (url, init) => fetch(url, init);

async function postContinue(url: string, body: ContinueBody, fetchFn: Fetch): Promise<ContinueResult> {
  try {
    const res = await fetchFn(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { error?: string; success?: boolean; resumable?: boolean };
    if (!res.ok) return { ok: false, status: res.status, error: json.error ?? `Server returned ${res.status}` };
    return { ok: true, success: json.success !== false, resumable: json.resumable === true };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** A session's loop-stopped runs; `[]` on any failure (Continue is then simply not offered). */
export async function fetchChatResumable(sessionId: string, fetchFn: Fetch = realFetch): Promise<ResumableRunWire[]> {
  try {
    const res = await fetchFn(`${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}/resumable`);
    if (!res.ok) return [];
    return ((await res.json()) as { runs?: ResumableRunWire[] }).runs ?? [];
  } catch {
    return [];
  }
}

/** Continue a chat turn's loop-stopped run; the reply lands in the thread server side. Never throws. */
export function continueChatRun(sessionId: string, runId: string, body: ContinueBody, fetchFn: Fetch = realFetch): Promise<ContinueResult> {
  return postContinue(`${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}/resume/${encodeURIComponent(runId)}`, body, fetchFn);
}

/** Desk runs a loop guard stopped; `[]` on any failure. */
export async function fetchLoopStoppedRuns(fetchFn: Fetch = realFetch): Promise<LoopStoppedRunWire[]> {
  try {
    const res = await fetchFn(`${CORTEX_SERVER_URL}/api/loop-stopped-runs`);
    if (!res.ok) return [];
    return ((await res.json()) as { runs?: LoopStoppedRunWire[] }).runs ?? [];
  } catch {
    return [];
  }
}

/** Continue a loop-stopped desk run (same Cortex run; it starts and runs on). Never throws. */
export function continueDeskRun(runId: string, body: ContinueBody, fetchFn: Fetch = realFetch): Promise<ContinueResult> {
  return postContinue(`${CORTEX_SERVER_URL}/api/loop-stopped-runs/${encodeURIComponent(runId)}/resume`, body, fetchFn);
}
