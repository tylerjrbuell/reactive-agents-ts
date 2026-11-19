/**
 * Continue an interrupted run (Cortex chat and Runs). The framework leaves every run
 * that did not complete resumable in its durable store (`RunRecord.resumable`, `stop`)
 * and Cortex only renders what it recorded and calls `resumeRun` through the server:
 * the rules here are input checks, the "is Continue offered" decision and the clients.
 * Wording of why a run stopped: `run-stop.ts`. Server side:
 * `services/loop-stop-resume.ts`, `chat-resume.ts`, `loop-stopped-runs.ts` (names from
 * when only loop stops were listed; they cover every kind now).
 * Rendering: `components/ContinueStopped.svelte`, `ChatContinueCard.svelte`,
 * `components/runs/LoopStoppedRuns.svelte`.
 */
import { CORTEX_SERVER_URL } from "./constants.js";
import type { DurableRunStatus, RunStopKind, StopWire } from "./run-stop.js";

/** One resumable chat run (`GET /api/chat/sessions/:id/resumable`). */
export interface ResumableRunWire {
  /** The durable run id (`POST .../resume/:runId` takes this). */
  readonly runId: string;
  readonly task: string;
  readonly updatedAt: number;
  /** The durable row status (`running` for a crash, `paused`, `stopped`, `failed`). */
  readonly status: DurableRunStatus;
  /** Why the run is not finished: the stop's kind, `crash` when nothing wrote a stop. */
  readonly kind: RunStopKind;
  /** What it had done and what was open; absent for a crash. */
  readonly stop?: StopWire;
}

/** One interrupted desk run (`GET /api/loop-stopped-runs`; the path predates the general interrupt). */
export interface LoopStoppedRunWire {
  /** Cortex run id. */
  readonly runId: string;
  readonly agentId: string;
  readonly name: string | null;
  readonly startedAt: number;
  readonly durableRunId: string;
  /** The iteration the run stopped at (the stop's iteration). */
  readonly checkpointIteration: number;
  readonly updatedAt: number;
  readonly status: DurableRunStatus;
  readonly kind: RunStopKind;
  readonly stop?: StopWire;
}

/** The framework's default grant for one Continue (`DEFAULT_RESUME_ITERATIONS`); shown, and sent only when changed. */
export const DEFAULT_EXTRA_ITERATIONS = 10;
/** Most extra iterations one Continue may grant (the server's limit). */
export const MAX_EXTRA_ITERATIONS = 100;

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
  /** When the turn was stored (epoch ms); an assistant turn's is when its run ended. */
  readonly ts?: number;
  /** Set when the turn's run did not succeed; `ending` says how. */
  readonly runFailed?: {
    readonly ending?: "failed" | "partial" | "abstained" | "interrupted";
    readonly terminatedBy?: string | undefined;
    /** Who stopped it, when the person (or a dropped connection) did. */
    readonly interruptedBy?: string | undefined;
    /** `"pause"` when the person's stop was a Pause (absent for a Stop). */
    readonly userInterrupt?: string | undefined;
  } | undefined;
}

/**
 * The stop kind the Continue card words itself from. The person's own interrupt is what they asked for:
 * a turn they Paused reads "Paused by you" even when the stored run's stop kind says `user-stopped`
 * (the stream's abort can land after the pause and rewrite it); every other kind is the stored run's.
 */
export function continueKindOf(kind: RunStopKind, last: ContinueTurn | undefined): RunStopKind {
  const paused = last?.runFailed?.interruptedBy === "user" && last.runFailed.userInterrupt === "pause";
  return paused && kind === "user-stopped" ? "user-paused" : kind;
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
  if (last.runFailed?.terminatedBy?.startsWith("loop")) {
    return "A loop guard stopped this run. To be able to continue a run like this, turn on Durable runs with /durable.";
  }
  if (last.runFailed?.interruptedBy === "user") {
    if (last.runFailed.userInterrupt === "pause") return "You paused this reply and there is no saved run to continue from. Turn on Durable runs with /durable to pause and continue a reply.";
    return "You stopped this reply and there is no saved run to continue from. Turn on Durable runs with /durable to pause and continue a reply.";
  }
  return undefined;
}

const USER_STOP_KINDS: ReadonlySet<RunStopKind> = new Set<RunStopKind>(["user-stopped", "user-paused"]);

/**
 * The stored runs that can belong to the latest reply: ones written after the previous
 * exchange ended (an older interrupted run of the same agent is not this reply's) and,
 * for a reply the person stopped, only runs the person stopped. The framework's store
 * has no link from a streamed turn to its run, so time and kind are what tie them.
 */
