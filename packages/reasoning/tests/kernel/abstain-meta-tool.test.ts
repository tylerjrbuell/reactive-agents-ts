// Run: bun test packages/reasoning/tests/kernel/abstain-meta-tool.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { handleAbstain, ABSTAIN_TOOL_NAME } from "../../src/kernel/capabilities/act/meta-tool-handlers";

describe("abstain meta-tool handler", () => {
  it("exposes the tool name", () => {
    expect(ABSTAIN_TOOL_NAME).toBe("abstain");
  }, 15000);

  it("returns an abstained terminal intent with reason + missing", () => {
    const intent = handleAbstain({ reason: "insufficient evidence", missing: ["tool:web-search"] });
    expect(intent._tag).toBe("abstained");
    expect(intent.reason).toBe("insufficient evidence");
    expect(intent.missing).toEqual(["tool:web-search"]);
  }, 15000);

  it("defaults missing to an empty array when omitted", () => {
    const intent = handleAbstain({ reason: "cannot answer" });
    expect(intent.missing).toEqual([]);
  }, 15000);
});
