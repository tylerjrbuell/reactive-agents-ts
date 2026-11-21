import { describe, expect, test } from "bun:test"
import dns from "node:dns"
import { lookup, resolve4 } from "node:dns/promises"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ALLOW_DNS_ENV, blockedDnsError, DNS_TRACE_ENV, dnsAllowlist, installDnsGuard, isHermeticHost } from "../src/lib/dns-guard.ts"

// The root preload installs the guard; a deliberate live run (REPO_TEST_ALLOW_DNS=1) skips the live checks.
const guarded = process.env[ALLOW_DNS_ENV] !== "1"

async function rejectionOf(p: Promise<unknown>): Promise<{ err: unknown; ms: number }> {
  const t0 = performance.now()
  try {
    await p
    return { err: undefined, ms: performance.now() - t0 }
  } catch (err) {
    return { err, ms: performance.now() - t0 }
  }
}

describe("isHermeticHost", () => {
  test("allows localhost, *.localhost, IP literals and the allowlist", () => {
    for (const h of ["localhost", "LOCALHOST.", "app.localhost", "127.0.0.1", "::1", "[::1]", "192.168.1.50", ""]) {
      expect(isHermeticHost(h)).toBe(true)
    }
    expect(isHermeticHost("gpu-box", ["gpu-box"])).toBe(true)
  })
  test("rejects every other name", () => {
    for (const h of ["gpu-box", "api.openai.com", "localhost.example.com", "ollama"]) expect(isHermeticHost(h)).toBe(false)
  })
  test("allowlist env is comma separated and normalized", () => {
    expect(dnsAllowlist({ REPO_TEST_DNS_ALLOW: " Gpu-Box , api.example.com.,," })).toEqual(["gpu-box", "api.example.com"])
  })
  test("the error is ENOTFOUND-shaped and names the host and the fix", () => {
    const err = blockedDnsError("gpu-box") as Error & { code: string; hostname: string }
    expect(err.code).toBe("ENOTFOUND")
    expect(err.hostname).toBe("gpu-box")
    expect(err.message).toContain(`test tried real DNS for "gpu-box"`)
    expect(err.message).toContain("inject a resolver")
    expect(err.message).toContain("REPO_TEST_ALLOW_DNS=1")
  })
})

describe.skipIf(!guarded)("installed by the test preload", () => {
  test("node:dns/promises lookup of gpu-box rejects in < 50 ms", async () => {
    const { err, ms } = await rejectionOf(lookup("gpu-box", { all: true }))
    expect((err as { code?: string }).code).toBe("ENOTFOUND")
    expect((err as Error).message).toContain(`"gpu-box"`)
    console.log(`dns-guard: lookup("gpu-box") rejected in ${ms.toFixed(2)} ms`)
    expect(ms).toBeLessThan(50)
  })
  test("callback lookup, resolve4, a Resolver instance and fetch are blocked fast", async () => {
    const cb = await rejectionOf(
      new Promise((resolve, reject) => dns.lookup("gpu-box", (e, a) => (e ? reject(e) : resolve(a)))),
    )
    expect((cb.err as { code?: string }).code).toBe("ENOTFOUND")
    const r4 = await rejectionOf(resolve4("gpu-box"))
    expect((r4.err as { code?: string }).code).toBe("ENOTFOUND")
    const inst = await rejectionOf(new dns.promises.Resolver().resolve4("gpu-box"))
    expect((inst.err as { code?: string }).code).toBe("ENOTFOUND")
    const f = await rejectionOf(fetch("http://gpu-box:11434/api/tags"))
    expect((f.err as Error).message).toContain(`"gpu-box"`)
    for (const r of [cb, r4, inst, f]) expect(r.ms).toBeLessThan(50)
  })
  test("localhost still resolves", async () => {
    const addrs = await lookup("localhost", { all: true })
    expect(addrs.length).toBeGreaterThan(0)
  })
})

