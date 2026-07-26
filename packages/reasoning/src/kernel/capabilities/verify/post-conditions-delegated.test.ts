// Run: bun test packages/reasoning/src/kernel/capabilities/verify/post-conditions-delegated.test.ts
//
// A DELEGATED deliverable counts as produced (2026-07-26).
//
// The post-condition spine is the run's success authority. It judged
// ArtifactProduced from `steps` — the CURRENT agent's own steps. An orchestrator
// that delegates the write has only `spawn-agent` in its steps; the child's
// `file-write` exists solely in the run-scoped ledger, merged under
// `sub-agent:<name>` by Wave C.2 slice 2.
//
// So a run that did exactly what it was asked was refused success. Observed live
// (gemma4:e4b, 3 fanned-out sub-agents):
//
//   success: false
//   error: "Post-condition(s) unmet at termination: You still must: write the
//           file ./cryptos.md."
//
// while ./cryptos.md existed on disk with the correct table AND
// `receipt.toolsUsed` already listed `file-write`. The same script SUCCEEDED on
// a re-run where the model happened to write the file itself instead of
// delegating — the tell that the gate keys on WHO did the work, not whether it
// was done.
//
// RED-ON-CUT: drop the `entriesOfKind(ledger, "artifact")` scan from
// isArtifactProduced and the delegated cases below fail.
import { describe, expect, it } from "bun:test";
import { verify, artifactProduced, toolCalled } from "./post-conditions.js";
import type { RunLedger } from "../../ledger/run-ledger.js";
import { makeStep } from "../sense/step-utils.js";
import { makeObservationResult } from "../../utils/observation-helpers.js";

/** A parent that delegated: its OWN steps contain only the spawn. */
const parentStepsOnlySpawn = [
  makeStep("action", "[ACT] spawn-agent", {
    toolCall: { id: "tc-1", name: "spawn-agent", arguments: { name: "writer" } },
  }),
  makeStep("observation", "ok", {
    toolCallId: "tc-1",
    observationResult: makeObservationResult("spawn-agent", true, "ok"),
  }),
];

/** The child's write, as it arrives in the parent's run-scoped ledger. */
const ledgerWithDelegatedArtifact = [
  { kind: "tool-invocation", seq: 0, iteration: 0, toolName: "spawn-agent", toolCallId: "tc-1" },
  { kind: "tool-result", seq: 1, iteration: 0, success: true, preview: "", toolName: "spawn-agent", toolCallId: "tc-1" },
  {
    kind: "artifact", seq: 2, iteration: 0, op: "write",
    path: "/home/user/project/cryptos.md",
    toolCallId: "tc-child-1",
    pass: "sub-agent:writer",
  },
] satisfies RunLedger;

describe("ArtifactProduced credits a delegated write", () => {
  it("is UNMET from the parent's steps alone (the defect)", () => {
    const r = verify([artifactProduced("./cryptos.md")], parentStepsOnlySpawn);
    expect(r.unmet).toHaveLength(1);
  });

  it("is MET once the run-scoped ledger is consulted", () => {
    const r = verify([artifactProduced("./cryptos.md")], parentStepsOnlySpawn, {
      ledger: ledgerWithDelegatedArtifact,
    });
    expect(r.unmet).toHaveLength(0);
    expect(r.met).toHaveLength(1);
  });

  // The no-false-met DBC is the whole point of this spine — a success authority
  // must never credit an artifact that was not produced.
  it("does NOT credit a different path", () => {
    const r = verify([artifactProduced("./other.md")], parentStepsOnlySpawn, {
      ledger: ledgerWithDelegatedArtifact,
    });
    expect(r.unmet).toHaveLength(1);
  });

  it("does NOT credit a basename collision across a non-separator boundary", () => {
    const r = verify([artifactProduced("cryptos.md")], parentStepsOnlySpawn, {
      ledger: [
        { kind: "artifact", seq: 0, iteration: 0, op: "write", path: "/home/user/my-cryptos.md" },
      ] satisfies RunLedger,
    });
    expect(r.unmet).toHaveLength(1);
  });

  it("does NOT credit a DELETE of the path as production", () => {
    const r = verify([artifactProduced("./cryptos.md")], parentStepsOnlySpawn, {
      ledger: [
        { kind: "artifact", seq: 0, iteration: 0, op: "delete", path: "/home/user/project/cryptos.md" },
      ] satisfies RunLedger,
    });
    expect(r.unmet).toHaveLength(1);
  });

  // Absent ledger must behave exactly as before — every existing caller/test.
  it("is unchanged when no ledger is supplied", () => {
    const r = verify([artifactProduced("./cryptos.md")], parentStepsOnlySpawn, {});
    expect(r.unmet).toHaveLength(1);
  });
});

