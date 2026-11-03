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

/** Statuses that mark a page as no longer current. */
const STALE_STATUS = new Set(["deprecated", "superseded", "historical"])
export const MAX_FILE_BYTES = 1_000_000

/** `_archive` path or a retired frontmatter status. */
export function isStale(path: string, status: string | null): boolean {
  return /(?:^|\/)_archive(?:\/|$)/.test(path) || (status !== null && STALE_STATUS.has(status))
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
  const s = frontmatter(text)?.status
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
      status: str(fm?.status),
      updated: str(fm?.updated),
      headings: mdHeadings(text),
    })
  }
  return out
}
