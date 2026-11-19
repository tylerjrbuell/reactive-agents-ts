// Run: bun run repo test tools/repo/tests/update-prices.test.ts
/**
 * Pure logic of scripts/update-prices.ts: reading a rendered snapshot back,
 * row diffing, and the age/staleness rule. Fixture only; no network.
 */
import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { buildPriceSnapshot, renderPriceSnapshotModule } from "@reactive-agents/llm-provider"
import {
  ageReport,
  diffSnapshotRows,
  formatDiff,
  hasDrift,
  isStale,
  parseSnapshotModule,
  snapshotAgeDays,
  STALE_AFTER_DAYS,
} from "../../../scripts/update-prices.ts"

/** Minimal LiteLLM-shaped table: two billable rows, one filtered out. */
const LITELLM = {
  "claude-x": {
    litellm_provider: "anthropic",
    mode: "chat",
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
  },
  "gemini/gemini-y": {
    litellm_provider: "gemini",
    mode: "chat",
    input_cost_per_token: 0.000001,
    output_cost_per_token: 0.000002,
    input_cost_per_token_above_200k_tokens: 0.000002,
  },
  "dall-e": { litellm_provider: "openai", mode: "image_generation", input_cost_per_token: 0, output_cost_per_token: 0 },
}

describe("parseSnapshotModule", () => {
  test("round-trips renderPriceSnapshotModule output", () => {
    const snap = buildPriceSnapshot(LITELLM, "2026-11-01", "https://example.test/p.json")
    const parsed = parseSnapshotModule(renderPriceSnapshotModule(snap))
    expect(parsed).toEqual({ asOf: "2026-11-01", sourceUrl: "https://example.test/p.json", rows: snap.rows })
    expect(Object.keys(parsed.rows)).toEqual(["anthropic:claude-x", "gemini:gemini-y"])
  })

  test("reads the committed snapshot (renderer and parser agree on format)", () => {
    const path = join(import.meta.dir, "../../../packages/llm-provider/src/price-book/snapshot.generated.ts")
    const parsed = parseSnapshotModule(readFileSync(path, "utf8"))
    expect(parsed.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Object.keys(parsed.rows).length).toBeGreaterThan(10)
    expect(renderPriceSnapshotModule(parsed)).toBe(readFileSync(path, "utf8"))
  })

  test("rejects text that is not a rendered snapshot", () => {
    expect(() => parseSnapshotModule("export const X = 1\n")).toThrow(/not a rendered price snapshot/)
  })
})

describe("diffSnapshotRows", () => {
  const before = { "a:1": { input: 1, output: 2 }, "a:2": { input: 3, output: 4 }, "a:3": { input: 5, output: 6 } }
  const after = {
    "a:1": { input: 1, output: 2 },
    "a:2": { input: 2.5, output: 4, cacheRead: 0.25 },
    "a:4": { input: 7, output: 8 },
  }

  test("classifies added, removed and changed rows with field deltas", () => {
    expect(diffSnapshotRows(before, after)).toEqual({
      added: ["a:4"],
      removed: ["a:3"],
      changed: [
        {
          id: "a:2",
          fields: [
            { field: "cacheRead", from: undefined, to: 0.25 },
            { field: "input", from: 3, to: 2.5 },
          ],
        },
      ],
    })
  })

  test("identical rows give an empty diff", () => {
    expect(diffSnapshotRows(before, before)).toEqual({ added: [], removed: [], changed: [] })
  })

  test("formatDiff puts counts first and caps each list", () => {
    const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`m:${i}`, { input: 1, output: 1 }]))
    const lines = formatDiff(diffSnapshotRows({}, many), 3)
    expect(lines[0]).toBe("rows: +25 added, -0 removed, ~0 changed")
    expect(lines.at(-1)).toBe("  ... and 22 more")
    expect(formatDiff(diffSnapshotRows(before, after))).toContain("  a:2: cacheRead - -> 0.25, input 3 -> 2.5")
  })
})

describe("snapshot age", () => {
  test("counts whole days, across month boundaries", () => {
    expect(snapshotAgeDays("2026-11-19", "2026-11-19")).toBe(0)
    expect(snapshotAgeDays("2026-10-31", "2026-11-02")).toBe(2)
  })

  test("stale only strictly past the threshold", () => {
    expect(STALE_AFTER_DAYS).toBe(30)
    expect(isStale("2026-10-20", "2026-11-19")).toBe(false) // 30 days
    expect(isStale("2026-10-19", "2026-11-19")).toBe(true) // 31 days
  })

  test("rejects malformed dates", () => {
    expect(() => snapshotAgeDays("11/19/2026", "2026-11-19")).toThrow(/YYYY-MM-DD/)
  })

  test("ageReport warns past the threshold and ends with next:", () => {
    const fresh = ageReport("2026-11-19", "2026-11-19")
    expect(fresh[0]).not.toContain("STALE")
    const stale = ageReport("2026-01-01", "2026-11-19")
    expect(stale[0]).toContain("STALE (warning only)")
    expect(stale.at(-1)).toMatch(/^next: bun run prices:update/)
  })
})

describe("hasDrift", () => {
  test("any added, removed or changed row is drift; an empty diff is not", () => {
    expect(hasDrift({ added: [], removed: [], changed: [] })).toBe(false)
    expect(hasDrift({ added: ["a:1"], removed: [], changed: [] })).toBe(true)
    expect(hasDrift({ added: [], removed: [], changed: [{ id: "a:1", fields: [] }] })).toBe(true)
  })
})

describe("check-prices gate", () => {
  const REPO = join(import.meta.dir, "../../..")

  test("is offline: never downloads, even with a reachable-looking URL configured", () => {
    // Port 9 (discard) refuses connections; an online check would print "source unreachable".
    const r = spawnSync("bash", ["scripts/check-prices.sh"], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, LITELLM_PRICES_URL: "http://127.0.0.1:9/prices.json", PRICES_OFFLINE: "" },
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("drift: skipped (offline gate")
    expect(r.stdout).not.toContain("unreachable")
    expect(r.stdout).toMatch(/^age: snapshot asOf \d{4}-\d{2}-\d{2}/m)
  })

  test("the gate script passes --offline and the check path always returns 0", () => {
    const sh = readFileSync(join(REPO, "scripts/check-prices.sh"), "utf8")
    expect(sh).toContain("--check --offline")
    const src = readFileSync(join(REPO, "scripts/update-prices.ts"), "utf8")
    const checkFn = src.slice(src.indexOf("async function check("), src.indexOf("async function main("))
    expect(checkFn).toContain("return 0")
    expect(checkFn).not.toMatch(/return 1|process\.exit/)
  })
})
