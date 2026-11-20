import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { builtins, type BuiltinCtx } from "../src/lib/builtins.ts"
import type { CheckEntry } from "../src/lib/manifest.ts"
import { buildEntries, KNOWN_UNSHIPPED, triage, unshippedLoads, type UnshippedLoad } from "../src/lib/shipped-assets.ts"

const REPO = resolve(import.meta.dir, "..", "..", "..")
const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

function fixture(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "repo-shipped-assets-"))
  dirs.push(root)
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(root, p, ".."), { recursive: true })
    writeFileSync(join(root, p), typeof c === "string" ? c : JSON.stringify(c))
  }
  return root
}

const BASE = `import { defineConfig } from "tsup";\nexport default defineConfig({ entry: ["src/index.ts"], format: ["esm"] });\n`
const pkg = (extra: Record<string, unknown> = {}) => ({ name: "@x/r", scripts: { build: "tsup" }, files: ["dist", "README.md"], ...extra })
const withWorker = `import { defineConfig } from "tsup";\nimport baseConfig from "../../tsup.config.base.js";\nexport default defineConfig({ ...baseConfig, entry: { index: "src/index.ts", "sandbox-worker": "src/sandbox-worker.ts" } });\n`
const noWorker = `import { defineConfig } from "tsup";\nimport baseConfig from "../../tsup.config.base.js";\nexport default defineConfig({ ...baseConfig, entry: { index: "src/index.ts" } });\n`
// v0.19.0 shape: the worker URL always names the .ts source.
const hardcoded = `import { Worker } from "node:worker_threads";\nexport const run = () => new Worker(new URL("./sandbox-worker.ts", import.meta.url));\n`
// dev shape (reasoning sandboxWorkerUrl): extension chosen per layout.
const perLayout = `export function sandboxWorkerUrl(moduleUrl: string = import.meta.url): URL {\n  const fromSource = new URL(moduleUrl).pathname.endsWith(".ts");\n  return new URL(fromSource ? "./sandbox-worker.ts" : "./sandbox-worker.js", moduleUrl);\n}\n`

function reasoning(src: string, cfg: string, manifest: Record<string, unknown> = pkg(), more: Record<string, string> = {}): string {
  return fixture({
    "tsup.config.base.ts": BASE,
    "packages/r/package.json": manifest,
    "packages/r/tsup.config.ts": cfg,
    "packages/r/src/sandbox.ts": src,
    "packages/r/src/sandbox-worker.ts": "export {}\n",
    ...more,
  })
}

const entry = { id: "shipped-assets", script: "builtin:shipped-assets", scope: [], stages: [], owner: "x", reviewBy: "2099-01-01" } as unknown as CheckEntry
const ctx: BuiltinCtx = { today: "2026-11-20", commandNames: [] }
const run = (root: string) => builtins["shipped-assets"]?.(root, entry, ctx)
const files = (root: string) => unshippedLoads(root).loads.map((l) => `${l.file}:${l.line} ${l.resolved.join("|")}`)

describe("shipped-assets: the v0.19.0 sandbox-worker class", () => {
  test("v0.19.0: hardcoded ./sandbox-worker.ts with no tsup entry is red, naming file, line and dist path", () => {
    const r = run(reasoning(hardcoded, noWorker))
    expect(r?.ok).toBe(false)
    expect(r?.output).toContain('packages/r/src/sandbox.ts:2: loads "./sandbox-worker.ts"')
    expect(r?.output).toContain("dist/sandbox-worker.ts")
  })
  test("a hardcoded .ts worker is red even with the tsup entry (dist emits .js)", () => {
    expect(files(reasoning(hardcoded, withWorker))).toEqual(["packages/r/src/sandbox.ts:2 dist/sandbox-worker.ts"])
  })
  test("per-layout extension + tsup entry is green; removing the entry turns it red", () => {
    expect(files(reasoning(perLayout, withWorker))).toEqual([])
    expect(files(reasoning(perLayout, noWorker))).toEqual(["packages/r/src/sandbox.ts:3 dist/sandbox-worker.ts|dist/sandbox-worker.js"])
  })
  test("private packages and packages without a build are skipped", () => {
    expect(files(reasoning(hardcoded, noWorker, pkg({ private: true })))).toEqual([])
    expect(files(reasoning(hardcoded, noWorker, { name: "@x/r" }))).toEqual([])
  })
})

