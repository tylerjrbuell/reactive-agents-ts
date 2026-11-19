/**
 * Continue an interrupted run: the pure rules Cortex puts around the framework's
 * `agent.resumeRun(runId, { note?, extraIterations? })`.
 *
 * Any durable run that did not complete is left resumable in the durable store:
 * its `RunRecord` carries `resumable: true` and, once it ended, `stop` (kind:
 * user-paused, user-stopped, loop, budget, timeout, error; what was done; what
 * is unfinished). A crash writes no stop (kind `crash`: the row stays `running`
 * with a checkpoint). Cortex owns no resume logic: it reads those records,
 * validates what the person typed, calls the framework, and maps the
 * framework's typed failures onto plain 4xx wording. The chat path
 * (`chat-resume.ts`) and the desk-run path (`loop-stopped-runs.ts`, a name that
 * predates the general interrupt; it now lists every kind) share this.
 */
import type { ResumeRunOptions, RunRecord, RunStopKind, RunStopSummary, RunStoreStatus } from "@reactive-agents/runtime";

/** One resumable run, as the REST API returns it. */
export interface ResumableRunWire {
  /** The durable run id (`resumeRun` takes this). */
  readonly runId: string;
  readonly task: string;
  readonly updatedAt: number;
  /** The durable row status (`running` for a crash, `paused`, `stopped`, `failed`). */
  readonly status: RunStoreStatus;
  /** Why the run is not finished: the stop's kind, or `crash` when nothing wrote a stop. */
  readonly kind: RunStopKind;
  /** What the run had done and what was open, when the framework recorded a stop. */
  readonly stop?: RunStopSummary;
  /** The run this one continues, when it is itself a Continue's new run. */
  readonly continuedFrom?: string;
}

/** Most extra iterations one Continue may grant (the framework default is 10). */
export const MAX_EXTRA_ITERATIONS = 100;
/** Longest note one Continue accepts, in characters. */
export const MAX_RESUME_NOTE_CHARS = 2_000;

/**
 * The resumable runs among a store's records (`resumable === true`, any kind of
 * interruption), newest first. `liveRunIds` (`agent.activeRunIds()` of the live
 * agent) are left out: a `running` row with a checkpoint reads resumable, and
 * only that list tells a crash from a run going right now. A run waiting on a
 * person or finished normally is never resumable. A run that already has a
 * continuation (another record's `continuedFrom`, `resumeRun({ newRun: true })`)
 * is left out too: the framework leaves the parent's record untouched, so
 * without this a Continue would offer the parent again beside its child.
 */
