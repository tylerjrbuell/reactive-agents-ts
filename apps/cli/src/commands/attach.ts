// rax attach — watch a durable run's status/iteration live (Arc 1 Task 7).
// v1 polls the RunStore db every second via `getRun` + `latestCheckpoint`;
// journaled-SSE attach (true push, no poll) stays the server-endpoint path
// (`createRunAttachEndpoint` in `server/endpoints.ts`) for a later task.
import { Effect } from "effect";
import { RunStoreLive, RunStoreService, type RunRecord } from "@reactive-agents/runtime";
import { discoverDbPaths } from "./ps.js";
import { box, fail, kv, muted, section } from "../ui.js";

const HELP = `
  Usage: rax attach <runId> [options]

  Poll a durable run's status/checkpoint every 1s until it reaches a
  terminal status (completed / failed). Ctrl-C to detach without waiting.

  Options:
    --db <path>    Only look for the run in this RunStore db (skips glob discovery)
    --help         Show this help
`.trimEnd();

/** Statuses that end the attach loop — the only two terminal values in `RunStatus`. */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["completed", "failed"]);

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

export async function attachCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    box(HELP, { title: " rax attach " });
    return;
  }

  const runId = args.find((arg) => !arg.startsWith("--"));
  if (!runId) {
    console.error(fail("Usage: rax attach <runId> [--db path]"));
    process.exitCode = 1;
    return;
  }

  const dbFlagIndex = args.indexOf("--db");
  const dbOverride = dbFlagIndex >= 0 ? args[dbFlagIndex + 1] : undefined;
  if (dbFlagIndex >= 0 && !dbOverride) {
    console.error(fail("--db requires a path argument"));
    process.exitCode = 1;
    return;
  }

  const dbPaths = dbOverride ? [dbOverride] : discoverDbPaths();
  if (dbPaths.length === 0) {
    console.error(fail("No RunStore databases found under ~/.reactive-agents/*/runs.db (or --db)."));
    process.exitCode = 1;
    return;
  }

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

  try {
    while (!detached) {
      const snapshot = await findRun(dbPaths, runId);
      if (!snapshot) {
        if (!seenOnce) console.log(muted(`  waiting for run ${runId}...`));
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
      await sleep(1000);
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
}
