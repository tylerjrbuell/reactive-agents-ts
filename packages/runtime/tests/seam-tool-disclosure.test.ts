/**
 * Seam pin: `.withTools({ disclosure })` precedence + `run-started.config.disclosure`
 * (skills-and-extension-model spec 2026-11-06 §12.5 F2, §12.7 change 5).
 *
 * Precedence, highest first: `.withTools({ disclosure })` > deprecated
 * `.withHarness` switches > `RA_*` env flags > `contextProfile.toolDisclosureMode`
 * > tier default. Mapping: all→full, index→index, discover→discover.
 * Unset ⇒ the envelope's harness input is the caller's object unchanged.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { buildRunEnvelopeFromConfig } from "../src/engine/run-envelope-config";
import { buildRunConfigSnapshot } from "../src/engine/execute-run-config";
import { disclosureHarness, resolveDisclosure, type ToolDisclosure } from "../src/engine/tool-disclosure";

/** A value an untyped (plain JS) caller could pass. */
const untyped = (s: string): string => s;
import { defaultReactiveAgentsConfig, type ReactiveAgentsConfig } from "../src/types";
import { ReactiveAgents, ToolsOptionError } from "../src";
import { asBuilderState } from "../src/builder/withers/_state";

const FLAGS = ["RA_LAZY_TOOLS", "RA_TOOL_DISCOVERY", "RA_TOOL_INDEX"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const f of FLAGS) {
    saved[f] = process.env[f];
    delete process.env[f];
  }
});
afterEach(() => {
  for (const f of FLAGS) {
    if (saved[f] === undefined) delete process.env[f];
    else process.env[f] = saved[f];
  }
});

const cfg = (patch: Partial<ReactiveAgentsConfig>): ReactiveAgentsConfig =>
  defaultReactiveAgentsConfig("disclosure-pin", patch);

const switches = (c: ReactiveAgentsConfig) => {
  const h = buildRunEnvelopeFromConfig(c).harness;
  return { lazy: h.lazyDisclosure, discovery: h.toolDiscovery, index: h.toolIndex };
};

const disclosureOf = (c: ReactiveAgentsConfig, env: NodeJS.ProcessEnv = {}) =>
  buildRunConfigSnapshot({ config: c, provider: "test", model: "m", lean: false, env }).disclosure;

describe("disclosure mapping onto today's internals", () => {
  it("all → full, index → index, discover → discover", () => {
    expect(switches(cfg({ toolDisclosure: "all" }))).toEqual({ lazy: false, discovery: false, index: false });
    expect(switches(cfg({ toolDisclosure: "index" }))).toEqual({ lazy: true, discovery: false, index: true });
    expect(switches(cfg({ toolDisclosure: "discover" }))).toEqual({ lazy: true, discovery: true, index: false });
  });

  it("unset returns the caller's harness object itself (envelope input byte-identical)", () => {
    const harness = { toolIndex: false };
    const c = cfg({ reasoningOptions: { harness } });
    expect(disclosureHarness(c)).toBe(harness);
    expect(disclosureHarness(cfg({}))).toBeUndefined();
  });
});

describe("precedence: withTools > harness > env > profile > tier", () => {
  it("withTools beats .withHarness switches, env flags and the profile", () => {
    process.env["RA_LAZY_TOOLS"] = "1";
    process.env["RA_TOOL_INDEX"] = "1";
    const c = cfg({
      toolDisclosure: "all",
      reasoningOptions: { harness: { lazyDisclosure: true, toolDiscovery: true } },
      contextProfile: { toolDisclosureMode: "discover" },
    });
    expect(switches(c)).toEqual({ lazy: false, discovery: false, index: false });
    expect(disclosureOf(c, process.env)).toEqual({ mode: "all", source: "withTools" });
  });

  it("harness beats env and profile", () => {
    process.env["RA_LAZY_TOOLS"] = "1";
    const c = cfg({
      reasoningOptions: { harness: { lazyDisclosure: false } },
      contextProfile: { toolDisclosureMode: "discover" },
    });
    expect(switches(c).lazy).toBe(false);
    expect(disclosureOf(c, process.env)).toEqual({ mode: "all", source: "harness" });
  });

  it("env beats profile", () => {
    process.env["RA_LAZY_TOOLS"] = "0";
    const c = cfg({ contextProfile: { toolDisclosureMode: "discover" } });
    expect(switches(c).lazy).toBe(false);
    expect(disclosureOf(c, process.env)).toEqual({ mode: "all", source: "env" });
  });

  it("profile beats tier", () => {
    const c = cfg({ contextProfile: { toolDisclosureMode: "discover" } });
    expect(disclosureOf(c)).toEqual({ mode: "discover", source: "profile" });
  });

  it("tier default: mid ⇒ hybrid, ollama/local ⇒ index", () => {
    expect(disclosureOf(cfg({}))).toEqual({ mode: "hybrid", source: "tier" });
    expect(disclosureOf(cfg({ provider: "ollama" }))).toEqual({ mode: "index", source: "tier" });
  });

  it("a switch combination with no named mode is reported as custom", () => {
    const c = cfg({ reasoningOptions: { harness: { lazyDisclosure: true, toolDiscovery: false, toolIndex: false } } });
    expect(resolveDisclosure(c, { lazyDisclosure: true, toolDiscovery: false, toolIndex: false }, {})).toEqual({
      mode: "custom",
      source: "harness",
    });
  });
});

describe(".withTools({ disclosure }) builder surface", () => {
  it("stores the value, carries it to toConfig, and rejects an unknown mode with ToolsOptionError", () => {
    const b = ReactiveAgents.create().withTools({ disclosure: "discover" });
    expect(asBuilderState(b)._toolsOptions?.disclosure).toBe("discover");
    expect(b.toConfig().tools?.disclosure).toBe("discover");
    expect(() =>
      ReactiveAgents.create().withTools({ disclosure: untyped("lazy") as ToolDisclosure }),
    ).toThrow(ToolsOptionError);
  });
  // End-to-end (builder → engine config → run-started.config.disclosure) is
  // pinned by the trace test in run-config-origin-aborted.test.ts.
});
