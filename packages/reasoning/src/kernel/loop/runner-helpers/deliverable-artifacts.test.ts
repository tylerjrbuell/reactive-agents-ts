import { describe, it, expect } from "bun:test";
import { resolveProduces } from "@reactive-agents/tools";
import {
  initialKernelState,
  transitionState,
} from "../../state/kernel-state.js";
import { makeStep } from "../../capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../utils/observation-helpers.js";
import type { ReasoningStep } from "../../../types/index.js";
import { deriveArtifactEntries } from "../../ledger/artifact-projection.js";
import { appendEntries } from "../../ledger/run-ledger.js";
import { countArtifacts, countDeliverableCandidates } from "./deliverable.js";

function callSteps(id: string, name: string, args: Record<string, unknown>): ReasoningStep[] {
  const action = makeStep("action", `${name}(x)`, {
    toolCall: { id, name, arguments: args },
    toolUsed: name,
  });
  const obs = makeStep("observation", `result-for-${id}`, {
    toolCallId: id,
    observationResult: makeObservationResult(name, true, `result-for-${id}`),
  });
  return [action, obs];
}

const base = () =>
  initialKernelState({ strategy: "reactive", kernelType: "reactive", maxIterations: 10 });

/** hasDeliverable, as the abstention gate now computes it (union, runner.ts). */
const hasDeliverable = (s: ReturnType<typeof base>): boolean =>
  countArtifacts(s) > 0 || countDeliverableCandidates(s) > 0;

describe("countArtifacts — reads real artifact ledger entries (audit 01-F1 item 7)", () => {
  it("is 0 on a fresh state and on a research (data-only) run", () => {
    expect(countArtifacts(base())).toBe(0);
    const research = transitionState(base(), {
      steps: callSteps("w1", "web-search", { query: "x" }),
      toolsUsed: new Set(["web-search"]),
    });
    // No file artifact — but the run DID gather evidence.
    expect(countArtifacts(research)).toBe(0);
    expect(countDeliverableCandidates(research)).toBeGreaterThan(0);
  });

  it("counts real file artifacts (file-write + code-execute), NOT any success", () => {
    const writeSteps = [
      ...callSteps("c1", "file-write", { path: "a.md", content: "x" }),
      ...callSteps("c2", "code-execute", { code: "require('fs').writeFileSync('b.json','{}')" }),
      ...callSteps("c3", "web-search", { query: "irrelevant" }),
    ];
    let s = transitionState(base(), {
      steps: writeSteps,
      toolsUsed: new Set(["file-write", "code-execute", "web-search"]),
    });
    s = { ...s, ledger: appendEntries(s.ledger, deriveArtifactEntries(writeSteps, resolveProduces, 0)) };
    // 2 real artifacts (a.md, b.json) — the web-search is NOT counted as one.
    expect(countArtifacts(s)).toBe(2);
    // countDeliverableCandidates still counts all 3 successful observations.
    expect(countDeliverableCandidates(s)).toBe(3);
  });
});

describe("abstention hasDeliverable union — non-artifact tasks unaffected (pin)", () => {
  it("empty run → no deliverable (both signals 0)", () => {
    expect(hasDeliverable(base())).toBe(false);
  });

  it("research run (evidence, no file) → still has a deliverable (fallback preserved)", () => {
    const research = transitionState(base(), {
      steps: callSteps("w1", "web-search", { query: "x" }),
      toolsUsed: new Set(["web-search"]),
    });
    expect(hasDeliverable(research)).toBe(true);
  });

  it("artifact run → has a deliverable via the artifact signal", () => {
    const writeSteps = callSteps("c1", "file-write", { path: "a.md", content: "x" });
    let s = transitionState(base(), { steps: writeSteps, toolsUsed: new Set(["file-write"]) });
    s = { ...s, ledger: appendEntries(s.ledger, deriveArtifactEntries(writeSteps, resolveProduces, 0)) };
    expect(hasDeliverable(s)).toBe(true);
  });
});
