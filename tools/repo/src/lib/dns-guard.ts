import dns from "node:dns"
import { appendFileSync } from "node:fs"
import { isIP } from "node:net"

/**
 * Test DNS guard (2026-11-20 CI/local divergence). A test that names a made-up host (`gpu-box`) and lets
 * it reach the system resolver passes or fails on the machine, not the code: systemd-resolved takes ~4 s
 * to return ENOTFOUND for a single-label name (Bun's fetch took 7.6 s), which timed out a 5 s test under
 * load. Installed by the test preload, the guard makes every lookup of a non-hermetic name fail at once
 * with an ENOTFOUND-shaped error that names the host and the fix.
 *
 * Coverage (measured on Bun 1.3.10): node:dns and node:dns/promises `lookup`/`resolve*`, named or default
 * imports, all route through `Bun.dns`, so wrapping `Bun.dns` covers them and every `node:net`/`node:http`
 * connect. `Resolver` instances use their own binding (prototypes wrapped here). Bun's `fetch` and
 * `Bun.connect` resolve natively and bypass `Bun.dns`, so the guard checks their hostname itself. Not
 * covered: `WebSocket`, `Bun.dns.reverse`/`lookupService` (they take IPs), and child processes.
 */

/** Set to `1` to let a deliberate live test use real DNS (the guard is not installed). */
export const ALLOW_DNS_ENV = "REPO_TEST_ALLOW_DNS"
/** Comma-separated extra host names the guard lets through (e.g. `REPO_TEST_DNS_ALLOW=api.example.com`). */
export const DNS_ALLOWLIST_ENV = "REPO_TEST_DNS_ALLOW"

type Env = Readonly<Record<string, string | undefined>>
type Fn = (this: unknown, ...args: unknown[]) => unknown
type Mutable = Record<string | symbol, unknown>

/** The `Bun.dns` members that take a host name. */
const BUN_DNS_NAME_METHODS: readonly string[] = [
  "lookup", "resolve", "resolveSrv", "resolveTxt", "resolveSoa", "resolveNaptr", "resolveMx", "resolveCaa",
  "resolveNs", "resolvePtr", "resolveCname", "resolveAny", "prefetch",
]
/** The `Resolver` prototype members that take a host name. */
const RESOLVER_NAME_METHODS: readonly string[] = [
  "resolve", "resolve4", "resolve6", "resolveAny", "resolveCaa", "resolveCname", "resolveMx", "resolveNaptr",
  "resolveNs", "resolvePtr", "resolveSoa", "resolveSrv", "resolveTxt",
]
const INSTALLED = Symbol.for("reactive-agents.test-dns-guard")

/** Lower-case, drop IPv6 brackets and a trailing root dot. */
function normalizeHost(host: string): string {
  const h = host.trim().toLowerCase()
  const unbracketed = h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h
  return unbracketed.endsWith(".") ? unbracketed.slice(0, -1) : unbracketed
}

/** Extra allowed names from `REPO_TEST_DNS_ALLOW`. */
export function dnsAllowlist(env: Env = process.env): readonly string[] {
  return (env[DNS_ALLOWLIST_ENV] ?? "").split(",").map(normalizeHost).filter((h) => h.length > 0)
}

/**
 * True when resolving `host` never needs the system resolver: an empty name, `localhost`, `*.localhost`,
 * an IP literal, or a name in `allow`.
 */
export function isHermeticHost(host: string, allow: readonly string[] = []): boolean {
  const h = normalizeHost(host)
  return h === "" || h === "localhost" || h.endsWith(".localhost") || isIP(h) !== 0 || allow.includes(h)
}

/** The ENOTFOUND-shaped error a blocked lookup rejects with, naming the host and the fix. */
export function blockedDnsError(host: string, syscall = "getaddrinfo"): Error {
  const message =
    `test tried real DNS for "${host}"; inject a resolver (or a fetch stub) so the test never reaches the network. ` +
    `Deliberate live test: ${ALLOW_DNS_ENV}=1; one host: ${DNS_ALLOWLIST_ENV}=${host}`
  return Object.assign(new Error(message), { code: "ENOTFOUND", errno: -3008, syscall, hostname: host })
}

/**
 * Audit aid: with `REPO_TEST_DNS_TRACE=<file>`, every blocked call appends `{ host, api, at }` (the first
 * test-file stack frame) as one JSON line, so tests that pass while swallowing the error are found too.
 */
export const DNS_TRACE_ENV = "REPO_TEST_DNS_TRACE"

