#!/usr/bin/env bun
/**
 * GitHub release notes for a tagged version (publish.yml "Create consolidated
 * GitHub release").
 *
 * The body is a short header (version, docs What's New, the full CHANGELOG)
 * plus this version's CHANGELOG section, cut at a line boundary so the whole
 * body stays under GitHub's 125000-character release body limit. v0.18.0 and
 * v0.19.0 (a ~391540-char section from 528 changeset notes) failed that step
 * with `HTTP 422 ... body is too long`.
 *
 * Idempotent with an existing release: a body written by hand is kept. Only an
 * empty body or one this script wrote (it carries `AUTO_MARKER`) is replaced.
 *
 * Run:
 *   bun scripts/release-notes.ts <version> <out-file> [<existing-body-file>]
 * Writes the notes to <out-file> and prints one action on stdout:
 *   create  no release exists (no <existing-body-file> given)
 *   edit    the release exists with an empty or script-written body
 *   keep    the release exists with a hand-written body; leave it alone
 */
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

/** GitHub rejects release bodies longer than this. */
export const GITHUB_BODY_LIMIT = 125_000
/** Target size: headroom under the limit for multi-unit characters. */
export const BODY_BUDGET = 120_000
/** Marks a body this script wrote, so a re-run may replace it. */
export const AUTO_MARKER = "<!-- release-notes:auto -->"

const DOCS_WHATS_NEW = "https://docs.reactiveagents.dev/guides/whats-new/"

export type ReleaseAction = "create" | "edit" | "keep"

export interface ReleaseNotesInput {
  readonly version: string
  /** Full CHANGELOG.md text. */
  readonly changelog: string
  /** `owner/name`, e.g. from GITHUB_REPOSITORY. */
  readonly repo: string
  /** Total body budget in characters (default BODY_BUDGET). */
  readonly budget?: number
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const VERSION_HEADING = /^## \[?\d+\.\d+\.\d+/m

/**
 * This version's `## <version>` / `## [<version>]` section, heading included.
 * Falls back to the first version section, then to undefined.
 */
export function extractSection(changelog: string, version: string): string | undefined {
  const headings = [...changelog.matchAll(new RegExp(VERSION_HEADING.source, "gm"))].map((m) => m.index ?? 0)
  const sectionAt = (start: number): string => {
    const next = headings.find((h) => h > start)
    return changelog.slice(start, next ?? changelog.length).trim()
  }
  const exact = new RegExp(`^## \\[?${escapeRe(version)}\\]?(?:[^\\S\\n]|$)`, "m").exec(changelog)
  if (exact) return sectionAt(exact.index)
  return headings.length > 0 ? sectionAt(headings[0]!) : undefined
}

/** Cut `text` to at most `max` characters at a line boundary. */
export function truncateAtLine(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.lastIndexOf("\n", max)
  return text.slice(0, cut > 0 ? cut : max).trimEnd()
}

/** The release body: header + CHANGELOG section, always within `budget`. */
export function buildReleaseNotes(input: ReleaseNotesInput): string {
  const budget = Math.min(input.budget ?? BODY_BUDGET, GITHUB_BODY_LIMIT)
  const changelogUrl = `https://github.com/${input.repo}/blob/main/CHANGELOG.md`
  const header = [
    AUTO_MARKER,
    `**reactive-agents v${input.version}**`,
    "",
    `- What's New: ${DOCS_WHATS_NEW}`,
    `- Full changelog: ${changelogUrl}`,
    "",
  ].join("\n")
  const section = extractSection(input.changelog, input.version) ?? `See ${changelogUrl} for details.`
  const footer = `\n\n_Truncated to fit GitHub's release size limit. Full notes: ${changelogUrl}_`
  const whole = `${header}\n${section}`
  if (whole.length <= budget) return whole
  return `${header}\n${truncateAtLine(section, budget - header.length - 1 - footer.length)}${footer}`
}

/**
 * What to do with the release. `existingBody` is undefined when no release
 * exists. A hand-written body (non-empty, no AUTO_MARKER) is never replaced.
 */
export function decideAction(existingBody: string | undefined): ReleaseAction {
  if (existingBody === undefined) return "create"
  const body = existingBody.trim()
  return body === "" || body.includes(AUTO_MARKER) ? "edit" : "keep"
}

if (import.meta.main) {
  const [version, outFile, existingFile] = process.argv.slice(2)
  if (!version || !outFile) {
    console.error("usage: bun scripts/release-notes.ts <version> <out-file> [<existing-body-file>]")
    process.exit(2)
  }
  const root = resolve(import.meta.dir, "..")
  const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8")
  const repo = process.env.GITHUB_REPOSITORY ?? "tylerjrbuell/reactive-agents-ts"
  const notes = buildReleaseNotes({ version, changelog, repo })
  // Belt and braces: buildReleaseNotes cuts to the budget, so this only fires
  // if that logic regresses. It fails here (and nightly in release-rehearsal.yml)
  // instead of as an HTTP 422 at the tag.
  if (notes.length > GITHUB_BODY_LIMIT) {
    console.error(`release notes: ${notes.length} chars, over GitHub's ${GITHUB_BODY_LIMIT}-char release body limit`)
    process.exit(1)
  }
  writeFileSync(outFile, notes)
  const existing = existingFile ? readFileSync(existingFile, "utf8") : undefined
  console.error(`release notes: ${notes.length} chars (limit ${GITHUB_BODY_LIMIT})`)
  console.log(decideAction(existing))
}
