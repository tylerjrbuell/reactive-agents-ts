import { join } from "node:path"
import type { Hog } from "./tmp-janitor.ts"

/**
 * Report-only space hogs outside the temp dir (2026-11-19 dev-env audit): agent memory dirs that test
 * suites leaked into the real `~/.reactive-agents/memory`, and the build and package caches. `repo
 * janitor` lists them with the exact cleanup command; deleting them is the owner's call.
 */

/**
 * Agent ids test fixtures create (2026-11-19: ~9,000 dirs, 1.9 GB). Only names no real agent uses:
 * Cortex's own utility agents (`chat-titler`, `chat-compactor`, `goal-checker`) also run in real use,
 * so they are not listed.
 */
export const TEST_MEMORY_PREFIXES: readonly string[] = [
  "guardrail-test-",
  "sub-grand-",
  "sub-child-",
  "sub-capper-",
  "sub-kid-",
  "sub-alpha-",
  "sub-beta-",
  "test-sub-memory",
  "integration-test-agent",
  "wire-agent",
]

/** Turbo's local cache is reported above this size. */
export const TURBO_REPORT_BYTES = 2 * 1024 ** 3
/** Bun's install cache is reported above this size. */
export const BUN_CACHE_REPORT_BYTES = 5 * 1024 ** 3

/**
 * Group test-fixture entries of `memDir` by prefix, with count, size and a delete command scoped to that
 * prefix. `sizes` maps entry name to bytes; names matching no prefix are ignored. Largest group first.
 */
export function testMemoryLeftovers(memDir: string, sizes: ReadonlyMap<string, number>): Hog[] {
  const groups = new Map<string, { count: number; bytes: number }>()
  for (const [name, bytes] of sizes) {
    const prefix = TEST_MEMORY_PREFIXES.find((p) => name.startsWith(p))
    if (prefix === undefined) continue
    const g = groups.get(prefix) ?? { count: 0, bytes: 0 }
    g.count++
    g.bytes += bytes
    groups.set(prefix, g)
  }
  return [...groups]
    .map(([prefix, g]) => ({
      path: join(memDir, `${prefix}*`),
      bytes: g.bytes,
      kind: "test-leftovers" as const,
      count: g.count,
      label: prefix,
      fix: `find ${memDir} -maxdepth 1 -name '${prefix}*' -exec rm -rf {} +`,
    }))
    .sort((a, b) => b.bytes - a.bytes)
}

/** Measured cache sizes; `undefined` = absent. */
export interface CacheReading {
  turbo?: { path: string; bytes: number }
  bun?: { path: string; bytes: number }
}

/** Caches above their report threshold, with the command that frees them. */
export function cacheHogs(r: CacheReading): Hog[] {
  const out: Hog[] = []
  if (r.turbo !== undefined && r.turbo.bytes > TURBO_REPORT_BYTES) {
    out.push({ ...r.turbo, kind: "cache", label: "turbo cache", fix: `rm -rf ${r.turbo.path}   # turbo rebuilds on the next build; never pruned automatically` })
  }
  if (r.bun !== undefined && r.bun.bytes > BUN_CACHE_REPORT_BYTES) {
    out.push({ ...r.bun, kind: "cache", label: "bun install cache", fix: "bun pm cache rm   # bun refetches packages on the next install" })
  }
  return out
}
