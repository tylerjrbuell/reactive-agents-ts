import { describe, expect, test } from "bun:test"
import { commands, main, type Streams } from "../src/cli.ts"

function capture(): { s: Streams; out: () => string; err: () => string } {
  let o = ""
  let e = ""
  return {
    s: { stdout: (t) => void (o += t), stderr: (t) => void (e += t) },
    out: () => o,
    err: () => e,
  }
}

describe("repo cli", () => {
  test("help lists non-hidden commands, not hook", async () => {
    const c = capture()
    expect(await main(["help"], c.s)).toBe(0)
    for (const cmd of commands.filter((x) => !x.hidden)) expect(c.out()).toContain(cmd.name)
    expect(c.out()).not.toContain("hook")
  })
  test("no args behaves like help", async () => {
    const a = capture()
    const b = capture()
    expect(await main([], a.s)).toBe(0)
    await main(["help"], b.s)
    expect(a.out()).toBe(b.out())
  })
  test("unknown command exits 2 with next line", async () => {
    const c = capture()
    expect(await main(["nope"], c.s)).toBe(2)
    expect(c.err()).toContain("unknown command: nope")
    expect(c.err().trimEnd().split("\n").at(-1)).toBe("next: bun run repo help")
  })
  test("every command has short summary and example", () => {
    for (const c of commands) {
      expect(c.summary.length).toBeLessThanOrEqual(80)
      expect(c.example.startsWith(`bun run repo ${c.name}`)).toBe(true)
    }
  })
  test("unknown flag exits 2", async () => {
    const c = capture()
    expect(await main(["help", "--bogus"], c.s)).toBe(2)
    expect(c.err()).toContain("next: ")
  })
  test("--json prints valid JSON rows", async () => {
    const c = capture()
    expect(await main(["help", "--json"], c.s)).toBe(0)
    const rows = JSON.parse(c.out()) as { name: string; summary: string; example: string }[]
    expect(rows.map((r) => r.name)).toContain("help")
    expect(Object.keys(rows[0]!).sort()).toEqual(["example", "name", "summary"])
  })
})
