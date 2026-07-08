import { describe, it, expect } from "bun:test";
import { resolveProduces } from "@reactive-agents/tools";
import { makeStep } from "../capabilities/sense/step-utils.js";
import { makeObservationResult } from "../utils/observation-helpers.js";
import type { ReasoningStep } from "../../types/index.js";
import { deriveArtifactEntries, artifacts } from "./artifact-projection.js";
import { appendEntries } from "./run-ledger.js";
import { initialKernelState, transitionState } from "../state/kernel-state.js";

/** Build an action+observation step pair as act.ts emits them. */
function callSteps(
  id: string,
  name: string,
  args: Record<string, unknown>,
  success = true,
): ReasoningStep[] {
  const action = makeStep("action", `${name}(${JSON.stringify(args)})`, {
    toolCall: { id, name, arguments: args },
    toolUsed: name,
  });
  const obs = makeStep("observation", `result-for-${id}`, {
    toolCallId: id,
    observationResult: makeObservationResult(name, success, `result-for-${id}`),
  });
  return [action, obs];
}

describe("deriveArtifactEntries — rw-8 witness (exactly the written files)", () => {
  it("enumerates exactly the 3 file-writes as artifact entries with correct paths", () => {
    const steps = [
      ...callSteps("c1", "file-write", { path: "./types.ts", content: "export type T = {}" }),
      ...callSteps("c2", "file-write", { path: "./generate.ts", content: "gen" }),
      ...callSteps("c3", "file-write", { path: "./validate.ts", content: "val" }),
    ];
    const entries = deriveArtifactEntries(steps, resolveProduces, 0);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => (e as { path: string }).path)).toEqual([
      "./types.ts",
      "./generate.ts",
      "./validate.ts",
    ]);
    for (const e of entries) {
      expect(e.kind).toBe("artifact");
      expect((e as { op: string }).op).toBe("write");
      expect((e as { toolCallId?: string }).toolCallId).toBeDefined();
      expect(typeof (e as { digest?: string }).digest).toBe("string");
    }
  });
});

describe("deriveArtifactEntries — the 01-F1 fix (code-execute writes now visible)", () => {
  it("a code-execute file write produces an artifact entry (previously invisible)", () => {
    const steps = callSteps("x1", "code-execute", {
      code: "const fs=require('fs'); fs.writeFileSync('out/data.json', JSON.stringify({a:1}));",
    });
    const entries = deriveArtifactEntries(steps, resolveProduces, 3);
    expect(entries).toHaveLength(1);
    expect((entries[0] as { path: string }).path).toBe("out/data.json");
    expect((entries[0] as { op: string }).op).toBe("write");
    expect((entries[0] as { toolCallId?: string }).toolCallId).toBe("x1");
  });

  it("a shell-execute redirect produces an artifact entry", () => {
    const steps = callSteps("s1", "shell-execute", { command: "echo hi > report.txt" });
    const entries = deriveArtifactEntries(steps, resolveProduces, 1);
    expect(entries.map((e) => (e as { path: string }).path)).toEqual(["report.txt"]);
  });
});

describe("deriveArtifactEntries — negatives (no false artifacts)", () => {
  it("a read-only tool call produces NO artifact entry", () => {
    const steps = callSteps("r1", "file-read", { path: "./types.ts" });
    expect(deriveArtifactEntries(steps, resolveProduces, 0)).toEqual([]);
  });

  it("a data tool (web-search) produces NO artifact entry", () => {
    const steps = callSteps("w1", "web-search", { query: "save report.md to disk" });
    expect(deriveArtifactEntries(steps, resolveProduces, 0)).toEqual([]);
  });

  it("a FAILED file-write produces NO artifact entry (false-UNMET is safe)", () => {
    const steps = callSteps("f1", "file-write", { path: "./x.md", content: "y" }, false);
    expect(deriveArtifactEntries(steps, resolveProduces, 0)).toEqual([]);
  });

  it("pure code-execute (no fs) produces NO artifact entry", () => {
    const steps = callSteps("p1", "code-execute", { code: "return 2 + 2;" });
    expect(deriveArtifactEntries(steps, resolveProduces, 0)).toEqual([]);
  });
});

describe("act.ts final-transition composition (artifacts via patch.ledger + chokepoint)", () => {
  it("resulting state.ledger carries the artifact entry AND the step-derived tool entries, dense seqs", () => {
    // Mirror act.ts: state.steps grow with the round's steps; artifacts are
    // seeded via patch.ledger; the transitionState chokepoint then appends the
    // step-derived tool-invocation/tool-result entries on top.
    const state = initialKernelState({
      strategy: "reactive",
      kernelType: "reactive",
      maxIterations: 10,
    });
    const roundSteps = callSteps("c1", "file-write", { path: "report.md", content: "hi" });
    const artifactInputs = deriveArtifactEntries(roundSteps, resolveProduces, state.iteration + 1);
    const next = transitionState(state, {
      steps: roundSteps,
      ledger: appendEntries(state.ledger, artifactInputs),
      iteration: state.iteration + 1,
    });

    // Exactly one artifact, correct path, linked to the call.
    expect(next.ledger).toBeDefined();
    const ledger = next.ledger ?? [];
    const arts = artifacts(ledger);
    expect(arts.map((a) => a.path)).toEqual(["report.md"]);
    expect(arts[0]!.toolCallId).toBe("c1");

    // The chokepoint still emitted the tool-invocation + tool-result for the round.
    const kinds = ledger.map((e) => e.kind);
    expect(kinds).toContain("tool-invocation");
    expect(kinds).toContain("tool-result");
    expect(kinds).toContain("artifact");

    // seq is dense + monotonic across the whole ledger (no collisions).
    expect(ledger.map((e) => e.seq)).toEqual(ledger.map((_, i) => i));
  });
});

describe("artifacts() query", () => {
  it("filters the ledger to artifact entries with assigned seq", () => {
    const steps = [
      ...callSteps("c1", "file-write", { path: "a.md", content: "1" }),
      ...callSteps("c2", "file-read", { path: "a.md" }),
      ...callSteps("c3", "file-write", { path: "b.md", content: "2" }),
    ];
    const ledger = appendEntries([], deriveArtifactEntries(steps, resolveProduces, 0));
    const found = artifacts(ledger);
    expect(found.map((a) => a.path)).toEqual(["a.md", "b.md"]);
    expect(found.every((a) => a.kind === "artifact")).toBe(true);
    expect(found.map((a) => a.seq)).toEqual([0, 1]);
  });
});
