// Run: bun test packages/reasoning/tests/strategies/kernel/phases/driver-instructions.test.ts --timeout 15000
//
// In text-parse mode the driver's prompt instructions (the `<tool_call>` format)
// ARE the model's only mechanism to call a tool — they must never be suppressed,
// even on compact local profiles ("names-and-types"). In native-fc mode the
// driver carries tools natively and its instruction string is empty, so the
// compact-profile suppression is harmless there.
import { describe, it, expect } from "bun:test";
import { shouldInjectDriverInstructions } from "../../../../src/kernel/capabilities/decide/tool-gating.js";

describe("shouldInjectDriverInstructions", () => {
  it("always injects in text-parse mode — the format is the calling mechanism", () => {
    expect(shouldInjectDriverInstructions("text-parse", "names-and-types")).toBe(true);
    expect(shouldInjectDriverInstructions("text-parse", "names-only")).toBe(true);
    expect(shouldInjectDriverInstructions("text-parse", "full")).toBe(true);
  });

  it("suppresses on compact profiles in native-fc mode (instructions are redundant detail there)", () => {
    expect(shouldInjectDriverInstructions("native-fc", "names-only")).toBe(false);
    expect(shouldInjectDriverInstructions("native-fc", "names-and-types")).toBe(false);
  });

  it("injects on full-detail profiles in native-fc mode", () => {
    expect(shouldInjectDriverInstructions("native-fc", "full")).toBe(true);
  });
});