describe("shipped-assets: join(<module dir>, ...) and fallbacks", () => {
  const joinSrc = (body: string) => `import { dirname, join } from "node:path";\nimport { fileURLToPath } from "node:url";\nconst here = dirname(fileURLToPath(import.meta.url));\n${body}\n`
  test("an asset dir next to the module is red (dist/<dir> is never emitted)", () => {
    const root = reasoning(joinSrc(`export const p = () => join(here, "sandbox-image", "seccomp.json");`), noWorker)
    expect(files(root)).toEqual(["packages/r/src/sandbox.ts:4 dist/sandbox-image/seccomp.json"])
  })
  test("a dist-then-src fallback list is green when `files` ships the src path and it exists", () => {
    const src = joinSrc(`export const c = (k: string) => [join(here, "calibrations", \`\${k}.json\`), join(here, "..", "src", "calibrations", \`\${k}.json\`)];`)
    const shipped = reasoning(src, noWorker, pkg({ files: ["dist", "src/calibrations"] }), { "packages/r/src/calibrations/a.json": "{}" })
    expect(files(shipped)).toEqual([])
    const notListed = reasoning(src, noWorker, pkg(), { "packages/r/src/calibrations/a.json": "{}" })
    expect(files(notListed)).toEqual(["packages/r/src/sandbox.ts:4 dist/calibrations|src/calibrations"])
  })
  test("for..of over a const candidate array reaching package.json is green", () => {
    const src = `import { readFileSync } from "node:fs";\nconst CANDIDATES = ["../package.json", "../../package.json"] as const;\nexport function v() { for (const c of CANDIDATES) { try { return readFileSync(new URL(c, import.meta.url), "utf8") } catch {} } }\n`
    expect(files(reasoning(src, noWorker))).toEqual([])
  })
  test("createRequire(import.meta.url), isMain(import.meta.url) and bare new URL(import.meta.url) are not loads", () => {
    const src = `import { createRequire } from "node:module";\ndeclare const isMain: (u: string) => boolean;\nexport const r = createRequire(import.meta.url);\nexport const m = isMain(import.meta.url);\nexport const p = new URL(import.meta.url).pathname;\n`
    expect(files(reasoning(src, noWorker))).toEqual([])
  })
})

