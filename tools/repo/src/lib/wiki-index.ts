import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { frontmatter } from "./frontmatter.ts"
import { trackedFiles } from "./tracked-files.ts"

/** One wiki page, described from its frontmatter and headings. */
export interface WikiEntry {
  path: string
  title: string
  type: string | null
  status: string | null
  updated: string | null
  /** `#`..`###` headings outside code fences. */
  headings: readonly { text: string; line: number }[]
}

/** Status text that marks a page as no longer current; statuses are often prose (`SUPERSEDED (2026-07-19) - ...`). */
const STALE_STATUS = /^\s*(?:deprecated|superseded|historical|stale|archived)\b/i
/**
 * Hub pages known to be stale regardless of frontmatter (wiki pages are not edited to say so):
 * `wiki/Home.md` and `wiki/MOCs/**`. See AGENTS.md Agent Efficiency Rule 5.
 */
const STALE_PATHS: readonly string[] = ["wiki/Home.md", "wiki/MOCs/"]
export const MAX_FILE_BYTES = 1_000_000

/** `_archive` path, a known stale hub, or a retired frontmatter status. */
export function isStale(path: string, status: string | null): boolean {
  return (
    /(?:^|\/)_archive(?:\/|$)/.test(path) ||
    STALE_PATHS.some((s) => (s.endsWith("/") ? path.startsWith(s) : path === s)) ||
    (status !== null && STALE_STATUS.test(status))
  )
}

/** Markdown `#`..`###` headings, skipping fenced code. Text keeps its `#` prefix. */
export function mdHeadings(text: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = []
  let fenced = false
  text.split("\n").forEach((l, i) => {
    if (/^\s*(?:```|~~~)/.test(l)) fenced = !fenced
    if (!fenced && /^#{1,3}\s+\S/.test(l)) out.push({ text: l.trim(), line: i + 1 })
  })
  return out
}

/** Cheap title: frontmatter `title:` line, else the first `# ` heading, else the file name. */
export function cheapTitle(path: string, text: string): string {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const t = fm ? /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm[1] as string)?.[1] : undefined
  if (t !== undefined) return t
  const h = /^#\s+(.+)$/m.exec(fm ? text.slice((fm[0] as string).length) : text)?.[1]
  return h?.trim() ?? (path.split("/").pop() as string).replace(/\.md$/, "")
}

/** Frontmatter `status` only (parses YAML lazily, for pages that already have a hit). */
export function pageStatus(text: string): string | null {
  const fm = frontmatter(text)
  const s = fm?.status ?? fm?.Status
  return typeof s === "string" ? s : null
}

const str = (v: unknown): string | null =>
  v === undefined || v === null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)

/** Index every tracked `wiki/**` markdown page. Sorted by path. */
export function indexWiki(root: string): readonly WikiEntry[] {
  const out: WikiEntry[] = []
  for (const p of trackedFiles(root)) {
    if (!p.startsWith("wiki/") || !p.endsWith(".md")) continue
    let text: string
    try {
      if (statSync(join(root, p)).size > MAX_FILE_BYTES) continue
      text = readFileSync(join(root, p), "utf8")
    } catch {
      continue
    }
    const fm = frontmatter(text)
    out.push({
      path: p,
      title: cheapTitle(p, text),
      type: str(fm?.type),
      status: str(fm?.status ?? fm?.Status),
      updated: str(fm?.updated),
      headings: mdHeadings(text),
    })
  }
  return out
}
