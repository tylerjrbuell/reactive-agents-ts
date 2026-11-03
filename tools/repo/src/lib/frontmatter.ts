import { parse } from "yaml"

/** Parse a markdown file's leading `---` YAML frontmatter. Null when absent or malformed. */
export function frontmatter(text: string): Record<string, unknown> | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!m) return null
  try {
    const doc: unknown = parse(m[1] as string)
    return typeof doc === "object" && doc !== null && !Array.isArray(doc) ? (doc as Record<string, unknown>) : null
  } catch {
    return null
  }
}
