import { describe, expect, it, afterEach } from "bun:test";
import { resolveHarnessConfig, fromDisclosureMode } from "./harness-config.js";

const ENV_KEYS = [
  "RA_LAZY_TOOLS", "RA_TOOL_DISCOVERY", "RA_TOOL_INDEX", "RA_VERBOSE_RULES",
  "RA_THOUGHT_CONTINUITY", "RA_RECENCY_BUDGET_CHARS",
] as const;

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("resolveHarnessConfig — precedence", () => {
  it("uses the built-in default when neither config nor env is set", () => {
    const r = resolveHarnessConfig();
    expect(r.lazyDisclosure).toBe(true);
    expect(r.verboseRules).toBe(false);
    expect(r.toolIndex).toBe(false);
  });

  it("lets the environment override the built-in default", () => {
    process.env.RA_VERBOSE_RULES = "1";
    expect(resolveHarnessConfig().verboseRules).toBe(true);
  });

  it("lets explicit config beat the environment — config always wins", () => {
    process.env.RA_VERBOSE_RULES = "1";
    expect(resolveHarnessConfig({ verboseRules: false }).verboseRules).toBe(false);
    process.env.RA_LAZY_TOOLS = "0";
    expect(resolveHarnessConfig({ lazyDisclosure: true }).lazyDisclosure).toBe(true);
  });

  it("treats an explicit `false` as a real choice, not as absent", () => {
    expect(resolveHarnessConfig({ lazyDisclosure: false }).lazyDisclosure).toBe(false);
  });

  it("omits optional numeric overrides entirely when nothing sets them", () => {
    const r = resolveHarnessConfig();
    expect("recencyBudgetChars" in r).toBe(false);
    expect("toolIndexMaxEntries" in r).toBe(false);
  });

  it("carries a numeric override from config", () => {
    expect(resolveHarnessConfig({ recencyBudgetChars: 4096 }).recencyBudgetChars).toBe(4096);
  });

  it("is frozen — a run cannot mutate its own harness config", () => {
    const r = resolveHarnessConfig();
    expect(Object.isFrozen(r)).toBe(true);
  });
});

describe("fromDisclosureMode — the profile field becomes real", () => {
  it("full = everything visible, no discovery, no index", () => {
    expect(fromDisclosureMode("full")).toEqual({
      lazyDisclosure: false, toolDiscovery: false, toolIndex: false,
    });
  });

  it("discover = prune plus the discover-tools escape hatch", () => {
    expect(fromDisclosureMode("discover")).toEqual({
      lazyDisclosure: true, toolDiscovery: true, toolIndex: false,
    });
  });

  it("index = prune plus a cheap text index, no discovery round trips", () => {
    expect(fromDisclosureMode("index")).toEqual({
      lazyDisclosure: true, toolDiscovery: false, toolIndex: true,
    });
  });

  it("hybrid = prune with both affordances", () => {
    expect(fromDisclosureMode("hybrid")).toEqual({
      lazyDisclosure: true, toolDiscovery: true, toolIndex: true,
    });
  });

  it("a mode is still overridable field-by-field — explicit beats derived", () => {
    const r = resolveHarnessConfig({ ...fromDisclosureMode("full"), toolIndex: true });
    expect(r.lazyDisclosure).toBe(false);
    expect(r.toolIndex).toBe(true);
  });
});

// Finding 5 (harness-control-surface final fix wave): `harness-flags.ts`
// derives `toolDiscovery`'s and `verboseRules`' env-layer defaults from
// `RA_LAZY_TOOLS` when their own env var is unset. `resolveHarnessConfig`
// must reproduce that coupling from the RESOLVED `lazyDisclosure` value when
// the caller set `lazyDisclosure` via config (not just via env), or a
// config-only `{ lazyDisclosure: false }` silently loses the coupling that
// the equivalent `RA_LAZY_TOOLS=0` would have applied.
describe("resolveHarnessConfig — lazyDisclosure cross-field coupling (Finding 5)", () => {
  it("config-only lazyDisclosure:false also turns off toolDiscovery and on verboseRules", () => {
    const r = resolveHarnessConfig({ lazyDisclosure: false });
    expect(r.lazyDisclosure).toBe(false);
    expect(r.toolDiscovery).toBe(false);
    expect(r.verboseRules).toBe(true);
  });

  it("config-only lazyDisclosure:true keeps toolDiscovery on and verboseRules off", () => {
    const r = resolveHarnessConfig({ lazyDisclosure: true });
    expect(r.lazyDisclosure).toBe(true);
    expect(r.toolDiscovery).toBe(true);
    expect(r.verboseRules).toBe(false);
  });

  it("an explicit derived field always beats the coupling", () => {
    const r = resolveHarnessConfig({ lazyDisclosure: false, toolDiscovery: true, verboseRules: false });
    expect(r.toolDiscovery).toBe(true);
    expect(r.verboseRules).toBe(false);
  });

  it("leaves the pure-env path (lazyDisclosure unset) byte-identical to before", () => {
    process.env.RA_LAZY_TOOLS = "0";
    const r = resolveHarnessConfig();
    // Same outcome as the coupling above, but reached via the env layer's
    // own coupling (harness-flags.ts), not the config-layer reproduction —
    // this proves the fix does not change the no-config-set path at all.
    expect(r.lazyDisclosure).toBe(false);
    expect(r.toolDiscovery).toBe(false);
    expect(r.verboseRules).toBe(true);
  });
});
