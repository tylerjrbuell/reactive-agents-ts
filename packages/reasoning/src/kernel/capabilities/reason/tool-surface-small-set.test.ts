// Run: bun test packages/reasoning/src/kernel/capabilities/reason/tool-surface-small-set.test.ts
//
// Turn-1 visibility must come from the configured tool SET, not from prose
// similarity between the task and a tool description. Live failure
// (2026-11-12): a `crypto-price` tool was hidden on turn 1 for "what is bitcoin
// worth" (no keyword overlap), so the agent answered "I do not have a
// crypto-price tool" / hit "Tool call used unavailable name(s)".
//
// Rule pinned here: lazy disclosure applies only when the permitted domain set
// is LARGE (more than `pruneMinTools`, the one existing budget constant, 15).
// Within budget every configured domain tool is visible. Explicit
// `disclosure: "discover"` stays strict at any size.
//
// RED-ON-CUT: delete the `smallSet` short-circuit in `resolveToolSurface`
// (tool-surface.ts) -> the "visible on turn 1" cells fail.
import { describe, it, expect } from "bun:test";
import { resolveToolSurface } from "./tool-surface.js";
import type { ToolSchema } from "../attend/tool-formatting.js";
import { resolveHarnessConfig, fromDisclosureMode } from "../../../harness-config.js";

const mk = (name: string, description: string): ToolSchema =>
  ({ name, description, parameters: [] }) as ToolSchema;

const CRYPTO = mk("crypto-price", "Retrieves cryptocurrency valuations");
const filler = (n: number): ToolSchema[] =>
  Array.from({ length: n }, (_, i) => mk(`filler-${i}`, `zzq${i}`));
const META = [
  mk("recall", "Recall a stored value"),
  mk("discover-tools", "List tools available beyond the current surface"),
];

const base = {
  finalAnswerSchema: mk("final-answer", "Emit the final answer"),
  lazyMode: true,
  pressureCritical: false,
  hasClassification: false,
  requiredTools: [] as readonly string[],
  relevantTools: [] as readonly string[],
  allowedTools: [] as readonly string[],
  toolsUsed: [] as readonly string[],
  discovered: [] as readonly string[],
  gateBlockedTools: [] as readonly string[],
  missingRequiredTools: [] as readonly string[],
  pruneMinTools: 15,
  harness: resolveHarnessConfig(),
};

const names = (r: { visible: readonly ToolSchema[] }) => r.visible.map((t) => t.name);

describe("small configured tool set is visible on turn 1", () => {
  for (const taskText of ["what is bitcoin worth", "what is the price of bitcoin"]) {
    it(`crypto-price visible for "${taskText}" (default config)`, () => {
      const r = resolveToolSurface({
        ...base,
        augmented: [mk("web-search", "Search the web for bitcoin news"), CRYPTO, ...META],
        taskText,
      });
      expect(names(r)).toContain("crypto-price");
      expect(r.callable.map((t) => t.name)).toContain("crypto-price");
      expect(r.reasons.get("crypto-price")).toMatch(/^visible/);
    });
  }

  it("a non-matching tool stays visible next to a matching one", () => {
    const r = resolveToolSurface({
      ...base,
      augmented: [mk("web-search", "Search the web for bitcoin news"), CRYPTO, ...META],
      taskText: "what is bitcoin worth",
    });
    expect(names(r)).toEqual(expect.arrayContaining(["web-search", "crypto-price"]));
  });

  it("a large set (> pruneMinTools domain tools) still discloses lazily", () => {
    const r = resolveToolSurface({
      ...base,
      augmented: [mk("web-search", "Search the web for bitcoin news"), CRYPTO, ...filler(14), ...META],
      taskText: "what is bitcoin worth",
    });
    expect(names(r)).not.toContain("crypto-price");
    expect(r.reasons.get("crypto-price")).toMatch(/^hidden: lazy-undisclosed/);
  });

  it("exactly pruneMinTools domain tools is still within budget", () => {
    const r = resolveToolSurface({
      ...base,
      augmented: [CRYPTO, ...filler(14), ...META],
      taskText: "what is bitcoin worth",
    });
    expect(names(r)).toContain("crypto-price");
    expect(r.reasons.get("crypto-price")).toMatch(/^visible: within-budget/);
  });

  it("explicit disclosure: discover stays strict on a small set", () => {
    const r = resolveToolSurface({
      ...base,
      augmented: [mk("web-search", "Search the web for bitcoin news"), CRYPTO, ...META],
      taskText: "what is bitcoin worth",
      harness: resolveHarnessConfig(fromDisclosureMode("discover")),
    });
    expect(names(r)).not.toContain("crypto-price");
  });

  it("a call to a registered-but-undisclosed tool still resolves (universe is whole)", () => {
    const r = resolveToolSurface({
      ...base,
      augmented: [CRYPTO, ...filler(15), ...META],
      taskText: "what is bitcoin worth",
    });
    expect(r.universe.map((t) => t.name)).toContain("crypto-price");
  });
});
