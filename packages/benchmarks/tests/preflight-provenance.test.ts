// Run: bun run repo test packages/benchmarks/tests/preflight-provenance.test.ts
//
// Measurement overhaul Phase 0.2 / 0.3 (audit 03 D3, D4, D6). Zero tokens, no host
// dependence: the contention DECISION and the proc parser are pure; hashing runs on a
// temp dir; wiring into run-h3.ts is pinned from source (runH3 itself would call a live model).
import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DEFAULT_CELL_TIMEOUT_SEC,
  SCORER_VERSION,
  collectProvenance,
  countOllamaClients,
  evaluateContention,
  formatContention,
  hashDirectory,
  preflightEntry,
  provenanceDrift,
  raEnvFlags,
} from "../src/preflight-provenance.js"
import { tracedTokensOf } from "../src/h3/report.js"
import { withRecoveredTokens } from "../src/h3/verdict.js"
import type { H3Cell } from "../src/h3/run-h3.js"

describe("contention decision (0.3)", () => {
  const quiet = { ours: ["cogito:8b"], loaded: ["cogito:8b"], loadAvg1: 1, cpus: 16, clients: 0 }
  it("a quiet host is ok", () => {
    expect(evaluateContention(quiet).ok).toBe(true)
  })
  it("a foreign loaded model is flagged; :latest and our own models are not", () => {
    expect(evaluateContention({ ...quiet, loaded: ["cogito:8b:latest"] }).ok).toBe(true)
    const r = evaluateContention({ ...quiet, loaded: ["cogito:8b", "nimble:7b"] })
    expect(r.ok).toBe(false)
    expect(r.foreignLoaded).toEqual(["nimble:7b"])
    expect(r.findings[0]).toContain("nimble:7b")
  })
  it("a foreign client connection on the Ollama port is flagged", () => {
    expect(evaluateContention({ ...quiet, clients: 2 }).findings[0]).toContain("2 established client connection")
  })
  it("host load above the per-CPU threshold is flagged and configurable", () => {
    expect(evaluateContention({ ...quiet, loadAvg1: 9, cpus: 8 }).ok).toBe(false)
    expect(evaluateContention({ ...quiet, loadAvg1: 9, cpus: 8, maxLoadPerCpu: 2 }).ok).toBe(true)
  })
  it("unreachable Ollama is not a foreign-model finding (non-Ollama benches are not contended by it)", () => {
    const r = evaluateContention({ ...quiet, loaded: null, clients: null })
    expect(r.ok).toBe(true)
    expect(r.ollamaReachable).toBe(false)
  })
  it("refusal text says how to proceed; the allowed text says it is recorded", () => {
    const r = evaluateContention({ ...quiet, clients: 1 })
    expect(formatContention(r, false)).toContain("PREFLIGHT REFUSED")
    expect(formatContention(r, false)).toContain("--allow-contention")
    expect(formatContention(r, true)).toContain("PREFLIGHT WARNING")
    expect(preflightEntry(r, true)).toMatchObject({ ok: false, allowed: true, ollamaClients: 1 })
  })
  it("counts ESTABLISHED connections whose local port is 11434, and nothing else", () => {
    const proc = [
      "  sl  local_address rem_address   st tx_queue rx_queue",
      "   0: 0100007F:2CAA 0100007F:9C40 01 00000000:00000000 00:00000000 00000000  1000",
      "   1: 0100007F:2CAA 0100007F:9C41 06 00000000:00000000 00:00000000 00000000  1000",
      "   2: 0100007F:9C40 0100007F:2CAA 01 00000000:00000000 00:00000000 00000000  1000",
      "   3: 00000000:2CAA 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000",
    ].join("\n")
    expect(countOllamaClients(proc)).toBe(1)
  })
})

