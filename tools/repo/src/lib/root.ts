import { resolve } from "node:path"

/** Repo root: `--root <dir>` (for fixtures/tests) or the checkout containing this tool. */
export function resolveRoot(override: string | undefined): string {
  return override ? resolve(override) : resolve(import.meta.dir, "..", "..", "..", "..")
}
