// packages/trace/src/paths.ts
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

/** Canonical default trace directory: `~/.reactive-agents/traces`. */
export function defaultTraceDir(): string {
  return join(homedir(), ".reactive-agents", "traces")
}

/**
 * Single canonical trace-directory resolver.
 *
 * `REACTIVE_AGENTS_TRACE_DIR` (when non-empty) wins; otherwise the home-dir
 * default. The test preload (`scripts/test-preload.ts`) points the env var at
 * a per-process temp dir so unit tests never write into the real corpus.
 */
export function resolveTraceDir(env: NodeJS.ProcessEnv = process.env): string {
  const o = env.REACTIVE_AGENTS_TRACE_DIR
  if (o && o.length > 0) return o
  return underTestRunner(env) ? testTraceDir() : defaultTraceDir()
}

/** True under `bun test` / vitest-style runners (NODE_ENV=test). */
function underTestRunner(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "test"
}

/**
 * Per-process temp dir used when running under a test runner with no explicit
 * override. Needed because `bunfig.toml` preloads only apply when `bun test`
 * runs from the repo root; turbo runs each package's tests from the package
 * dir, where the root preload never loads. Guarding at the recorder boundary
 * works regardless of cwd.
 */
export function testTraceDir(): string {
  return join(tmpdir(), `ra-test-traces-${process.pid}`)
}

/**
 * Boundary redirect applied by the recorder: a caller that hard-codes the
 * default home dir (e.g. `.withTracing()` with no dir) still honors the env
 * override (and, under a test runner, a per-process temp dir). Explicit non-default dirs are never redirected.
 */
export function effectiveTraceDir(dir: string, env: NodeJS.ProcessEnv = process.env): string {
  if (dir !== defaultTraceDir()) return dir
  return resolveTraceDir(env)
}
