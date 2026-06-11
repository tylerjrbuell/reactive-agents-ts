import { describe, it, expect } from "bun:test";
import { detectScaffoldLeak } from "../../../src/kernel/capabilities/verify/scaffold-leak.js";

describe("detectScaffoldLeak", () => {
  it("flags [STORED:] scaffolding echoed as the answer", () => {
    const r = detectScaffoldLeak("[STORED: _tool_result_1] the data is above");
    expect(r.leaked).toBe(true);
    expect(r.reason).toContain("scaffolding");
  });
  it("flags _tool_result_N references", () => {
    expect(detectScaffoldLeak("See _tool_result_3 for details").leaked).toBe(true);
  });
  it("flags compressed-preview marker", () => {
    expect(detectScaffoldLeak("[crypto-price result — compressed preview]\n...").leaked).toBe(true);
  });
  it("passes clean prose", () => {
    expect(detectScaffoldLeak("Bitcoin is currently $62,578 USD.").leaked).toBe(false);
  });
});
