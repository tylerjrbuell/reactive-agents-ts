/**
 * Search-backend env for bench runs.
 *
 * `web-search` (packages/tools) picks a backend from env: TAVILY_API_KEY,
 * BRAVE_SEARCH_API_KEY/BRAVE_API_KEY, SERPER_API_KEY, KEENABLE_API_KEY. With none
 * set it falls back to DuckDuckGo instant answers, which return no rows for
 * research queries. Bun only auto-loads `.env` from the cwd, and campaign
 * worktrees live outside the repo, so the key in the repo `.env` never reached
 * the run: every lh-1 `web-search` call failed with "Only DuckDuckGo instant
 * answers are configured" (instrument fault, not a model or harness failure).
 *
 * This module copies ONLY the search-key vars from a `.env` file into
 * `process.env` when unset. Values are never logged or returned.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

/** Env vars that configure a `web-search` backend (mirrors packages/tools web-search.ts). */
export const SEARCH_KEY_VARS: readonly string[] = [
  "TAVILY_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "BRAVE_API_KEY",
  "SERPER_API_KEY",
  "KEENABLE_API_KEY",
]

/** Parse `KEY=value` lines; strips optional `export `, quotes, comments. Pure. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw)
    if (!m || raw.trim().startsWith("#")) continue
    let v = m[2]!
    const q = v[0]
    if ((q === '"' || q === "'") && v.endsWith(q) && v.length >= 2) v = v.slice(1, -1)
    else v = v.replace(/\s+#.*$/, "")
    if (v) out[m[1]!] = v
  }
  return out
}

/** Candidate `.env` files: RA_BENCH_ENV_FILE, the repo root this source lives in, the cwd. */
export function defaultEnvCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const here = dirname(new URL(import.meta.url).pathname)
  return [
    ...(env.RA_BENCH_ENV_FILE ? [env.RA_BENCH_ENV_FILE] : []),
    join(here, "..", "..", "..", ".env"),
    // A git worktree has no .env of its own: the main checkout (git common dir's parent) does.
    ...mainCheckoutEnv(here),
    join(process.cwd(), ".env"),
  ]
}

function mainCheckoutEnv(cwd: string): string[] {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    return common ? [join(dirname(common), ".env")] : []
  } catch {
    return []
  }
}

/**
 * Fill unset search-key vars on `env` from the first candidate file that defines
 * each. Returns the NAMES set (never values).
 */
export function applySearchKeysFromEnvFiles(
  env: NodeJS.ProcessEnv = process.env,
  candidates: readonly string[] = defaultEnvCandidates(env),
): string[] {
  const set: string[] = []
  for (const file of candidates) {
    if (!existsSync(file)) continue
    const parsed = parseEnvFile(readFileSync(file, "utf8"))
    for (const name of SEARCH_KEY_VARS) {
      if (!env[name] && parsed[name]) {
        env[name] = parsed[name]
        set.push(name)
      }
    }
  }
  return set
}

/** True when at least one real search backend key is present. */
export function searchBackendConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return SEARCH_KEY_VARS.some((n) => Boolean(env[n]))
}
