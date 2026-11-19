// H3 tier table: the gemini-2.5-flash frontier tier resolves, and a missing key
// fails early with a tagged error before any cell (or API spend) starts.
import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { H3_TIERS, H3TierKeyError, runH3, tierKeyError } from "../src/h3/run-h3.js"

describe("H3_TIERS gemini-2.5-flash", () => {
  it("resolves with provider gemini and the frontier context tier", () => {
    expect(H3_TIERS["gemini-2.5-flash"]).toEqual({ id: "gemini-2.5-flash", provider: "gemini", model: "gemini-2.5-flash", contextTier: "frontier" })
  })

  it("keeps the local tiers unchanged", () => {
    for (const t of ["qwen3:4b", "cogito:8b", "bonsai-2:27b"]) expect(H3_TIERS[t]?.provider).toBe("ollama")
  })
})

describe("tierKeyError", () => {
  it("returns a tagged error naming the tier and GOOGLE_API_KEY when the key is missing or blank", () => {
    for (const env of [{}, { GOOGLE_API_KEY: "" }, { GOOGLE_API_KEY: "  " }]) {
      const e = tierKeyError(["gemini-2.5-flash"], env)
      expect(e).toBeInstanceOf(H3TierKeyError)
      expect(e?._tag).toBe("H3TierKeyError")
      expect(e?.envVar).toBe("GOOGLE_API_KEY")
      expect(e?.message).toContain("gemini-2.5-flash")
    }
  })

  it("is null with a key set, and for keyless local tiers", () => {
    expect(tierKeyError(["gemini-2.5-flash"], { GOOGLE_API_KEY: "k" })).toBeNull()
    expect(tierKeyError(["qwen3:4b", "cogito:8b"], {})).toBeNull()
  })

  it("flags the keyed tier in a mixed list", () => {
    expect(tierKeyError(["qwen3:4b", "gemini-2.5-flash"], {})?.tier).toBe("gemini-2.5-flash")
  })
})

describe("runH3 key gate", () => {
  const saved = process.env.GOOGLE_API_KEY
  let dir = ""
  afterEach(() => {
    if (saved === undefined) delete process.env.GOOGLE_API_KEY
    else process.env.GOOGLE_API_KEY = saved
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it("refuses before starting any cell when the gemini key is absent", async () => {
    delete process.env.GOOGLE_API_KEY
    dir = mkdtempSync(join(tmpdir(), "h3tier-"))
    const r = await runH3({ out: join(dir, "r.json"), traceRoot: join(dir, "t"), tiers: ["gemini-2.5-flash"], k: 1, budgetSec: 100, cellTimeoutSec: 10 })
    expect(r.ran).toBe(0)
    expect(r.error).toContain("GOOGLE_API_KEY")
  })
})