describe("provenance (0.2)", () => {
  it("defaults: cell timeout 180 (skill + every baseline), scorerVersion a number W2 can bump", () => {
    expect(DEFAULT_CELL_TIMEOUT_SEC).toBe(180)
    expect(typeof SCORER_VERSION).toBe("number")
  })
  it("RA_* flags are recorded, secret-looking names redacted, others ignored", () => {
    expect(raEnvFlags({ RA_LEAN_FINAL_TURN: "1", RA_API_KEY: "sekret", PATH: "/bin" })).toEqual({
      RA_API_KEY: "<redacted>",
      RA_LEAN_FINAL_TURN: "1",
    })
  })
  it("a directory hash is stable and changes with content or a new file; missing dir is null", () => {
    const dir = mkdtempSync(join(tmpdir(), "prov-"))
    try {
      mkdirSync(join(dir, "d"))
      writeFileSync(join(dir, "d", "a.js"), "one")
      const h1 = hashDirectory(join(dir, "d"))
      expect(h1).toBe(hashDirectory(join(dir, "d")))
      writeFileSync(join(dir, "d", "a.js"), "two")
      const h2 = hashDirectory(join(dir, "d"))
      expect(h2).not.toBe(h1)
      writeFileSync(join(dir, "d", "b.js"), "x")
      expect(hashDirectory(join(dir, "d"))).not.toBe(h2)
      expect(hashDirectory(join(dir, "nope"))).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it("collectProvenance carries every field the audit named", async () => {
    const p = await collectProvenance({ gitSha: "abc", cellTimeoutSec: 180, startMarginSec: 200, budgetSec: 560, models: [], preflight: [] })
    expect(p).toMatchObject({ gitSha: "abc", scorerVersion: SCORER_VERSION, cellTimeoutSec: 180, startMarginSec: 200, budgetSec: 560, modelDigests: {} })
    expect(p).toHaveProperty("reasoningDistHash")
    expect(p).toHaveProperty("raEnv")
  })
  it("drift names what changed between chunks", async () => {
    const base = await collectProvenance({ gitSha: "abc", cellTimeoutSec: 180, startMarginSec: 200, budgetSec: 560, models: [], preflight: [] })
    expect(provenanceDrift(base, base)).toEqual([])
    const drifted = { ...base, cellTimeoutSec: 150, scorerVersion: base.scorerVersion + 1, raEnv: { RA_X: "1" }, reasoningDistHash: "other", modelDigests: {} }
    const d = provenanceDrift(base, drifted).join(" | ")
    expect(d).toContain("cell timeout 180s -> 150s")
    expect(d).toContain("scorerVersion")
    expect(d).toContain("RA_* env flags changed")
    expect(d).toContain("dist hash")
  })
  // wire it AND pin it: the runner must stamp provenance, preflight, and use the shared default.
  it("run-h3.ts wires provenance, contention preflight and the 180s default", () => {
    const src = readFileSync(join(import.meta.dir, "..", "src", "h3", "run-h3.ts"), "utf8")
    expect(src).toContain('arg("cell-timeout-sec", String(DEFAULT_CELL_TIMEOUT_SEC))')
    expect(src).toContain("await checkContention(")
    expect(src).toContain("await collectProvenance(")
    expect(src).toContain("provenance: fresh")
    expect(src).toContain("--allow-contention")
    expect(src).not.toContain('"cell-timeout-sec", "150"')
  })
  it("run.ts refuses a contended host before a live Ollama session unless --allow-contention", () => {
    const src = readFileSync(join(import.meta.dir, "..", "src", "run.ts"), "utf8")
    expect(src).toContain("checkContention(")
    expect(src).toContain('case "--allow-contention"')
  })
})

describe("timed-out cells keep their tokens (0.2, audit 03 D3)", () => {
  const traceLine = (seq: number, tokensIn: number, tokensOut: number, cacheRead = 0): string =>
    JSON.stringify({
      kind: "llm-exchange", runId: "r", seq, timestamp: seq, iter: 0, provider: "ollama", model: "m", requestKind: "stream",
      systemPrompt: "", messages: [], toolSchemaNames: [], response: { content: "x", tokensIn, tokensOut, cacheReadTokensIn: cacheRead },
    })
  it("sums llm-exchange tokens from a partial trace: raw = in + out, billed = (in - cache) + out", () => {
    const dir = mkdtempSync(join(tmpdir(), "tok-"))
    try {
      const f = join(dir, "t.jsonl")
      writeFileSync(f, [traceLine(0, 100, 20), traceLine(1, 200, 30, 50), '{"torn":'].join("\n"))
      expect(tracedTokensOf(f)).toEqual({ tokens: 350, billed: 300 })
      expect(tracedTokensOf(join(dir, "missing.jsonl"))).toBeNull()
      expect(tracedTokensOf(null)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  const timedOut = (over: Partial<H3Cell> = {}): H3Cell => ({
    cellId: "m|t|0", taskId: "t", variant: "ra-default", tier: "m", run: 0, accuracy: null, solved: false, status: "error",
    inconclusive: true, error: "execution-timeout", tokens: 0, billedTokens: null, durationMs: 180000, iterations: null,
    terminatedBy: null, causeLabel: "none", causeAuthority: null, toolSurface: [], traceFile: "/t.jsonl", traceDir: "/",
    failureModes: [], honestyLabel: null, ...over,
  })
  it("withRecoveredTokens fills a zero-token timeout from its trace and leaves reported cells alone", () => {
    const fake = (): { tokens: number; billed: number } => ({ tokens: 900, billed: 800 })
    const [filled, kept, noTrace] = withRecoveredTokens(
      [timedOut(), timedOut({ billedTokens: 5, tokens: 6 }), timedOut({ traceFile: null })],
      (f) => (f === null ? null : fake()),
    )
    expect(filled).toMatchObject({ tokens: 900, billedTokens: 800 })
    expect(kept).toMatchObject({ tokens: 6, billedTokens: 5 })
    expect(noTrace).toMatchObject({ tokens: 0, billedTokens: null })
  })
})
