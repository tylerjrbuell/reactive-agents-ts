// Run: bun test packages/reasoning/tests/kernel/capabilities/verify/post-conditions.test.ts --timeout 15000
//
// PostCondition spine — deterministic, state-grounded success authority.
// verify(conditions, steps) is PURE over the run ledger (state.steps[]): no
// fs access, no LLM. A ToolCalled condition is met iff a successful observation
// for that tool exists; ArtifactProduced(path) is met iff a successful write
// observation links to an action step whose toolCall.arguments names a matching
// path; OutputContains(pattern) matches the assembled output string.
import { describe, it, expect } from "bun:test";
import {
  verify,
  toolCalled,
  artifactProduced,
  outputContains,
  type PostCondition,
} from "../../../../src/kernel/capabilities/verify/post-conditions.js";
import type { ReasoningStep } from "../../../../src/types/index.js";
import type { ObservationResult } from "../../../../src/types/observation.js";

let n = 0;
function obs(toolName: string, success: boolean, toolCallId?: string): ReasoningStep {
  return {
    id: `obs-${n++}` as ReasoningStep["id"],
    type: "observation",
    content: success ? "ok" : "error",
    timestamp: new Date(),
    metadata: {
      ...(toolCallId ? { toolCallId } : {}),
      observationResult: {
        success,
        toolName,
        displayText: success ? "ok" : "error",
        category: success ? "data" : "error",
        resultKind: success ? "data" : "error",
        preserveOnCompaction: true,
        trustLevel: "untrusted",
      } as ObservationResult,
    },
  };
}

function action(
  toolName: string,
  args: Record<string, unknown>,
  id: string,
): ReasoningStep {
  return {
    id: `act-${n++}` as ReasoningStep["id"],
    type: "action",
    content: `${toolName}(...)`,
    timestamp: new Date(),
    metadata: { toolCall: { id, name: toolName, arguments: args } },
  };
}

describe("verify(ToolCalled)", () => {
  it("met when the tool fired successfully", () => {
    const steps = [obs("web-search", true)];
    const r = verify([toolCalled("web-search")], steps);
    expect(r.unmet).toHaveLength(0);
    expect(r.met).toHaveLength(1);
  }, 15000);

  it("unmet when the tool never fired", () => {
    const steps = [obs("file-write", true)];
    const r = verify([toolCalled("web-search")], steps);
    expect(r.unmet).toHaveLength(1);
    expect(r.unmet[0]).toEqual(toolCalled("web-search"));
  }, 15000);

  it("unmet when the tool was attempted but failed", () => {
    const steps = [obs("web-search", false)];
    const r = verify([toolCalled("web-search")], steps);
    expect(r.unmet).toHaveLength(1);
  }, 15000);
});

