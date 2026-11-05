/**
 * File-root sandbox: the directory file-read / file-write / file-edit /
 * list-directory / grep resolve RELATIVE paths against, and confine every
 * path to.
 *
 * Two carriers, because neither alone survives every boundary:
 *
 * - **AsyncLocalStorage** ({@link withFileRoot}) — set by plain-JS callers
 *   (the benchmark harness wraps `agent.run()` in it). Reliable across native
 *   `await`, but NOT across Effect's scheduler: Effect batches fiber
 *   resumptions into one drain, and that drain runs in the ALS context of
 *   whichever fiber started it. Any fiber running outside the root (a daemon,
 *   a leftover from an earlier run) poisons the context, and the tool sees no
 *   root at all. It then fell back to `process.cwd()`, so a benchmark agent's
 *   `parseDate.test.ts` landed at the repo root.
 *
 * - **Run slot** ({@link fileRootSlot}) — carried by the run scope, inherited
 *   by forked fibers and independent of the scheduler. The run entry reads
 *   {@link capturedFileRoot} at a synchronous boundary (where the ALS store is
 *   still correct) and binds it into the slot, so every fiber of the run sees
 *   the same root. Policy `inherit`: sub-agents keep the parent's root.
 *
 * {@link getFileRoot} reads the slot first, then the ALS store, then
 * `process.cwd()` (the documented no-sandbox default).
 */
import { Effect } from "effect";
import { getRunSlot, getRunSlotSync, runSlot, type RunSlot } from "@reactive-agents/core/internal/run-scope";
import { AsyncLocalStorage } from "node:async_hooks";
import * as path from "node:path";

const fileRootStore = new AsyncLocalStorage<string>();

/**
 * Run slot for the file root. `undefined` = not bound; the resolver then
 * falls back to the ALS store, then `process.cwd()`. Bind an ABSOLUTE path.
 */
export const fileRootSlot: RunSlot<string | undefined> = runSlot<string | undefined>("tools.fileRoot", {
  child: "inherit",
  initial: undefined,
});

/** Run `fn` with file-read/file-write rooted at (and confined to) `root`. */
export function withFileRoot<T>(root: string, fn: () => T): T {
  return fileRootStore.run(path.resolve(root), fn);
}

/**
 * The ALS root active at the CALL SITE (synchronous read), or `undefined`
 * when none. The run entry calls this where an ALS-rooted caller hands work
 * to the Effect runtime and binds the result into {@link fileRootSlot}.
 */
export function capturedFileRoot(): string | undefined {
  return fileRootStore.getStore();
}

/**
 * The active file root for relative-path resolution and traversal
 * confinement. Synchronous, so plain helpers can call it; inside a running
 * fiber it reads that run's {@link fileRootSlot}.
 */
export function getFileRoot(): string {
  return getRunSlotSync(fileRootSlot) ?? fileRootStore.getStore() ?? process.cwd();
}

/** The active file root as an Effect (same resolution as {@link getFileRoot}). */
export const currentFileRoot: Effect.Effect<string> = Effect.map(
  getRunSlot(fileRootSlot),
  (bound) => bound ?? fileRootStore.getStore() ?? process.cwd(),
);
