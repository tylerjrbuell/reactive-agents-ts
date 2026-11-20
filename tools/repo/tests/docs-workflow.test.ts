import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parse } from "yaml"

const REPO = resolve(import.meta.dir, "..", "..", "..")

type PushTrigger = { branches?: string[]; tags?: string[]; paths?: string[] }

const push = (): PushTrigger => {
  const wf = parse(readFileSync(resolve(REPO, ".github/workflows/docs.yml"), "utf8")) as { on: { push: PushTrigger } }
  return wf.on.push
}

/** GitHub filter-pattern subset used for tags: `[...]` class, `+` one-or-more, `*` any but `/`; the rest literal; whole-ref match. */
const toRegex = (pattern: string): RegExp => {
  let re = ""
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!
    if (c === "[") {
      const end = pattern.indexOf("]", i)
      re += pattern.slice(i, end + 1)
      i = end
    } else if (c === "+") re += "+"
    else if (c === "*") re += "[^/]*"
    else re += c.replace(/[.^$|(){}\\?]/g, "\\$&")
  }
  return new RegExp(`^${re}$`)
}

const matchesAny = (tag: string, patterns: string[]): boolean => patterns.some((p) => toRegex(p).test(tag))

describe("docs.yml deploys on release tags", () => {
  test("main pushes still deploy", () => {
    expect(push().branches).toContain("main")
  })

  test("strict vX.Y.Z tags trigger a deploy; pre-releases and non-version tags do not", () => {
    const tags = push().tags ?? []
    for (const t of ["v0.19.0", "v1.0.0", "v10.20.30"]) expect(matchesAny(t, tags)).toBe(true)
    for (const t of ["v0.19.0-rc.1", "v0.19", "0.19.0", "v0.19.0.1", "vx.y.z"]) expect(matchesAny(t, tags)).toBe(false)
  })
})
