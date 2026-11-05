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
 * - **FiberRef** ({@link FileRootRef}) — inherited by forked fibers and
 *   independent of the scheduler. {@link bindFileRoot} copies the ALS root
 *   into it at a synchronous boundary (the run entry), so every fiber of the
 *   run sees the same root.
 *
 * {@link getFileRoot} reads the FiberRef of the current fiber first, then the
 * ALS store, then `process.cwd()` (the documented no-sandbox default).
 */
import { Effect, Fiber, FiberRef, Option } from "effect";
import { AsyncLocalStorage } from "node:async_hooks";
import * as path from "node:path";

const fileRootStore = new AsyncLocalStorage<string>();

/**
 * Run-scoped file root carried on the fiber. `undefined` = not bound; the
 * resolver then falls back to the ALS store, then `process.cwd()`.
 */
export const FileRootRef: FiberRef.FiberRef<string | undefined> = FiberRef.unsafeMake<
  string | undefined
>(undefined);

/** Run `fn` with file-read/file-write rooted at (and confined to) `root`. */
export function withFileRoot<T>(root: string, fn: () => T): T {
  return fileRootStore.run(path.resolve(root), fn);
}

/**
 * The active file root for relative-path resolution and traversal
 * confinement. Synchronous, so plain helpers can call it; inside a running
 * fiber it reads that fiber's {@link FileRootRef}.
 */
export function getFileRoot(): string {
  const fiber = Fiber.getCurrentFiber();
  if (Option.isSome(fiber)) {
    const bound = fiber.value.getFiberRef(FileRootRef);
    if (bound !== undefined) return bound;
  }
  return fileRootStore.getStore() ?? process.cwd();
}

/** The active file root as an Effect (same resolution as {@link getFileRoot}). */
export const currentFileRoot: Effect.Effect<string> = Effect.map(
  FiberRef.get(FileRootRef),
  (bound) => bound ?? fileRootStore.getStore() ?? process.cwd(),
);

/**
 * Pin the file root for `effect` and every fiber it forks.
 *
 * With an explicit `root`, binds that root. Without one, captures the root
 * active at the CALL SITE (synchronously, so the ALS store is still correct)
 * and binds it; when no root is active, `effect` is returned unchanged.
 * Call it where an ALS-rooted caller hands work to the Effect runtime, e.g.
 * `runtime.runPromise(bindFileRoot(runEffect))` inside `agent.run()`.
 */
export function bindFileRoot<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  root?: string,
): Effect.Effect<A, E, R> {
  const captured = root !== undefined ? path.resolve(root) : fileRootStore.getStore();
  return captured === undefined ? effect : Effect.locally(effect, FileRootRef, captured);
}
