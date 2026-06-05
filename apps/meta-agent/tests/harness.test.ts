// apps/meta-agent/tests/harness.test.ts
// Run: bun test ./apps/meta-agent/tests/harness.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import type { Harness } from "reactive-agents/core";
import { growthInvariants, growthObservability } from "../src/harness/growth-harness.js";

type Reg = { tag: string; fn: (...a: unknown[]) => unknown };
const mockHarness = () => {
  const regs: Reg[] = [];
  const h = {
    on: (tag: string, fn: (...a: unknown[]) => unknown) => { regs.push({ tag, fn }); return h; },
    tap: (tag: string, fn: (...a: unknown[]) => unknown) => { regs.push({ tag, fn }); return h; },
    before: () => h, after: () => h, emit: () => {}, use: () => h,
  };
  return { h: h as unknown as Harness, regs };
};

describe("growthInvariants", () => {
  it("prepends invariants to the system prompt and preserves the original", () => {
    const { h, regs } = mockHarness();
    growthInvariants(h);
    const reg = regs.find((r) => r.tag === "prompt.system")!;
    const out = reg.fn("ORIGINAL_PROMPT", { iteration: 1 }) as string;
    expect(out).toContain("INVARIANTS");
    expect(out).toContain("ORIGINAL_PROMPT");
    expect(out.indexOf("INVARIANTS")).toBeLessThan(out.indexOf("ORIGINAL_PROMPT"));
  });
});

describe("growthObservability", () => {
  it("taps tool-result, failure, and loop tags and logs tool name", () => {
    const { h, regs } = mockHarness();
    const logs: string[] = [];
    growthObservability((s) => logs.push(s))(h);
    const tags = regs.map((r) => r.tag);
    expect(tags).toContain("message.tool-result");
    expect(tags).toContain("lifecycle.failure");
    expect(tags).toContain("nudge.loop-detected");
    regs.find((r) => r.tag === "message.tool-result")!.fn({ toolName: "community-monitor" }, { iteration: 2 });
    expect(logs.some((l) => l.includes("community-monitor"))).toBe(true);
  });
});