function traceBlocked(env: Env, host: string, api: string): void {
  const file = env[DNS_TRACE_ENV]
  if (file === undefined || file.length === 0) return
  try {
    const frames = (new Error().stack ?? "").split("\n").slice(1).map((l) => l.trim()).filter((l) => !l.includes("dns-guard.ts"))
    const at = frames.find((l) => /\.(test|spec)\.[cm]?[jt]sx?:/.test(l)) ?? frames.slice(0, 3).join(" < ")
    appendFileSync(file, `${JSON.stringify({ host, api, at })}\n`)
  } catch {
    // tracing is best effort
  }
}

/** The objects the guard patches; the defaults are the real runtime, tests pass fakes. */
export interface DnsGuardTargets {
  readonly bunDns: object
  readonly resolverPrototypes: readonly object[]
  readonly globals: object
  readonly bun: object
}

function realTargets(): DnsGuardTargets {
  return {
    bunDns: Bun.dns,
    resolverPrototypes: [dns.Resolver.prototype, dns.promises.Resolver.prototype],
    globals: globalThis,
    bun: Bun,
  }
}

/** The host a `fetch` input targets, or undefined when it needs no DNS (data:, blob:, file:, a unix socket). */
function fetchHost(input: unknown, init: unknown): string | undefined {
  if (typeof init === "object" && init !== null && typeof (init as Mutable).unix === "string") return undefined
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input instanceof Request ? input.url : undefined
  if (raw === undefined) return undefined
  try {
    const url = new URL(raw)
    return /^(https?|wss?):$/.test(url.protocol) ? url.hostname : undefined
  } catch {
    return undefined
  }
}

/**
 * Install the guard unless `REPO_TEST_ALLOW_DNS=1`. Idempotent per target set. Returns an uninstall
 * function, or undefined when nothing was installed.
 */
export function installDnsGuard(env: Env = process.env, targets: DnsGuardTargets = realTargets()): (() => void) | undefined {
  if (env[ALLOW_DNS_ENV] === "1") return undefined
  const marker = targets.bunDns as Mutable
  if (marker[INSTALLED] === true) return undefined
  const allow = dnsAllowlist(env)
  const restores: (() => void)[] = []
  const patch = (obj: object, key: string, wrap: (orig: Fn) => Fn): void => {
    const o = obj as Mutable
    const orig = o[key]
    if (typeof orig !== "function") return
    o[key] = wrap(orig as Fn)
    restores.push(() => {
      o[key] = orig
    })
  }
  /** The error for a blocked `host`, or undefined when `host` may resolve. */
  const blocked = (host: unknown, api: string, syscall = "getaddrinfo"): Error | undefined => {
    if (typeof host !== "string" || isHermeticHost(host, allow)) return undefined
    traceBlocked(env, host, api)
    return blockedDnsError(host, syscall)
  }
  const byName = (key: string) => (orig: Fn): Fn =>
    function (this: unknown, ...args: unknown[]): unknown {
      const err = blocked(args[0], `Bun.dns.${key}`, key === "lookup" ? "getaddrinfo" : "query")
      return err ? Promise.reject(err) : orig.apply(this, args)
    }

  for (const key of BUN_DNS_NAME_METHODS) patch(targets.bunDns, key, byName(key))
  for (const proto of targets.resolverPrototypes) {
    for (const key of RESOLVER_NAME_METHODS) {
      patch(proto, key, (orig) =>
        function (this: unknown, ...args: unknown[]): unknown {
          const err = blocked(args[0], `Resolver.${key}`, "query")
          if (!err) return orig.apply(this, args)
          const cb = args[args.length - 1]
          if (typeof cb === "function") {
            queueMicrotask(() => (cb as Fn).call(undefined, err))
            return undefined
          }
          return Promise.reject(err)
        })
    }
  }
  patch(targets.globals, "fetch", (orig) => {
    const guarded = function (this: unknown, ...args: unknown[]): unknown {
      const err = blocked(fetchHost(args[0], args[1]), "fetch")
      return err ? Promise.reject(err) : orig.apply(this, args)
    }
    return Object.assign(guarded, orig)
  })
  patch(targets.bun, "connect", (orig) =>
    function (this: unknown, ...args: unknown[]): unknown {
      const opts = args[0]
      const err = blocked(typeof opts === "object" && opts !== null ? (opts as Mutable).hostname : undefined, "Bun.connect")
      return err ? Promise.reject(err) : orig.apply(this, args)
    })
  marker[INSTALLED] = true
  return () => {
    for (const restore of restores.reverse()) restore()
    marker[INSTALLED] = false
  }
}
