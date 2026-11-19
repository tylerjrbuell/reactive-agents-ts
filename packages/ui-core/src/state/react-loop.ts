import { failureReason, shortToolName } from "./turn-steps.js";

/**
 * The ReAct loop of a turn as rows: per iteration the model's Thought, the Action(s) it took
 * (tool and compact arguments) and the Observation each returned. Derived from data a turn already
 * carries (its per-iteration text and its tool calls), so a live turn and a reloaded one draw the
 * same rows, and a strategy needs no label of its own for it. Pure and framework-free.
 *
 * Observations are one-line summaries, not the tool output: a host's tool-run view stays the place
 * to inspect arguments and results in full.
 */

/** One iteration's text: the model's thought. Matches a turn's per-iteration step (extra fields ignored). */
export interface LoopStepInput {
  readonly iteration: number;
  readonly narration?: string;
  readonly thought?: string;
}

/** A tool call as the loop needs it. A turn's tool call satisfies this. */
export interface LoopCallInput {
  readonly id: string;
  readonly name: string;
  readonly status: "running" | "done" | "failed";
  readonly iteration?: number;
  readonly args?: unknown;
  readonly result?: string;
  readonly error?: string;
  readonly durationMs?: number;
}

/** Inputs of {@link reactLoopOf}. */
export interface ReactLoopInput {
  readonly steps: readonly LoopStepInput[];
  readonly calls: readonly LoopCallInput[];
  /** The turn is over: running work is settled and a trailing text-only iteration (the answer) is not a loop row. */
  readonly ended: boolean;
  /** How to show a call's arguments (a host redacts secrets here). Default {@link compactArgs}. */
  readonly describeArgs?: (args: unknown) => string;
}

/** One tool call inside an iteration: the Action and its Observation. */
export interface LoopAction {
  readonly id: string;
  /** Full tool name. */
  readonly name: string;
  /** Display name without an MCP server prefix. */
  readonly shortName: string;
  /** Compact arguments, one line; empty when the call had none. */
  readonly args: string;
  readonly status: "running" | "done" | "failed";
  /** One-line summary of the result (done) or the failure reason (failed); absent while running or when the tool returned nothing. */
  readonly observation?: string;
  readonly durationMs?: number;
}

/** One iteration of the loop. */
export interface LoopRow {
  /** The framework's iteration number. */
  readonly iteration: number;
  /** 1-based position among the rows. */
  readonly n: number;
  /** The model's thought this iteration, one line; absent when it said nothing. */
  readonly thought?: string;
  readonly actions: readonly LoopAction[];
  /** The iteration the loop is on now (a live turn's last row). */
  readonly current: boolean;
}

/** The loop of a turn. */
export interface ReactLoop {
  readonly rows: readonly LoopRow[];
  /** Distinct tools used, short names, in first-use order. */
  readonly tools: readonly string[];
  readonly failedCalls: number;
}

const THOUGHT_CAP = 200;
const OBSERVATION_CAP = 140;
const ARGS_CAP = 80;
/** The call that delivers the answer: the answer bubble shows it, so it is no loop action. */
const ANSWER_TOOL = "final-answer";

const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const scalar = (v: unknown): string => {
  if (typeof v === "string") return v.length > 30 ? `${v.slice(0, 29)}…` : v;
  if (v === null || typeof v !== "object") return String(v);
  return Array.isArray(v) ? `[${v.length}]` : "{…}";
};

/** Tool arguments as one short line: `query="btc price", limit=5`. Not redacted: a host that shows secrets-bearing args passes its own. */
export function compactArgs(args: unknown, max = ARGS_CAP): string {
  if (args === undefined || args === null) return "";
  let text: string;
  if (typeof args === "string") text = args;
  else if (typeof args === "object" && !Array.isArray(args)) {
    text = Object.entries(args as Record<string, unknown>)
      .map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(scalar(v)) : scalar(v)}`)
      .join(", ");
  } else text = JSON.stringify(args) ?? "";
  return oneLine(text, max);
}

function actionOf(call: LoopCallInput, ended: boolean, describe: (a: unknown) => string): LoopAction {
  // A call still "running" in an ended turn never reported back: show it as failed rather than spinning forever.
  const status = call.status === "running" && ended ? "failed" : call.status;
  const observation =
    status === "failed"
      ? failureReason(call.error ?? (call.status === "running" ? "no result reported" : undefined), OBSERVATION_CAP)
      : status === "done" && call.result !== undefined && call.result.trim().length > 0
        ? oneLine(call.result, OBSERVATION_CAP)
        : undefined;
  const args = describe(call.args);
  return {
    id: call.id,
    name: call.name,
    shortName: shortToolName(call.name),
    args,
    status,
    ...(observation !== undefined ? { observation } : {}),
    ...(call.durationMs !== undefined ? { durationMs: call.durationMs } : {}),
  };
}

/**
 * The loop rows of a turn. One row per iteration that thought or acted, in order. While the turn
 * runs, the last row is `current`; once it ended, a trailing iteration with no action (the model
 * answering) is dropped, because the answer is shown on its own.
 */
export function reactLoopOf(input: ReactLoopInput): ReactLoop {
  const describe = input.describeArgs ?? compactArgs;
  const thoughts = new Map<number, string>();
  for (const s of input.steps) {
    const text = (s.narration ?? s.thought ?? "").trim();
    if (text.length > 0) thoughts.set(s.iteration, oneLine(text, THOUGHT_CAP));
  }
  const byIteration = new Map<number, LoopCallInput[]>();
  // Calls with no iteration join the last known one, so a call is never lost.
  const known = [...thoughts.keys(), ...input.calls.flatMap((c) => (c.iteration !== undefined ? [c.iteration] : []))];
  const lastKnown = known.length > 0 ? Math.max(...known) : 0;
  for (const c of input.calls) {
    if (c.name === ANSWER_TOOL) continue;
    const it = c.iteration ?? lastKnown;
    byIteration.set(it, [...(byIteration.get(it) ?? []), c]);
  }
  let iterations = [...new Set([...thoughts.keys(), ...byIteration.keys()])].sort((a, b) => a - b);
  if (input.ended) {
    const last = iterations.at(-1);
    if (last !== undefined && !byIteration.has(last)) iterations = iterations.slice(0, -1);
  }
  const rows: LoopRow[] = iterations.map((iteration, i) => {
    const thought = thoughts.get(iteration);
    return {
      iteration,
      n: i + 1,
      ...(thought !== undefined ? { thought } : {}),
      actions: (byIteration.get(iteration) ?? []).map((c) => actionOf(c, input.ended, describe)),
      current: !input.ended && i === iterations.length - 1,
    };
  });
  const all = rows.flatMap((r) => r.actions);
  return {
    rows,
    tools: [...new Set(all.map((a) => a.shortName))],
    failedCalls: all.filter((a) => a.status === "failed").length,
  };
}

/**
 * The card chip for a loop: while running, where it is ("Iteration 3 · web-search"); once over,
 * the tally ("3 iterations, 2 tools"). `undefined` when there is no row to describe.
 */
export function reactLoopChip(loop: ReactLoop, ended: boolean): string | undefined {
  const last = loop.rows.at(-1);
  if (!last) return undefined;
  if (ended) {
    const its = `${loop.rows.length} iteration${loop.rows.length === 1 ? "" : "s"}`;
    return loop.tools.length === 0 ? its : `${its}, ${loop.tools.length} tool${loop.tools.length === 1 ? "" : "s"}`;
  }
  const running = last.actions.find((a) => a.status === "running");
  return running ? `Iteration ${last.n} · ${running.shortName}` : `Iteration ${last.n}`;
}
