/**
 * Rooted-path heal for READ tools (file-read, list-directory).
 *
 * Phase-0 trace spike (2026-11-17): models send a path that names the wrong
 * root for a file that exists under the real one:
 * - doubled root: `<root>/apps/cortex/README.md` when the root already ends in
 *   `apps/cortex` (ENOENT under `<root>/apps/cortex/apps/cortex/`);
 * - foreign root: `/workspace/a.txt`, `/home/user/CHANGELOG.md` (outside the
 *   sandbox, refused by the traversal guard).
 *
 * Closed rule: the heal returns the in-root path ONLY when
 * 1. the requested path has no `..` segment;
 * 2. the requested path does not exist where it points (a path that really
 *    exists outside the root is a deliberate request, not a typo: it stays
 *    refused);
 * 3. a suffix of it (doubled root: the repeat stripped; foreign root: the
 *    deepest suffix, up to {@link MAX_SUFFIX_PROBES} segments) EXISTS under the
 *    root;
 * 4. that candidate is inside the root after symlink resolution and is not a
 *    credential path.
 * Anything else returns `undefined` and the caller's guard fires as before.
 * Writes are never healed: a write to a path the model did not name would
 * leave terminal verification checking the wrong file.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isRealpathWithinRoot, isSecretPathReal, isWithinRoot } from "./file-root.js";
import { stripRepeatedRootPrefix } from "./file-read-heals.js";

/** Deepest suffix length probed for the foreign-root heal. */
const MAX_SUFFIX_PROBES = 4;

/** A healed read path: the in-root absolute path plus a model-facing note. */
export interface HealedRootedPath {
  readonly path: string;
  readonly note: string;
}

/**
 * Longest suffix of `rejected`'s components that exists under `base`, as a
 * "./"-prefixed relative path, or undefined. Probes at most `maxProbes`
 * suffixes (deepest first, so "./data/logs.txt" beats "./logs.txt" when both
 * exist). Also feeds the corrective traversal error.
 */
export async function existingSuffixUnder(
  base: string,
  rejected: string,
  maxProbes = MAX_SUFFIX_PROBES,
): Promise<string | undefined> {
  const parts = rejected.split(/[\\/]+/).filter((p) => p.length > 0 && p !== "." && p !== "..");
  const deepest = Math.min(parts.length, maxProbes);
  for (let take = deepest; take >= 1; take--) {
    const candidate = parts.slice(parts.length - take).join("/");
    const probe = path.resolve(base, candidate);
    // The probe itself must stay confined: a candidate that escapes is no fix.
    if (!isWithinRoot(base, probe)) continue;
    try {
      await fs.access(probe);
      return `./${candidate}`;
    } catch {
      // keep shrinking the suffix
    }
  }
  return undefined;
}

const exists = (p: string): Promise<boolean> =>
  fs.access(p).then(
    () => true,
    () => false,
  );

/** The in-root path for `requested` under the closed rule above, or undefined. */
export async function healRootedPath(root: string, requested: string): Promise<HealedRootedPath | undefined> {
  if (!path.isAbsolute(requested)) return undefined;
  if (requested.split(/[\\/]+/).includes("..")) return undefined;
  const abs = path.resolve(requested);
  if (await exists(abs)) return undefined;

  let candidate: string | undefined;
  if (isWithinRoot(root, abs)) {
    const stripped = stripRepeatedRootPrefix(root, path.relative(root, abs));
    if (stripped !== undefined) candidate = path.resolve(root, stripped);
  } else {
    const suffix = await existingSuffixUnder(root, requested);
    if (suffix !== undefined) candidate = path.resolve(root, suffix);
  }
  if (candidate === undefined || !(await exists(candidate))) return undefined;
  if (!isWithinRoot(root, candidate)) return undefined;
  if (await isSecretPathReal(root, candidate)) return undefined;
  if (!(await isRealpathWithinRoot(root, candidate))) return undefined;
  return {
    path: candidate,
    note: `"${requested}" does not exist (it names a root other than the working root ${root}); used "${candidate}" instead`,
  };
}
