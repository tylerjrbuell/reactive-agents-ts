// rax attach — watch a durable run's status/iteration live (Arc 1 Task 7).
// v1 polls the RunStore db every second via `getRun` + `latestCheckpoint`;
// journaled-SSE attach (true push, no poll) stays the server-endpoint path
// (`createRunAttachEndpoint` in `server/endpoints.ts`) for a later task.
import { Effect } from "effect";
import { RunStoreLive, RunStoreService, type RunRecord } from "@reactive-agents/runtime";
import { discoverDbPaths, TERMINAL_STATUSES } from "./ps.js";
import { box, fail, kv, muted, section } from "../ui.js";

const HELP = `
  Usage: rax attach <runId> [options]

  Poll a durable run's status/checkpoint every 1s until it reaches a
  terminal status (completed / failed). Ctrl-C to detach without waiting.

  Options:
    --db <path>    Only look for the run in this RunStore db (skips glob discovery)
    --help         Show this help
`.trimEnd();

/** Parsed `rax attach` arguments. Exactly one of `error` / `runId` is set (unless `help`). */
export interface AttachArgs {
  readonly help: boolean;
  readonly runId?: string;
  readonly db?: string;
  readonly error?: string;
}

/**
 * Parse `rax attach` args. Consumes the `--db <value>` PAIR before taking the
 * first remaining non-flag token as the runId — a bare
 * `args.find((a) => !a.startsWith("--"))` would wrongly grab the `--db` VALUE
 * as the runId when the flag precedes the positional
 * (e.g. `attach --db /tmp/x.db r-123`).
 */
export function parseAttachArgs(args: readonly string[]): AttachArgs {
  if (args.includes("--help") || args.includes("-h")) return { help: true };

  let db: string | undefined;
  let runId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--db") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        return { help: false, error: "--db requires a path argument" };
      }
      db = value;
      i++; // consume the value token so it can't be mistaken for the runId
    } else if (!arg.startsWith("--")) {
      runId ??= arg;
    }
    // Unknown --flags are tolerated, matching existing command style (inspect.ts).
  }

  if (!runId) return { help: false, error: "Usage: rax attach <runId> [--db path]" };
  return { help: false, runId, ...(db !== undefined ? { db } : {}) };
}

export interface AttachSnapshot {
  readonly db: string;
  readonly run: RunRecord;
  /** Highest checkpointed iteration for the run, or undefined before the first checkpoint. */
  readonly iteration?: number;
}

/**
 * Core testable fn: look up `runId` across `dbPaths` (first match wins — run
 * ids are content-hashed per agent+task+start-time, so collisions across
 * distinct dbs are not expected in practice). Returns undefined if the run
 * isn't found in any of them yet (e.g. attach raced the run's first write).
 */
export async function findRun(
  dbPaths: readonly string[],
  runId: string,
): Promise<AttachSnapshot | undefined> {
  for (const db of dbPaths) {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        const run = yield* store.getRun(runId);
        if (!run) return undefined;
        const checkpoint = yield* store.latestCheckpoint(runId);
        return { run, iteration: checkpoint?.iteration };
      }).pipe(Effect.provide(RunStoreLive(db))),
    );
    if (result) return { db, ...result };
  }
  return undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll-loop knobs — production defaults 1s interval / ~10s not-found grace; injectable for tests. */
export interface AttachPollOptions {
  /** Poll interval in ms (default 1000). */
  readonly pollMs?: number;
  /**
   * Consecutive not-found polls tolerated BEFORE the run is first seen
   * (default 10 ≈ 10s): a typo'd runId must error out (exit code 1), not spin
   * silently forever. Once the run HAS been seen, polling until a terminal
   * status stays unbounded — that is the whole point of attach.
   */
  readonly notFoundAttempts?: number;
}

export async function attachCommand(args: string[], opts?: AttachPollOptions): Promise<void> {
  const parsed = parseAttachArgs(args);
  if (parsed.help) {
    box(HELP, { title: " rax attach " });
    return;
  }
  if (parsed.error !== undefined || parsed.runId === undefined) {
    console.error(fail(parsed.error ?? "Usage: rax attach <runId> [--db path]"));
    process.exitCode = 1;
    return;
  }
  const runId = parsed.runId;

  const dbPaths = parsed.db !== undefined ? [parsed.db] : discoverDbPaths();
  if (dbPaths.length === 0) {
    console.error(fail("No RunStore databases found under ~/.reactive-agents/*/runs.db (or --db)."));
    process.exitCode = 1;
    return;
  }

  const pollMs = opts?.pollMs ?? 1000;
  const notFoundAttempts = opts?.notFoundAttempts ?? 10;

  console.log(section(`Attaching to ${runId}`));

  let detached = false;
  const onSigint = () => {
    detached = true;
    console.log(muted("\n  detached (Ctrl-C) — run continues in the background"));
  };
  process.once("SIGINT", onSigint);

  let lastStatus: string | undefined;
  let lastIteration: number | undefined;
  let seenOnce = false;
  let notFoundCount = 0;

  try {
    while (!detached) {
      const snapshot = await findRun(dbPaths, runId);
      if (!snapshot) {
        // Bounded only while the run has never been seen; if it existed and
        // its row later disappears (db deleted mid-attach), keep polling —
        // Ctrl-C remains the exit path for that edge.
        if (!seenOnce) {
          notFoundCount++;
          if (notFoundCount === 1) console.log(muted(`  waiting for run ${runId}...`));
          if (notFoundCount >= notFoundAttempts) {
            console.error(
              fail(
                `Run ${runId} not found in ${dbPaths.length} database(s) after ${notFoundAttempts} attempts — check the runId (rax ps --all).`,
              ),
            );
            process.exitCode = 1;
            return;
          }
        }
      } else {
        seenOnce = true;
        if (snapshot.run.status !== lastStatus) {
          console.log(kv("status", snapshot.run.status));
          lastStatus = snapshot.run.status;
        }
        if (snapshot.iteration !== undefined && snapshot.iteration !== lastIteration) {
          console.log(kv("iteration", String(snapshot.iteration)));
          lastIteration = snapshot.iteration;
        }
        if (TERMINAL_STATUSES.has(snapshot.run.status)) {
          return;
        }
      }
      await sleep(pollMs);
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
}
