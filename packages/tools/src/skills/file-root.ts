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
import * as fsp from "node:fs/promises";
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

/**
 * Separator-aware containment: `candidate` is `base` itself or nested inside
 * it. A sibling that merely shares a string prefix (`/work-secret` vs `/work`)
 * is NOT within.
 */
export function isWithinRoot(base: string, candidate: string): boolean {
  const relative = path.relative(base, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

const secretAccessStore = new AsyncLocalStorage<true>();

/**
 * Run `fn` with the secret-path denylist ({@link isSecretPath}) off. The only
 * way to lift it: an explicit, scoped opt-in by the host application.
 */
export function withSecretPathAccess<T>(fn: () => T): T {
  return secretAccessStore.run(true, fn);
}

/** Path segments (exact names) that hold credentials. */
const SECRET_SEGMENTS: ReadonlySet<string> = new Set([
  ".ssh", ".cortex", ".aws", ".gnupg", "secret.key", "provider-keys.json", "id_rsa", "id_ed25519",
]);

const isSecretSegment = (segment: string): boolean =>
  SECRET_SEGMENTS.has(segment) ||
  segment === ".env" ||
  (segment.startsWith(".env.") && !/\.(example|sample|template)$/.test(segment));

/**
 * True when any segment of `target` (relative to `root` when inside it) names
 * a credential file or directory: `.env`, `.env.*`, `.ssh`, `.cortex`,
 * `secret.key`, `provider-keys.json`, ... File tools refuse these inside the
 * file root so a prompt-injected agent cannot read an app's own secrets.
 */
export function isSecretPath(root: string, target: string): boolean {
  if (secretAccessStore.getStore() === true) return false;
  const rel = path.relative(root, target);
  const shown = isWithinRoot(root, target) ? rel : target;
  return shown.split(/[\\/]+/).some(isSecretSegment);
}

/** {@link isSecretPath} on the lexical path and on where symlinks really lead. */
export async function isSecretPathReal(root: string, target: string): Promise<boolean> {
  if (isSecretPath(root, target)) return true;
  const realRoot = await realpathOfNearestAncestor(root);
  return isSecretPath(realRoot, await realpathOfNearestAncestor(target));
}

/**
 * `realpath` of `target`, or, when `target` does not exist yet (a write
 * target), the realpath of its nearest existing ancestor with the missing tail
 * re-appended. Symlinks anywhere in the existing part are resolved, so the
 * result is where the OS would really put the file.
 */
export async function realpathOfNearestAncestor(target: string): Promise<string> {
  const tail: string[] = [];
  let current = target;
  for (;;) {
    try {
      const real = await fsp.realpath(current);
      return tail.length === 0 ? real : path.join(real, ...tail.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * True when `target` stays inside `root` after resolving symlinks on both
 * sides (the root itself may be a symlink, e.g. `/tmp` on macOS).
 */
export async function isRealpathWithinRoot(root: string, target: string): Promise<boolean> {
  const realRoot = await realpathOfNearestAncestor(root);
  const realTarget = await realpathOfNearestAncestor(target);
  return isWithinRoot(realRoot, realTarget);
}
