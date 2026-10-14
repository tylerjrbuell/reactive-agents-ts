// Run: bun test packages/tools/tests/sub-agent-envelope.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import {
  finalizeSubAgentResult,
  subAgentChildEnvelopes,
} from "../src/adapters/agent-tool-adapter.js";
import type { SubAgentRawResult } from "../src/adapters/agent-tool-adapter.js";

describe("SubAgentResult completion envelope (Wave 5.3)", () => {
  it("carries completion envelope fields when present in raw result", () => {
    const raw: SubAgentRawResult = {
      output: "Done",
      success: true,
      tokensUsed: 100,
      completionEnvelope: {
        completionStatus: "partial",
        budgetTerminalPartial: true,
      },
    };

    const result = finalizeSubAgentResult({ name: "test" }, raw);

    expect(result.completionStatus).toBe("partial");
    expect(result.budgetTerminalPartial).toBe(true);
  });

  it("handles missing envelope by not including the fields", () => {
    const raw: SubAgentRawResult = {
      output: "Done",
      success: true,
      tokensUsed: 100,
    };

    const result = finalizeSubAgentResult({ name: "test" }, raw);
    expect(result.completionStatus).toBeUndefined();
    expect(result.budgetTerminalPartial).toBeUndefined();
  });

  it("extracts one envelope per child from single and batch results", () => {
    expect(
      subAgentChildEnvelopes({ completionStatus: "partial", budgetTerminalPartial: true }),
    ).toEqual([{ completionStatus: "partial", budgetTerminalPartial: true }]);
    expect(
      subAgentChildEnvelopes({
        results: [{ completionStatus: "completed" }, { completionStatus: "failed" }, { output: "no verdict" }],
      }),
    ).toEqual([{ completionStatus: "completed" }, { completionStatus: "failed" }]);
    expect(subAgentChildEnvelopes({ output: "no verdict" })).toEqual([]);
    expect(subAgentChildEnvelopes("plain string")).toEqual([]);
  });
});