describe("installDnsGuard on fake targets", () => {
  const fakes = () => {
    const calls: string[] = []
    const bunDns = { lookup: async (h: string) => (calls.push(`lookup:${h}`), [{ address: "10.0.0.1" }]) }
    const proto = { resolve4: async (h: string) => (calls.push(`resolve4:${h}`), ["10.0.0.1"]) }
    const globals = { fetch: Object.assign(async (u: string) => (calls.push(`fetch:${u}`), new Response("ok")), { preconnect: () => undefined }) }
    const bun = { connect: async (o: { hostname: string }) => (calls.push(`connect:${o.hostname}`), {}) }
    return { calls, bunDns, proto, globals, bun, targets: { bunDns, resolverPrototypes: [proto], globals, bun } }
  }
  test("blocks names, passes hermetic hosts through, and uninstalls", async () => {
    const f = fakes()
    const uninstall = installDnsGuard({}, f.targets)
    expect(uninstall).toBeDefined()
    expect(installDnsGuard({}, f.targets)).toBeUndefined() // idempotent
    await expect(f.bunDns.lookup("gpu-box")).rejects.toThrow(`"gpu-box"`)
    await expect(f.proto.resolve4("gpu-box")).rejects.toThrow(`"gpu-box"`)
    await expect(f.globals.fetch("https://gpu-box/x")).rejects.toThrow(`"gpu-box"`)
    await expect(f.bun.connect({ hostname: "gpu-box" })).rejects.toThrow(`"gpu-box"`)
    await f.bunDns.lookup("localhost")
    await f.globals.fetch("http://127.0.0.1:1/")
    await f.globals.fetch("data:text/plain,hi")
    expect(typeof f.globals.fetch.preconnect).toBe("function")
    expect(f.calls).toEqual(["lookup:localhost", "fetch:http://127.0.0.1:1/", "fetch:data:text/plain,hi"])
    uninstall?.()
    await f.bunDns.lookup("gpu-box")
    expect(f.calls.at(-1)).toBe("lookup:gpu-box")
  })
  test("REPO_TEST_ALLOW_DNS=1 installs nothing", async () => {
    const f = fakes()
    const before = f.bunDns.lookup
    expect(installDnsGuard({ [ALLOW_DNS_ENV]: "1" }, f.targets)).toBeUndefined()
    expect(f.bunDns.lookup).toBe(before)
    await f.bunDns.lookup("gpu-box")
    expect(f.calls).toEqual(["lookup:gpu-box"])
  })
  test("REPO_TEST_DNS_TRACE records each blocked call with its test-file frame", async () => {
    const f = fakes()
    const file = join(mkdtempSync(join(tmpdir(), "dns-trace-")), "trace.jsonl")
    installDnsGuard({ [DNS_TRACE_ENV]: file }, f.targets)
    await f.globals.fetch("http://gpu-box:11434/").catch(() => undefined)
    await f.bunDns.lookup("gpu-box").catch(() => undefined)
    await f.proto.resolve4("gpu-box").catch(() => undefined)
    await f.bun.connect({ hostname: "gpu-box" }).catch(() => undefined)
    const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { host: string; api: string; at: string })
    expect(rows.map((r) => r.api)).toEqual(["fetch", "Bun.dns.lookup", "Resolver.resolve4", "Bun.connect"])
    // Each wrapper captures its stack at entry; a stack taken deeper intermittently lost every caller frame.
    for (const r of rows) {
      expect(r.host).toBe("gpu-box")
      expect(r.at).toContain("dns-guard.test.ts")
    }
  })
  test("REPO_TEST_DNS_ALLOW lets a named host through", async () => {
    const f = fakes()
    installDnsGuard({ REPO_TEST_DNS_ALLOW: "gpu-box" }, f.targets)
    await f.bunDns.lookup("gpu-box")
    await expect(f.bunDns.lookup("other-box")).rejects.toThrow(`"other-box"`)
    expect(f.calls).toEqual(["lookup:gpu-box"])
  })
})
