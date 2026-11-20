// Run: bun run repo test tools/repo/tests/release-notes.test.ts
/**
 * scripts/release-notes.ts: the GitHub release body stays under GitHub's
 * 125000-char limit (v0.18.0 and v0.19.0 publish runs failed with HTTP 422),
 * and a hand-written release body is never overwritten.
 */
import { describe, expect, test } from "bun:test"
import {
  AUTO_MARKER,
  buildReleaseNotes,
  decideAction,
  extractSection,
  GITHUB_BODY_LIMIT,
} from "../../../scripts/release-notes.ts"

const REPO = "owner/repo"
const CHANGELOG_URL = "https://github.com/owner/repo/blob/main/CHANGELOG.md"

/** A `## [version]` section of `chars` characters made of changeset-like lines. */
function section(version: string, chars: number): string {
  const lines = [`## [${version}] — 2026-11-20`, ""]
  let size = lines.join("\n").length
  for (let i = 0; size < chars; i++) {
    const line = `- note ${i}: ${"x".repeat(60)}`
    lines.push(line)
    size += line.length + 1
  }
  return lines.join("\n")
}

describe("buildReleaseNotes", () => {
  test("a 400000-char section yields a body under the limit with the CHANGELOG link", () => {
    const changelog = `${section("0.19.0", 400_000)}\n\n${section("0.18.0", 2_000)}\n`
    const body = buildReleaseNotes({ version: "0.19.0", changelog, repo: REPO })
    expect(body.length).toBeLessThan(GITHUB_BODY_LIMIT)
    expect(body.length).toBeGreaterThan(100_000)
    expect(body).toContain(CHANGELOG_URL)
    expect(body).toContain("Truncated")
    expect(body).toContain("## [0.19.0]")
    expect(body).not.toContain("## [0.18.0]")
    expect(body.startsWith(AUTO_MARKER)).toBe(true)
    // Cut at a line boundary: the last section line is a whole note.
    const lastNote = body.split("\n").filter((l) => l.startsWith("- note ")).at(-1)
    expect(lastNote).toMatch(/^- note \d+: x{60}$/)
  })
  test("a small section is kept whole, without the truncation line", () => {
    const changelog = `${section("0.19.0", 500)}\n\n${section("0.18.0", 500)}\n`
    const body = buildReleaseNotes({ version: "0.19.0", changelog, repo: REPO })
    expect(body).toContain(extractSection(changelog, "0.19.0")!)
    expect(body).toContain(CHANGELOG_URL)
    expect(body).not.toContain("Truncated")
  })
  test("budget is capped at the GitHub limit", () => {
    const changelog = section("1.0.0", 300_000)
    const body = buildReleaseNotes({ version: "1.0.0", changelog, repo: REPO, budget: 10_000_000 })
    expect(body.length).toBeLessThanOrEqual(GITHUB_BODY_LIMIT)
  })
})

describe("extractSection", () => {
  const log = "## [0.19.0] — b\nnew\n\n## [0.18.0] — a\nold\n"
  test("exact version, plain or bracketed heading", () => {
    expect(extractSection(log, "0.18.0")).toBe("## [0.18.0] — a\nold")
    expect(extractSection("## 1.2.3\nx\n## 1.2.2\ny", "1.2.3")).toBe("## 1.2.3\nx")
  })
  test("dots are literal and a prerelease does not match its base", () => {
    expect(extractSection("## [0a19b0]\nfake\n## [0.18.0]\nold", "0.19.0")).toBe("## [0.18.0]\nold")
    const rc = "## [0.19.0-rc.1]\nrc\n## [0.18.0]\nold"
    expect(extractSection(rc, "0.19.0-rc.1")).toBe("## [0.19.0-rc.1]\nrc")
    expect(extractSection(`## [0.19.0]\nfinal\n${rc}`, "0.19.0")).toBe("## [0.19.0]\nfinal")
  })
  test("unknown version falls back to the first section; no sections gives undefined", () => {
    expect(extractSection(log, "9.9.9")).toBe("## [0.19.0] — b\nnew")
    expect(extractSection("no headings", "1.0.0")).toBeUndefined()
  })
})

describe("decideAction", () => {
  test("no release: create", () => expect(decideAction(undefined)).toBe("create"))
  test("empty or script-written body: edit", () => {
    expect(decideAction("")).toBe("edit")
    expect(decideAction("  \n")).toBe("edit")
    expect(decideAction(`${AUTO_MARKER}\nold dump`)).toBe("edit")
  })
  test("hand-written body: keep", () => expect(decideAction("Curated v0.19.0 notes")).toBe("keep"))
})