describe("verify(ArtifactProduced)", () => {
  it("met when a successful write step's path arg matches", () => {
    const steps = [
      action("file-write", { path: "./commits.md", content: "x" }, "tc1"),
      obs("file-write", true, "tc1"),
    ];
    const r = verify([artifactProduced("./commits.md")], steps);
    expect(r.unmet).toHaveLength(0);
  }, 15000);

  it("met when path differs only by leading ./ normalization", () => {
    const steps = [
      action("file-write", { path: "commits.md", content: "x" }, "tc1"),
      obs("file-write", true, "tc1"),
    ];
    const r = verify([artifactProduced("./commits.md")], steps);
    expect(r.unmet).toHaveLength(0);
  }, 15000);

  it("unmet when the write failed", () => {
    const steps = [
      action("file-write", { path: "./commits.md", content: "x" }, "tc1"),
      obs("file-write", false, "tc1"),
    ];
    const r = verify([artifactProduced("./commits.md")], steps);
    expect(r.unmet).toHaveLength(1);
  }, 15000);

  it("unmet when target write FAILED even if an unrelated tool succeeded (no linkage)", () => {
    const steps: ReasoningStep[] = [
      action("file-write", { path: "./commits.md", content: "x" }, "tc1"),
      // failed write — NO toolCallId linkage on the observation (fallback path)
      {
        id: "o-failwrite" as ReasoningStep["id"],
        type: "observation",
        content: "err",
        timestamp: new Date(),
        metadata: {
          observationResult: {
            success: false,
            toolName: "file-write",
            displayText: "err",
            category: "error",
            resultKind: "error",
            preserveOnCompaction: true,
            trustLevel: "untrusted",
          } as ObservationResult,
        },
      },
      // unrelated successful tool — must NOT satisfy the artifact
      obs("get-time", true),
    ];
    expect(verify([artifactProduced("./commits.md")], steps).unmet).toHaveLength(1);
  }, 15000);

  it("unmet when a successful file-READ (not write) touches the path", () => {
    const steps: ReasoningStep[] = [
      action("file-read", { path: "./commits.md" }, "tc1"),
      obs("file-read", true, "tc1"),
    ];
    expect(verify([artifactProduced("./commits.md")], steps).unmet).toHaveLength(1);
  }, 15000);

  it("unmet when the target write FAILED and a different path's write SUCCEEDED (no linkage)", () => {
    // Two writing-tool observations. The TARGET (./commits.md) write FAILED;
    // a DIFFERENT path (./other.md) write SUCCEEDED but carries no toolCallId
    // linkage. The action-path union previously conflated the two paths and
    // wrongly reported ./commits.md as produced. The successful unlinked write
    // cannot be tied to ./commits.md, so the artifact is UNMET.
    const steps: ReasoningStep[] = [
      action("file-write", { path: "./commits.md", content: "x" }, "tc1"),
      obs("file-write", false, "tc1"), // target write FAILED (linked)
      action("file-write", { path: "./other.md", content: "y" }, "tc2"),
      // successful write to a DIFFERENT path, NO toolCallId linkage (fallback path)
      {
        id: "o-other-success" as ReasoningStep["id"],
        type: "observation",
        content: "ok",
        timestamp: new Date(),
        metadata: {
          observationResult: {
            success: true,
            toolName: "file-write",
            displayText: "ok",
            category: "file-write",
            resultKind: "side-effect",
            preserveOnCompaction: true,
            trustLevel: "untrusted",
          } as ObservationResult,
        },
      },
    ];
    expect(verify([artifactProduced("./commits.md")], steps).unmet).toHaveLength(1);
  }, 15000);

  it("unmet when no write step names the target path", () => {
    const steps = [
      action("file-write", { path: "./other.md", content: "x" }, "tc1"),
      obs("file-write", true, "tc1"),
    ];
    const r = verify([artifactProduced("./commits.md")], steps);
    expect(r.unmet).toHaveLength(1);
  }, 15000);
});

describe("verify(OutputContains)", () => {
  it("met when assembled output matches the pattern", () => {
    const steps: ReasoningStep[] = [];
    const r = verify([outputContains("## Summary")], steps, {
      output: "# Report\n## Summary\ndetails",
    });
    expect(r.unmet).toHaveLength(0);
  }, 15000);

  it("unmet when output lacks the pattern", () => {
    const r = verify([outputContains("## Summary")], [], { output: "nope" });
    expect(r.unmet).toHaveLength(1);
  }, 15000);
});

describe("verify — empty conditions", () => {
  it("returns all-met for an empty condition set", () => {
    const r = verify([], [obs("file-write", true)]);
    expect(r.unmet).toHaveLength(0);
    expect(r.met).toHaveLength(0);
  }, 15000);
});

describe("verify — purity contract", () => {
  it("is pure (same input -> same output, no throw on empty ledger)", () => {
    const conditions: PostCondition[] = [toolCalled("x"), artifactProduced("./y.md")];
    const a = verify(conditions, []);
    const b = verify(conditions, []);
    expect(a.unmet).toEqual(b.unmet);
    expect(a.unmet).toHaveLength(2);
  }, 15000);
});
