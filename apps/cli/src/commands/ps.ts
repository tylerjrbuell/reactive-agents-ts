// rax ps — process-model listing over the durable RunStore substrate (Arc 1
// Task 7). Scans every `~/.reactive-agents/*/runs.db` (or a `--db` override),
// lists run rows, and by default hides every TERMINAL status (`completed` /
// `failed` — the only two terminal values in `RunStatus`; `paused`,
// `awaiting-approval`, and `awaiting-interaction` are non-terminal: the run is
// alive, just blocked on a resume/decision). `--all` includes the terminal
// ones too.
import { Effect } from "effect";
import { existsSync, globSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { listDurableRuns, type RunRecord } from "@reactive-agents/runtime";
import { box, fail, muted, section } from "../ui.js";

const HELP = `
  Usage: rax ps [options]

  List durable runs across ~/.reactive-agents/*/runs.db (or --db).

  Options:
    --db <path>    Only scan this RunStore db (skips glob discovery)
    --all          Include terminal runs (completed / failed)
    --help         Show this help
`.trimEnd();

/** One row of `rax ps` output — a `RunRecord` projected + tagged with its source db. */
export interface PsRow {
  readonly runId: string;
  readonly agentId: string;
  readonly status: string;
  readonly task: string;
  readonly updatedAt: number;
  readonly db: string;
  readonly forkedFrom?: string;
  readonly forkedAtIteration?: number;
}

/** Statuses hidden by default — the only two terminal values in `RunStatus`. */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["completed", "failed"]);

/**
 * Default DB discovery: every `runs.db` under `~/.reactive-agents/<agentId>/`
 * (mirrors the write-side default in `execute-stream.ts`). `globSync` throws
 * ENOENT when the base directory doesn't exist yet (fresh machine, no durable
 * run ever recorded) — swallow that as "no runs anywhere" rather than a CLI
 * crash. Falls back to a manual `readdirSync` walk if `globSync` is ever
 * unavailable in a pinned Bun/Node version.
 */
export function discoverDbPaths(): string[] {
  const base = join(homedir(), ".reactive-agents");
  if (!existsSync(base)) return [];
  const pattern = join(base, "*", "runs.db");
  try {
    return globSync(pattern);
  } catch {
    // Fallback: manual directory walk (readdirSync + existsSync per subdir).
    const paths: string[] = [];
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dbPath = join(base, entry.name, "runs.db");
      if (existsSync(dbPath)) paths.push(dbPath);
    }
    return paths;
  }
}

/** Core testable fn: scan the given db paths and project rows, applying the terminal-status filter. */
export async function collectRuns(
  dbPaths: readonly string[],
  opts: { all: boolean },
): Promise<PsRow[]> {
  const rows: PsRow[] = [];
  for (const db of dbPaths) {
    const runs: readonly RunRecord[] = await Effect.runPromise(listDurableRuns({ dbPath: db }));
    for (const r of runs) {
      if (!opts.all && TERMINAL_STATUSES.has(r.status)) continue;
      rows.push({
        runId: r.runId,
        agentId: r.agentId,
        status: r.status,
        task: r.task.length > 60 ? `${r.task.slice(0, 57)}...` : r.task,
        updatedAt: r.updatedAt,
        db,
        ...(r.forkedFrom !== undefined ? { forkedFrom: r.forkedFrom } : {}),
        ...(r.forkedAtIteration !== undefined ? { forkedAtIteration: r.forkedAtIteration } : {}),
      });
    }
  }
  // Newest-updated first, across all scanned dbs.
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function psCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    box(HELP, { title: " rax ps " });
    return;
  }

  const all = args.includes("--all");
  const dbFlagIndex = args.indexOf("--db");
  const dbOverride = dbFlagIndex >= 0 ? args[dbFlagIndex + 1] : undefined;

  if (dbFlagIndex >= 0 && !dbOverride) {
    console.error(fail("--db requires a path argument"));
    process.exitCode = 1;
    return;
  }

  const dbPaths = dbOverride ? [dbOverride] : discoverDbPaths();

  if (dbPaths.length === 0) {
    console.log(muted("No RunStore databases found under ~/.reactive-agents/*/runs.db (or --db)."));
    return;
  }

  const rows = await collectRuns(dbPaths, { all });

  if (rows.length === 0) {
    console.log(muted(all ? "No runs recorded." : "No active runs. Pass --all to include completed/failed."));
    return;
  }

  console.log(section("Runs"));
  console.log(
    `  ${"RUN ID".padEnd(16)} ${"STATUS".padEnd(20)} ${"AGENT".padEnd(16)} TASK`,
  );
  for (const r of rows) {
    const forkNote = r.forkedFrom ? ` [FORKED-FROM ${r.forkedFrom}@${r.forkedAtIteration ?? "?"}]` : "";
    console.log(
      `  ${r.runId.padEnd(16)} ${r.status.padEnd(20)} ${r.agentId.padEnd(16)} ${r.task}${forkNote}`,
    );
  }
}
