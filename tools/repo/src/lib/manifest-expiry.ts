import { existsSync } from "node:fs"
import { EXPIRY_GRACE_DAYS, manifestPath, readManifest } from "./manifest.ts"

const DAY_MS = 86_400_000

/** Manifests that must exist. `rules.json` is optional until it is created. */
const REQUIRED = ["checks.json", "catalog.json", "ownership.json"] as const
const OPTIONAL = ["rules.json"] as const

/** Result of validating every manifest: schema errors, and entries past `reviewBy`. */
export interface ManifestHealth {
  schemaErrors: readonly string[]
  warn: readonly string[]
  fail: readonly string[]
}

function lateDays(reviewBy: string, today: string): number {
  return Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${reviewBy}T00:00:00Z`)) / DAY_MS)
}

/** Entry label: its `id`, else its `glob`, else its index. */
function label(file: string, o: Record<string, unknown>, i: number): string {
  const name = typeof o.id === "string" ? o.id : typeof o.glob === "string" ? o.glob : `#${i}`
  return `${file}:${name}`
}

/**
 * Check `schemaVersion: 1` on every manifest and `reviewBy` on every entry that has one.
 * Warn past `reviewBy`, fail 30 days later. `today` is injected (ISO `YYYY-MM-DD`).
 */
export function manifestHealth(root: string, today: string): ManifestHealth {
  const schemaErrors: string[] = []
  const warn: string[] = []
  const fail: string[] = []
  const files = [...REQUIRED, ...OPTIONAL.filter((f) => existsSync(manifestPath(root, f)))]
  for (const file of files) {
    let doc: Record<string, unknown>
    try {
      doc = readManifest(root, file)
    } catch (e) {
      schemaErrors.push(e instanceof Error ? e.message : String(e))
      continue
    }
    for (const list of [doc.checks, doc.entries, doc.rules]) {
      if (!Array.isArray(list)) continue
      list.forEach((e: unknown, i) => {
        const o = (typeof e === "object" && e !== null ? e : {}) as Record<string, unknown>
        if (typeof o.reviewBy !== "string") return
        const late = lateDays(o.reviewBy, today)
        if (late > EXPIRY_GRACE_DAYS) fail.push(label(file, o, i))
        else if (late > 0) warn.push(label(file, o, i))
      })
    }
  }
  return { schemaErrors, warn, fail }
}
