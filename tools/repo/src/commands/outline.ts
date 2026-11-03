import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import type { Command } from "../cli.ts"
import { flagValue, rejectUnknown, splitArgs } from "../lib/args.ts"
import { resolveRoot } from "../lib/root.ts"
import { mdHeadings } from "../lib/wiki-index.ts"

const EXPORT_DECL =
  /^export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(function\*?|abstract\s+class|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/

/**
 * Structure of a file as `{line, text}` entries: `#`..`###` headings for markdown, top-level
 * `export` declarations (`<kind> <name>`) for ts/tsx. Other file types have no outline (empty).
 */
export function outline(file: string): readonly { text: string; line: number }[] {
  const text = readFileSync(file, "utf8")
  if (file.endsWith(".md")) return mdHeadings(text)
  if (!/\.tsx?$/.test(file)) return []
  const out: { text: string; line: number }[] = []
  text.split("\n").forEach((l, i) => {
    const m = EXPORT_DECL.exec(l)
    if (m) out.push({ text: `${(m[1] as string).replace(/\s+/g, " ")} ${m[2] as string}`, line: i + 1 })
  })
  return out
}

/** `repo outline`: headings or exports with line numbers, so a Read can target a range. */
export const outlineCommand: Command = {
  name: "outline",
  summary: "Headings (.md) or exports (.ts/.tsx) with line numbers, to Read a range",
  example: "bun run repo outline AGENTS.md",
  async run(args, io) {
    const { positionals, flagTokens } = splitArgs(args, ["--root"])
    const bad = rejectUnknown(io, "outline", flagTokens, { values: ["--root"] })
    if (bad !== undefined) return bad
    if (positionals.length !== 1) return io.usage("outline takes exactly one file", "bun run repo outline --help")
    const file = positionals[0] as string
    const root = resolveRoot(flagValue(flagTokens, "--root"))
    const abs = isAbsolute(file) ? file : existsSync(join(root, file)) ? join(root, file) : file
    if (!existsSync(abs)) return io.fail(`no such file: ${file}`, `bun run repo find "${file.split("/").pop() as string}"`)
    if (!/\.(?:md|tsx?)$/.test(file)) return io.fail(`no outline for ${file}`, `Read ${file} offset=1 limit=60`)
    const entries = outline(abs)
    io.data({ file, entries })
    for (const e of entries) io.out(`${e.line}  ${e.text}`)
    if (entries.length === 0) io.out(`no headings or exports in ${file}`)
    io.result(`next: Read ${file} offset=${entries[0]?.line ?? 1} limit=60`)
    return 0
  },
}
