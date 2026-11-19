import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { builtins, type BuiltinCtx } from "../src/lib/builtins.ts"
import { distTag, distTagDeps, workspaceManifests } from "../src/lib/dist-tag-deps.ts"
import type { CheckEntry } from "../src/lib/manifest.ts"

const REPO = resolve(import.meta.dir, "..", "..", "..")
const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const ROOT_PKG = JSON.stringify({ workspaces: ["packages/*", "apps/*", "apps/cortex/ui", "tools/repo"] })

function fixture(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "repo-dist-tag-"))
  dirs.push(root)
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(root, p, ".."), { recursive: true })
    writeFileSync(join(root, p), typeof c === "string" ? c : JSON.stringify(c))
  }
  return root
}

const entry = { id: "no-dist-tag-deps", script: "builtin:no-dist-tag-deps", scope: [], stages: [], owner: "x", reviewBy: "2099-01-01" } as unknown as CheckEntry
const ctx: BuiltinCtx = { today: "2026-11-19", commandNames: [] }
const run = (root: string) => builtins["no-dist-tag-deps"]?.(root, entry, ctx)

describe("distTag", () => {
  test("names dist-tags", () => {
    for (const s of ["latest", "next", "canary", "beta", " latest ", "rc-1"]) expect(distTag(s)).toBe(s.trim())
    expect(distTag("npm:bun-types@latest")).toBe("latest")
    expect(distTag("npm:@scope/pkg@next")).toBe("next")
    expect(distTag("npm:bun-types")).toBe("latest")
  })
  test("semver ranges and protocols are not tags", () => {
    for (const s of ["^1.3.13", "1.2.3", "~1.0", ">=18.0.0", "*", "", "x", "1.x", "x.x", "v1.2.3", "1.0.0-beta.1", "^1.0.0 || ^2.0.0", "workspace:*", "file:../x", "link:x", "github:a/b", "https://x/y.tgz", "npm:bun-types@^1.3.13", "npm:@s/p@1.0.0"])
      expect(distTag(s)).toBeUndefined()
  })
})

describe("no-dist-tag-deps builtin", () => {
  test("fails on a workspace manifest with \"latest\", naming file and dep", () => {
    const root = fixture({ "package.json": ROOT_PKG, "packages/a/package.json": { devDependencies: { "bun-types": "latest", typescript: "^6.0.3" } } })
    const r = run(root)
    expect(r?.ok).toBe(false)
    expect(r?.output).toContain('packages/a/package.json: devDependencies.bun-types = "latest"')
    expect(r?.output).not.toContain("typescript")
    expect(r?.next).toContain("packages/a/package.json")
  })
  test("checks the root manifest and every dep field", () => {
    const root = fixture({
      "package.json": JSON.stringify({ workspaces: ["packages/*"], dependencies: { a: "next" } }),
      "packages/b/package.json": { peerDependencies: { p: "canary" }, optionalDependencies: { o: "beta" } },
    })
    expect(distTagDeps(root).map((h) => `${h.file}:${h.field}.${h.name}`)).toEqual([
      "package.json:dependencies.a",
      "packages/b/package.json:peerDependencies.p",
      "packages/b/package.json:optionalDependencies.o",
    ])
  })
  test("ignores non-workspace manifests (apps/stackblitz/<demo>)", () => {
    const root = fixture({
      "package.json": ROOT_PKG,
      "apps/stackblitz/01-hello/package.json": { dependencies: { "reactive-agents": "latest" } },
      "packages/a/package.json": { dependencies: { effect: "^3.10.0", x: "*" } },
    })
    expect(workspaceManifests(root)).toEqual(["package.json", "packages/a/package.json"])
    expect(run(root)?.ok).toBe(true)
  })
  test("unsupported workspaces glob fails loudly instead of skipping manifests", () => {
    const root = fixture({ "package.json": JSON.stringify({ workspaces: ["packages/**"] }) })
    const r = run(root)
    expect(r?.ok).toBe(false)
    expect(r?.output).toContain("unsupported workspaces pattern")
  })
  test("real repo passes and covers every root workspace", () => {
    const files = workspaceManifests(REPO)
    expect(files).toContain("apps/cortex/ui/package.json")
    expect(files).toContain("tools/repo/package.json")
    expect(files.some((f) => f.startsWith("apps/stackblitz/"))).toBe(false)
    expect(run(REPO)?.ok).toBe(true)
  })
})