function runsOfLatestReply(turns: readonly ContinueTurn[], resumable: readonly ResumableRunWire[]): ResumableRunWire[] {
  const last = turns.at(-1);
  const floor = turns.slice(0, -1).findLast((t) => t.role === "assistant")?.ts;
  const byUser = last?.runFailed?.interruptedBy === "user";
  return resumable.filter((r) => (floor === undefined || r.updatedAt >= floor) && (!byUser || USER_STOP_KINDS.has(r.kind)));
}

/**
 * The run Continue is offered for: only when no turn is in flight, the latest
 * assistant turn is a run that failed or stopped part-way (not an abstention; a turn
 * the person stopped counts: the framework keeps it resumable) and the session has
 * a resumable run of that reply to continue (the newest, `runsOfLatestReply`). A streamed
 * turn carries no run stamp, so the stored run is what links them.
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
  if (last.runFailed === undefined || ending === "abstained") return undefined;
  return runsOfLatestReply(turns, resumable).sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

/** The slice of a turn's ending the one-card rule reads. */
export interface EndingStop {
  readonly ending?: string | undefined;
  readonly terminatedBy?: string | undefined;
  readonly error?: string | undefined;
  /** Who stopped it, when the person did. */
  readonly interruptedBy?: string | undefined;
}

const STOP_REASON: Readonly<Partial<Record<RunStopKind, RegExp>>> = {
  budget: /max[_ -]?iterations?|budget/i,
  loop: /^loop|loop[_ -]detected/i,
  timeout: /time[_ -]?out|timed out/i,
};

/**
 * One card per stop: the Continue card (stop kind chip, what was done, Continue) is the more
 * specific one, so when it is offered for a turn that failed or stopped part-way for the SAME
 * reason, the generic "Run error" note under the reply is dropped. A stop for another reason
 * (an error, a different terminator) keeps its note. The turn's header badge always stays.
 */
export function endingSupersededByContinue(outcome: EndingStop, offered: RunStopKind | undefined): boolean {
  if (offered === undefined) return false;
  // The person's own Stop / Pause: the Continue card already says "Stopped by you" / "Paused by you".
  if (offered === "user-stopped" || offered === "user-paused") {
    return outcome.interruptedBy === "user" && (outcome.ending === "partial" || outcome.ending === "interrupted");
  }
  if (outcome.ending !== "failed" && outcome.ending !== "partial") return false;
  const same = STOP_REASON[offered];
  if (same === undefined) return false;
  return same.test(outcome.terminatedBy ?? outcome.error ?? "");
}

/**
 * Server answer to a Continue: the run finished (maybe stopped again), or the server's reason.
 * A desk Continue starts a NEW linked run and answers with its id (`runId`); chat answers carry none.
 */
export type ContinueResult =
  | { readonly ok: true; readonly success: boolean; readonly resumable: boolean; readonly runId?: string }
  | { readonly ok: false; readonly status: number; readonly error: string };

/** Where a desk Continue's new run is watched (`/run/<id>`), or `undefined` when the server named none. */
export const continuedRunPath = (runId: string | undefined): string | undefined =>
  runId !== undefined && runId !== "" ? `/run/${encodeURIComponent(runId)}` : undefined;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const realFetch: Fetch = (url, init) => fetch(url, init);

async function postContinue(url: string, body: ContinueBody, fetchFn: Fetch): Promise<ContinueResult> {
  try {
    const res = await fetchFn(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { error?: string; success?: boolean; resumable?: boolean; runId?: unknown };
    if (!res.ok) return { ok: false, status: res.status, error: json.error ?? `Server returned ${res.status}` };
    return { ok: true, success: json.success !== false, resumable: json.resumable === true, ...(typeof json.runId === "string" ? { runId: json.runId } : {}) };
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

/**
 * Start Continue as a live turn (`POST .../resume/:runId/start`): the run goes on in the
 * background as the session's turn and answers at once, so the page attaches to it
 * (`chatStore.resumeActiveTurn`) and the thread fills in while the run works. Never throws.
 */
export async function startChatContinue(
  sessionId: string,
  runId: string,
  body: ContinueBody,
  fetchFn: Fetch = realFetch,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly status: number; readonly error: string }> {
  try {
    const url = `${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}/resume/${encodeURIComponent(runId)}/start`;
    const res = await fetchFn(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, status: res.status, error: json.error ?? `Server returned ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
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
