import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/** Minutes a `repo place --allow` entry stays valid. */
export const ALLOW_MINUTES = 60

const FILE = "allow-paths.jsonl"

/** Record that `path` (repo-relative) may be written despite a placement rule. Appends to `.repo-logs/allow-paths.jsonl`. */
export function recordAllow(root: string, path: string, reason: string, now: Date = new Date()): void {
  const dir = join(root, ".repo-logs")
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, FILE), `${JSON.stringify({ path, reason, ts: now.toISOString() })}\n`)
}

/** The reason of a still-valid (<=60 min old) allow entry for exactly `path`, else undefined. Newest wins. */
export function allowedReason(root: string, path: string, now: Date = new Date()): string | undefined {
  const file = join(root, ".repo-logs", FILE)
  if (!existsSync(file)) return undefined
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.length > 0)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const e: unknown = JSON.parse(lines[i] as string)
      if (typeof e !== "object" || e === null) continue
      const o = e as Record<string, unknown>
      if (o.path !== path || typeof o.reason !== "string" || typeof o.ts !== "string") continue
      const age = now.getTime() - Date.parse(o.ts)
      if (age >= 0 && age <= ALLOW_MINUTES * 60_000) return o.reason
    } catch {
      continue
    }
  }
  return undefined
}