// ToolCalled now reads the ledger FIRST (2026-07-26), which is what makes the
// spine's two conditions read the same substrate. `delegatedToolsUsed` — the
// older, hand-plumbed channel below — is one delegation level deep by
// construction: it carries the names off the CHILD's own result, so a
// grandchild's tools never reach the top-level parent through it. The merged
// ledger has no such ceiling.
//
// RED-ON-CUT: drop the `entriesOfKind(ledger, "tool-result")` scan from
// isToolCalled and the grandchild case below fails.
describe("ToolCalled reads the run-scoped ledger", () => {
  // The parent's own steps hold ONLY the spawn, with NO delegatedToolsUsed —
  // the shape a two-level delegation actually produces at the top.
  const parentStepsNoDelegationHint = [
    makeStep("action", "[ACT] spawn-agent", {
      toolCall: { id: "tc-1", name: "spawn-agent", arguments: {} },
    }),
    makeStep("observation", "ok", {
      toolCallId: "tc-1",
      observationResult: makeObservationResult("spawn-agent", true, "ok"),
    }),
  ];

  const grandchildLedger = [
    { kind: "tool-invocation", seq: 0, iteration: 0, toolName: "spawn-agent", toolCallId: "tc-1" },
    { kind: "tool-result", seq: 1, iteration: 0, success: true, preview: "", toolName: "spawn-agent", toolCallId: "tc-1" },
    {
      kind: "tool-result", seq: 2, iteration: 0, success: true, preview: "",
      toolName: "web-search", toolCallId: "tc-gc-1", pass: "sub-agent:researcher",
    },
  ] satisfies RunLedger;

  it("CONTROL: unmet from the parent's steps alone (no delegation hint)", () => {
    expect(verify([toolCalled("web-search")], parentStepsNoDelegationHint).unmet).toHaveLength(1);
  });

  it("credits a tool a NESTED sub-agent used", () => {
    const r = verify([toolCalled("web-search")], parentStepsNoDelegationHint, {
      ledger: grandchildLedger,
    });
    expect(r.unmet).toHaveLength(0);
    expect(r.met).toHaveLength(1);
  });

  it("does NOT credit a tool absent from the ledger", () => {
    expect(
      verify([toolCalled("git-cli")], parentStepsNoDelegationHint, { ledger: grandchildLedger })
        .unmet,
    ).toHaveLength(1);
  });

  it("does NOT credit a FAILED ledger tool-result", () => {
    const r = verify([toolCalled("web-search")], parentStepsNoDelegationHint, {
      ledger: [
        {
          kind: "tool-result", seq: 0, iteration: 0, success: false, preview: "",
          toolName: "web-search", toolCallId: "tc-x",
        },
      ] satisfies RunLedger,
    });
    expect(r.unmet).toHaveLength(1);
  });
});

// The pre-ledger channel: `delegatedToolsUsed` on the spawn observation. Still
// the fallback for callers that supply no ledger, so it stays pinned — if it
// regresses, those callers silently start failing delegated runs.
describe("ToolCalled credits a delegated call", () => {
  const spawnWithDelegatedTools = [
    makeStep("action", "[ACT] spawn-agent", {
      toolCall: { id: "tc-1", name: "spawn-agent", arguments: {} },
    }),
    makeStep("observation", "ok", {
      toolCallId: "tc-1",
      observationResult: makeObservationResult("spawn-agent", true, "ok", {
        delegatedToolsUsed: ["file-write"],
      }),
    }),
  ];

  it("counts a tool the sub-agent used", () => {
    expect(verify([toolCalled("file-write")], spawnWithDelegatedTools).unmet).toHaveLength(0);
  });

  it("does not credit a tool nobody used", () => {
    expect(verify([toolCalled("git-cli")], spawnWithDelegatedTools).unmet).toHaveLength(1);
  });
});