describe("shipped-assets: build-time copies (tsup onSuccess cpSync/copyFileSync)", () => {
  const src = `import { dirname, join } from "node:path";\nimport { fileURLToPath } from "node:url";\nconst here = dirname(fileURLToPath(import.meta.url));\nexport const profile = () => join(here, "sandbox-image", "seccomp.json");\nexport const ctx = () => join(here, "sandbox-image");\n`
  const cfg = (onSuccess: string) =>
    `import { cpSync, copyFileSync } from "node:fs";\nimport { defineConfig } from "tsup";\nimport baseConfig from "../../tsup.config.base.js";\nexport default defineConfig({ ...baseConfig, entry: { index: "src/index.ts" }, onSuccess: async () => { ${onSuccess} } });\n`
  const image = { "packages/r/src/execution/sandbox-image/seccomp.json": "{}", "packages/r/src/execution/sandbox-image/Dockerfile": "FROM x\n" }
  const RED = ["packages/r/src/sandbox.ts:4 dist/sandbox-image/seccomp.json", "packages/r/src/sandbox.ts:5 dist/sandbox-image"]

  test("a recursive directory copy ships the dir and files under it (the packages/tools fix)", () => {
    const fixed = reasoning(src, cfg(`cpSync("src/execution/sandbox-image", "dist/sandbox-image", { recursive: true });`), pkg(), image)
    expect(files(fixed)).toEqual([])
  })
  test("cutting the copy turns it red", () => {
    expect(files(reasoning(src, cfg(""), pkg(), image))).toEqual(RED)
  })
  test("a single-file copy ships only that file", () => {
    const one = reasoning(src, cfg(`copyFileSync("./src/execution/sandbox-image/seccomp.json", "dist/sandbox-image/seccomp.json");`), pkg(), image)
    expect(files(one)).toEqual(["packages/r/src/sandbox.ts:5 dist/sandbox-image"])
  })
  test("a copy whose source does not exist is still red", () => {
    expect(files(reasoning(src, cfg(`cpSync("src/missing-image", "dist/sandbox-image", { recursive: true });`), pkg(), image))).toEqual(RED)
  })
  test("a directory copy without recursive: true is red (cpSync throws on a dir)", () => {
    expect(files(reasoning(src, cfg(`cpSync("src/execution/sandbox-image", "dist/sandbox-image");`), pkg(), image))).toEqual(RED)
  })
  test("a non-literal copy is ignored", () => {
    const dyn = cfg(`const from = "src/execution/sandbox-image"; cpSync(from, \`dist/\${"sandbox-image"}\`, { recursive: true });`)
    expect(files(reasoning(src, dyn, pkg(), image))).toEqual(RED)
  })
})

describe("buildEntries", () => {
  test("reads tsup config entries through spreads, --config files and CLI entries", () => {
    const root = reasoning(perLayout, withWorker, pkg(), {
      "packages/b/tsup.config.ts": `import base from "../../tsup.config.base.ts";\nexport default base;\n`,
    })
    expect([...buildEntries(join(root, "packages/r"), "tsup")]).toEqual(["index", "sandbox-worker"])
    expect([...buildEntries(join(root, "packages/b"), "tsup")]).toEqual(["index"])
    expect([...buildEntries(join(root, "packages/r"), "tsup --config ../../tsup.config.base.ts && tsup src/cli.ts --format esm --out-dir dist")]).toEqual(["index", "cli"])
    expect([...buildEntries(join(root, "packages/r"), "tsup src/index.ts src/testing.ts --format esm --dts --out-dir dist")]).toEqual(["index", "testing"])
  })
})

describe("triage", () => {
  const load: UnshippedLoad = { file: "packages/t/src/a.ts", line: 3, candidates: ["img"], resolved: ["dist/img"], pkg: "packages/t" }
  const known = [{ file: "packages/t/src/a.ts", target: "dist/img", owner: "o", until: "2026-12-01", why: "w" }]
  test("known before `until` warns, after it fails; unmatched known entries are stale", () => {
    expect(triage([load], "2026-11-20", known).warned.length).toBe(1)
    expect(triage([load], "2026-12-02", known).expired.length).toBe(1)
    expect(triage([], "2026-11-20", known).stale).toEqual(known)
    expect(triage([load], "2026-11-20", []).fresh).toEqual([load])
  })
})

describe("real repo", () => {
  test("passes; every finding is a KNOWN_UNSHIPPED entry and reasoning's sandbox worker is not among them", () => {
    const r = run(REPO)
    expect(r?.ok).toBe(true)
    const { loads } = unshippedLoads(REPO)
    expect(loads.some((l) => l.file.includes("code-action/sandbox.ts"))).toBe(false)
    // packages/tools copies src/execution/sandbox-image to dist/ in tsup onSuccess.
    expect(loads.some((l) => l.file.includes("execution/docker-sandbox.ts"))).toBe(false)
    expect(triage(loads, "2026-11-20").fresh).toEqual([])
    expect(KNOWN_UNSHIPPED.length).toBeGreaterThan(0)
  })
})
