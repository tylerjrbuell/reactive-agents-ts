import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Test HOME isolation (2026-11-19 dev-env audit). Test suites wrote ~9,000 agent memory dirs (1.9 GB,
 * named after fixtures: sub-grand, sub-child, guardrail-test, ...) into the developer's real
 * `~/.reactive-agents/memory`. The framework has no single data-dir override: memory reads
 * `process.env.HOME`, other stores call `os.homedir()`. So the test runner points HOME at a mirror home
 * inside the per-process test root: every top-level entry of the real home is symlinked in (git config,
 * bun cache, playwright browsers keep working), except the framework data dirs in `ISOLATED_HOME_ENTRIES`,
 * which start empty and are removed with the root.
 *
 * Bun caches `os.homedir()` at process start, so HOME must be set in the spawn env (`repo test`); the
 * preload, for raw `bun test`, can only redirect `process.env.HOME` readers and child processes.
 */

/** Home entries tests must never write into: the framework's per-user data dir. */
export const ISOLATED_HOME_ENTRIES: readonly string[] = [".reactive-agents"]
/** Env var holding the developer's real home while HOME points at a test mirror. */
export const REAL_HOME_ENV = "RA_TEST_REAL_HOME"

/** The developer's real home: an outer runner's record first, so nested runs mirror the real home. */
export function realHome(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const recorded = env[REAL_HOME_ENV]
  return recorded !== undefined && recorded.length > 0 ? recorded : homedir()
}

/**
 * Create `<root>/home`, symlink every entry of `real` into it except `ISOLATED_HOME_ENTRIES`, and return
 * its path. Symlink failures are skipped (best effort; the isolated entries are what matter).
 */
export function makeTestHome(root: string, real: string = realHome()): string {
  const home = join(root, "home")
  mkdirSync(home, { recursive: true })
  let names: string[] = []
  try {
    names = readdirSync(real)
  } catch {
    return home
  }
  for (const name of names) {
    if (ISOLATED_HOME_ENTRIES.includes(name)) continue
    try {
      symlinkSync(join(real, name), join(home, name))
    } catch {
      // already present or not linkable: skip
    }
  }
  return home
}

/** Env entries that point a test process at a mirror home under `root`. */
export function testHomeEnv(root: string, real: string = realHome()): Record<string, string> {
  return { HOME: makeTestHome(root, real), [REAL_HOME_ENV]: real }
}

/** The tools package's MCP credential-dir override (`MCP_AUTH_DIR_ENV` in packages/tools token-store.ts). */
export const MCP_AUTH_DIR_ENV = "REACTIVE_AGENTS_MCP_AUTH_DIR"

/**
 * MCP credential isolation (2026-11-20): test runs wrote 633 loopback logins into the developer's real
 * `~/.reactive-agents/mcp-auth`, where they showed up as "Signed in with rax". The store default comes
 * from `os.homedir()`, which Bun caches at start, so the HOME swap above cannot move it under raw
 * `bun test`. Point `REACTIVE_AGENTS_MCP_AUTH_DIR` (read at call time) at a fresh temp dir and remove it
 * on exit. An outer value wins. Returns the dir it created, or undefined when one was already set.
 */
export function installMcpAuthIsolation(
  env: Record<string, string | undefined> = process.env,
  onExit: (cleanup: () => void) => void = (cleanup) => process.on("exit", cleanup),
): string | undefined {
  const outer = env[MCP_AUTH_DIR_ENV]
  if (outer !== undefined && outer.length > 0) return undefined
  const dir = mkdtempSync(join(tmpdir(), "ra-test-mcp-auth-"))
  env[MCP_AUTH_DIR_ENV] = dir
  onExit(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // best-effort; the per-process test root sweep reaps leftovers
    }
  })
  return dir
}
