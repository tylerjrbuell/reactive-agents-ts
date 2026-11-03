import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll } from "bun:test"

/** The real repo root. */
export const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..")

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

/**
 * A temp root carrying the REAL manifests (`rules.json`, `placement.json`, ...), so hook tests run the real rules
 * without writing deny/override logs into the real repo's `.repo-logs/`.
 */
export function mirrorRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "repo-mirror-"))
  made.push(root)
  mkdirSync(join(root, "tools", "repo"), { recursive: true })
  for (const f of readdirSync(join(REPO_ROOT, "tools", "repo")).filter((n) => n.endsWith(".json") && n !== "package.json" && n !== "tsconfig.json"))
    copyFileSync(join(REPO_ROOT, "tools", "repo", f), join(root, "tools", "repo", f))
  return root
}
