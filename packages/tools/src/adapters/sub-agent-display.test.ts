// Run: bun test packages/tools/src/adapters/sub-agent-display.test.ts
//
// Wave C.2 — the child's RunLedger crosses back on `SubAgentResult.childRunLedger`
// for the parent's ledger merge, but it must NEVER reach the parent MODEL: it is
// potentially large (every child tool call + preview) and pure noise in the
// parent's context. `subAgentResultForDisplay` is what the tool-observation
// builders serialize; this pins that it drops the carrier and keeps everything
// the model actually needs.
import { describe, it, expect } from "bun:test";
import { subAgentResultForDisplay, subAgentChildLedgerEntries } from "./agent-tool-adapter.js";

describe("subAgentResultForDisplay", () => {
  it("drops childRunLedger but keeps the model-facing fields", () => {
    const result = {
      subAgentName: "worker",
      success: true,
      summary: "did the thing",
      tokensUsed: 42,
      delegatedToolsUsed: ["file-read"],
      childRunLedger: [{ kind: "tool-invocation", seq: 0, iteration: 0, toolName: "file-read", pass: "sub-agent:worker" }],
    };
    const display = subAgentResultForDisplay(result) as Record<string, unknown>;
    expect(display.childRunLedger).toBeUndefined();
    expect("childRunLedger" in display).toBe(false);
    expect(display.summary).toBe("did the thing");
    expect(display.delegatedToolsUsed).toEqual(["file-read"]);
    // The serialized form the model sees must not contain the ledger.
    expect(JSON.stringify(display)).not.toContain("childRunLedger");
    expect(JSON.stringify(display)).not.toContain("sub-agent:worker");
  });

  it("passes a result with no carrier through unchanged (byte-identical)", () => {
    const clean = { subAgentName: "x", success: true, summary: "s", tokensUsed: 1 };
    expect(subAgentResultForDisplay(clean)).toBe(clean);
  });

  it("passes non-object results through (string output, arrays)", () => {
    expect(subAgentResultForDisplay("plain string")).toBe("plain string");
    expect(subAgentResultForDisplay(null)).toBe(null);
    const arr = [1, 2];
    expect(subAgentResultForDisplay(arr)).toBe(arr);
  });

  it("strips the carrier from EACH nested result of a batch (spawn-agents)", () => {
    const batch = {
      summary: { total: 2, succeeded: 2, failed: 0 },
      results: [
        { subAgentName: "a", success: true, summary: "sa", childRunLedger: [{ kind: "tool-invocation", seq: 0, iteration: 0, toolName: "t", pass: "sub-agent:a" }] },
        { subAgentName: "b", success: true, summary: "sb", childRunLedger: [{ kind: "tool-invocation", seq: 0, iteration: 0, toolName: "u", pass: "sub-agent:b" }] },
      ],
    };
    const display = subAgentResultForDisplay(batch);
    const serialized = JSON.stringify(display);
    expect(serialized).not.toContain("childRunLedger");
    expect(serialized).not.toContain("sub-agent:a");
    // The model still sees the per-child summaries + the batch summary.
    expect(serialized).toContain("sa");
    expect(serialized).toContain('"total":2');
  });
});

describe("subAgentChildLedgerEntries", () => {
  it("returns the single result's stamped entries", () => {
    const single = { subAgentName: "x", childRunLedger: [{ kind: "tool-invocation", seq: 0, iteration: 0, pass: "sub-agent:x" }] };
    expect(subAgentChildLedgerEntries(single)).toHaveLength(1);
  });

  it("FLATTENS a batch's children so a parallel dispatch all cross", () => {
    const batch = {
      results: [
        { childRunLedger: [{ kind: "tool-invocation", seq: 0, iteration: 0, pass: "sub-agent:a" }] },
        { childRunLedger: [{ kind: "tool-invocation", seq: 0, iteration: 0, pass: "sub-agent:b" }, { kind: "tool-result", seq: 1, iteration: 0, success: true, preview: "", pass: "sub-agent:b" }] },
      ],
    };
    const entries = subAgentChildLedgerEntries(batch) as Array<{ pass?: string }>;
    expect(entries).toHaveLength(3);
    expect(new Set(entries.map((e) => e.pass))).toEqual(new Set(["sub-agent:a", "sub-agent:b"]));
  });

  it("returns [] for an ordinary tool result", () => {
    expect(subAgentChildLedgerEntries("some string output")).toEqual([]);
    expect(subAgentChildLedgerEntries({ result: "no ledger here" })).toEqual([]);
  });
});
