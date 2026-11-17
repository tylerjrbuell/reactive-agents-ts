/**
 * Continue a loop-stopped run: the pure rules Cortex puts around the framework's
 * `agent.resumeRun(runId, { note?, extraIterations? })` (runtime 73b05b173).
 *
 * A run a loop guard ended is left resumable in the durable store: its
 * `RunRecord` carries `loopStop` (why, repeated tool, tools done, unfinished
 * rows) and `resumable: true`. Cortex owns no resume logic: it reads those
 * records, validates what the person typed, calls the framework, and maps the
 * framework's typed failures onto plain 4xx wording. The chat path
 * (`chat-resume.ts`) and the desk-run path (`loop-stopped-runs.ts`) share this.
 */
import type { LoopStopSummary, ResumeRunOptions, RunRecord } from "@reactive-agents/runtime";

/** One resumable loop-stopped run, as the REST API returns it. */
export interface ResumableRunWire {
  /** The durable run id (`resumeRun` takes this). */
  readonly runId: string;
  readonly task: string;
  readonly updatedAt: number;
  /** Why the loop guard stopped the run and what it had already done. */
  readonly loopStop: LoopStopSummary;
}

/** Most extra iterations one Continue may grant (the framework default is 10). */
export const MAX_EXTRA_ITERATIONS = 100;
/** Longest note one Continue accepts, in characters. */
export const MAX_RESUME_NOTE_CHARS = 2_000;

/**
 * The loop-stopped, resumable runs among a store's records, newest first. A run
 * waiting on a person, still running, or finished normally is never offered.
 */
export function resumableRunsOf(records: readonly RunRecord[]): ResumableRunWire[] {
  return records
    .flatMap((r) =>
      r.resumable === true && r.loopStop !== undefined
        ? [{ runId: r.runId, task: r.task, updatedAt: r.updatedAt, loopStop: r.loopStop }]
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
        message: "This run did not end on a loop stop, or it was already continued, so there is nothing to continue. Send a new message instead.",
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