export function resumableRunsOf(records: readonly RunRecord[], liveRunIds: readonly string[] = []): ResumableRunWire[] {
  const continued = new Set(records.flatMap((r) => (r.continuedFrom !== undefined ? [r.continuedFrom] : [])));
  return records
    .flatMap((r): ResumableRunWire[] =>
      r.resumable === true && !liveRunIds.includes(r.runId) && !continued.has(r.runId)
        ? [
            {
              runId: r.runId,
              task: r.task,
              updatedAt: r.updatedAt,
              status: r.status,
              // A summary from before kinds existed is a loop stop; no summary at all is a crash.
              kind: r.stop === undefined ? "crash" : (r.stop.kind ?? "loop"),
              ...(r.stop !== undefined ? { stop: r.stop } : {}),
              ...(r.continuedFrom !== undefined ? { continuedFrom: r.continuedFrom } : {}),
            },
          ]
        : [],
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** What a Continue request may carry. */
export interface ResumeInputBody {
  readonly note?: unknown;
  readonly extraIterations?: unknown;
}

/** A validated Continue request, or the reason it was refused (HTTP 400). */
export type ParsedResumeInput =
  | { readonly ok: true; readonly options: ResumeRunOptions }
  | { readonly ok: false; readonly error: string };

/**
 * Validate a Continue request. An empty note and an absent `extraIterations`
 * are left out so the framework's own defaults (+10 iterations) apply: Cortex
 * never re-defaults them.
 */
export function parseResumeInput(body: ResumeInputBody | null | undefined): ParsedResumeInput {
  const note = body?.note;
  const extra = body?.extraIterations;
  if (note !== undefined && typeof note !== "string") return { ok: false, error: "note must be text" };
  const trimmed = note?.trim() ?? "";
  if (trimmed.length > MAX_RESUME_NOTE_CHARS) {
    return { ok: false, error: `The note is too long (${trimmed.length} characters; the limit is ${MAX_RESUME_NOTE_CHARS}).` };
  }
  if (extra !== undefined) {
    if (typeof extra !== "number" || !Number.isInteger(extra) || extra < 1 || extra > MAX_EXTRA_ITERATIONS) {
      return { ok: false, error: `extraIterations must be a whole number from 1 to ${MAX_EXTRA_ITERATIONS}.` };
    }
  }
  return {
    ok: true,
    options: {
      ...(trimmed.length > 0 ? { note: trimmed } : {}),
      ...(typeof extra === "number" ? { extraIterations: extra } : {}),
    },
  };
}

/** The chat message a Continue lands in the thread as: the person's note, or a bare "Continue". */
export const continueMessage = (note: string | undefined): string => {
  const n = note?.trim() ?? "";
  return n.length > 0 ? `Continue: ${n}` : "Continue";
};

/** Why a Continue was refused, with the HTTP status the route answers. */
export interface ResumeFailure {
  readonly code: "not-found" | "not-resumable" | "busy" | "failed";
  readonly message: string;
}

const tagOf = (e: unknown): string | undefined => {
  if (typeof e !== "object" || e === null) return undefined;
  const tag: unknown = Reflect.get(e, "_tag");
  return typeof tag === "string" ? tag : undefined;
};

/** The text of anything thrown: its `message` when it has one, else its string form (no `instanceof`). */
export const errorText = (e: unknown): string => {
  const message: unknown = typeof e === "object" && e !== null ? Reflect.get(e, "message") : undefined;
  return typeof message === "string" ? message : String(e);
};

/**
 * Map what `resumeRun` threw onto plain wording. The framework's typed errors
 * (`RunNotResumableError`, `DurableRunNotFoundError`, `DurableConfigMismatchError`)
 * become 4xx outcomes a person can act on; anything else is a `failed` 422 with
 * its own message.
 */
export function resumeFailureOf(e: unknown): ResumeFailure {
  switch (tagOf(e)) {
    case "RunNotResumableError":
      return {
        code: "not-resumable",
        message: "This run finished or was already continued, so there is nothing to continue. Send a new message instead.",
      };
    case "DurableRunNotFoundError":
      return { code: "not-found", message: "That run is no longer in the saved run store." };
    case "DurableConfigMismatchError":
      return {
        code: "not-resumable",
        message: "The agent's setup (model, tools or settings) changed after this run stopped, so it cannot be continued safely. Send a new message instead.",
      };
    default:
      return { code: "failed", message: errorText(e) };
  }
}

/** HTTP status of a refused Continue. */
export const resumeStatusOf = (code: ResumeFailure["code"]): 404 | 409 | 422 =>
  code === "not-found" ? 404 : code === "busy" || code === "not-resumable" ? 409 : 422;

/**
 * Single-flight guard per run: a second Continue tap while the first is still
 * running is refused rather than resuming the run twice.
 */
export class ResumeGuard {
  private readonly live = new Set<string>();

  /** Take the run's slot; `undefined` when a resume of it is already in flight. Call the returned function to free it. */
  claim(runId: string): (() => void) | undefined {
    if (this.live.has(runId)) return undefined;
    this.live.add(runId);
    return () => {
      this.live.delete(runId);
    };
  }

  /** True while a resume of this run is in flight. */
  isLive(runId: string): boolean {
    return this.live.has(runId);
  }
}
