import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/** Lines carrying this marker are exempt from drift checks. */
export const DRIFT_IGNORE_MARKER = "repo-drift-ignore"

const MENTION = /bun run repo\s+([A-Za-z][\w-]*)/g

function walkMd(root: string, dir: string, out: string[]): void {
  const abs = join(root, dir)
  if (!existsSync(abs)) return
  for (const name of readdirSync(abs).sort()) {
    const rel = `${dir}/${name}`
    if (statSync(join(root, rel)).isDirectory()) walkMd(root, rel, out)
    else if (name.endsWith(".md")) out.push(rel)
  }
}

/** Docs scanned for `bun run repo <cmd>` mentions. Planning docs are deliberately excluded. */
export function scannedDocs(root: string): readonly string[] {
  const out: string[] = []
  if (existsSync(join(root, "AGENTS.md"))) out.push("AGENTS.md")
  walkMd(root, ".agents/skills", out)
  walkMd(root, "wiki/Development", out)
  return out
}

/** One doc mention of a command that is not registered. */
export interface DriftHit {
  file: string
  line: number
  command: string
}

/** Mentions of `bun run repo <word>` in scanned docs where `<word>` is not in `commandNames`. */
export function docCommandDrift(root: string, commandNames: readonly string[]): readonly DriftHit[] {
  const known = new Set(commandNames)
  const hits: DriftHit[] = []
  for (const file of scannedDocs(root)) {
    readFileSync(join(root, file), "utf8")
      .split("\n")
      .forEach((text, i) => {
        if (text.includes(DRIFT_IGNORE_MARKER)) return
        for (const m of text.matchAll(MENTION)) {
          const command = m[1] as string
          if (!known.has(command)) hits.push({ file, line: i + 1, command })
        }
      })
  }
  return hits
}
