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

  // ── Absolute-vs-relative path reconciliation (false-UNMET fix) ──────────────
  // Reproduces the ablation bug: the model/file-write tool writes to an ABSOLUTE
  // path (what lands in the action's toolCall.arguments.path), but deriveConditions
  // derives a RELATIVE ArtifactProduced("./out.md") from the task string. The
  // derived path is a trailing path-segment suffix of the written absolute path;
  // it must MATCH. (Linkage is intact in the real wire — act.ts pairs the action's
  // toolCall.id with the observation's toolCallId — so this is a path-norm bug only.)
  it("met when the write path is ABSOLUTE and the derived condition is relative", () => {
    const steps = [
      action(
        "file-write",
        { path: "/home/user/apps/examples/agents-summary.md", content: "x" },
        "tc1",
      ),
      obs("file-write", true, "tc1"),
    ];
    const r = verify([artifactProduced("./agents-summary.md")], steps);
    expect(r.unmet).toHaveLength(0);
  }, 15000);

  it("met when the derived condition is a multi-segment suffix of the absolute write", () => {
    const steps = [
      action(
        "file-write",
        { path: "/home/user/apps/examples/agents-summary.md", content: "x" },
        "tc1",
      ),
      obs("file-write", true, "tc1"),
    ];
    const r = verify([artifactProduced("examples/agents-summary.md")], steps);
    expect(r.unmet).toHaveLength(0);
  }, 15000);

  it("no false-met: an absolute write to a DIFFERENT file does not satisfy the target", () => {
    const steps = [
      action(
        "file-write",
        { path: "/home/user/apps/examples/other.md", content: "x" },
        "tc1",
      ),
      obs("file-write", true, "tc1"),
    ];
    const r = verify([artifactProduced("./agents-summary.md")], steps);
    expect(r.unmet).toHaveLength(1);
  }, 15000);

  it("no false-met: a content arg that merely ENDS WITH the path does NOT match a different write", () => {
    // The write targets /abs/other.md; its `content` arg happens to end with the
    // derived target path ("...see docs/agents-summary.md"). Under a naive
    // all-args suffix scan this would falsely report agents-summary.md as
    // produced. Path-candidate extraction must be restricted to path-like keys.
    const steps = [
      action(
        "file-write",
        {
          path: "/home/user/apps/examples/other.md",
          content: "preamble — see docs/agents-summary.md",
        },
        "tc1",
      ),
      obs("file-write", true, "tc1"),
    ];
    const r = verify([artifactProduced("./agents-summary.md")], steps);
    expect(r.unmet).toHaveLength(1);
  }, 15000);

  it("no false-met: a non-boundary basename collision (my-out.md vs out.md) does NOT match", () => {
    // The written file ends with "...my-out.md"; the target is "out.md". Without a
    // path-segment boundary ("/" before the target) this must NOT match.
    const steps = [
      action(
        "file-write",
        { path: "/home/user/apps/examples/my-out.md", content: "x" },
        "tc1",
      ),
      obs("file-write", true, "tc1"),
    ];
    const r = verify([artifactProduced("./out.md")], steps);
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
