// Plan 9 Phase 4 stage 1 — pins for the kernel turn as an operation list
// (src/kernel/loop/turn-operations.ts). The order IS behavior: a pass runs the
// operations in KERNEL_TURN_OPERATIONS order, so a reorder must fail here, not
// slip through as a refactor. The ending set and the terminate() census are
// ratchets toward the Phase 4 exit target: the exit gate is the only operation
// that ends a run and the only caller of terminate().

import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  KERNEL_TURN_OPERATIONS,
  openTurnScope,
  runKernelTurn,
  type TurnOperation,
  type TurnOperationImpls,
  type TurnSignal,
} from "../../../src/kernel/loop/turn-operations.js";
import type { IterationCarrier, IterationConfig } from "../../../src/kernel/loop/iterate-pass.js";
import { initialKernelState, type KernelContext } from "../../../src/kernel/state/kernel-state.js";

const KERNEL_DIR = fileURLToPath(new URL("../../../src/kernel/", import.meta.url));

describe("KERNEL_TURN_OPERATIONS — the pass order", () => {
  it("is exactly this order (a reorder is a behavior change)", () => {
    expect(KERNEL_TURN_OPERATIONS.map((op) => op.name)).toEqual([
      "run-control-checkpoint",
      "iteration-start",
      "assess-pass-start",
      "recall",
      "think",
      "grounding-redirect-trace",
      "low-delta-guard",
      "auto-checkpoint",
      "scratchpad-sync",
      "reactive-observer",
      "dispatcher-early-stop",
      "dispatcher-temperature",
      "dispatcher-strategy-switch",
      "iteration-progress",
      "repeated-failure-redirect",
      "execution-lane",
      "stall",
      "ics-nudge",
      "oracle-gate",
      "primary-tools-exit",
      "loop-detection",
      "required-tools-guard",
      "post-iteration-snapshot",
      "learn-write",
    ]);
  });

  it("writes every pass-local slot before an operation reads it", () => {
    const written = new Set<string>();
    for (const op of KERNEL_TURN_OPERATIONS) {
      for (const slot of op.reads) {
        if (slot.startsWith("pass.")) expect(`${op.name} reads ${slot}: ${written.has(slot)}`).toBe(`${op.name} reads ${slot}: true`);
      }
      for (const slot of op.writes) written.add(slot);
    }
  });

  it("only these operations may end the run (ratchet: shrink toward the exit gate alone)", () => {
    expect(KERNEL_TURN_OPERATIONS.filter((op) => op.ends).map((op) => op.name)).toEqual([
      "run-control-checkpoint",
      "assess-pass-start",
      "think",
      "low-delta-guard",
      "dispatcher-early-stop",
      "dispatcher-strategy-switch",
      "repeated-failure-redirect",
      "stall",
      "oracle-gate",
      "loop-detection",
      "required-tools-guard",
    ]);
  });
});

describe("runKernelTurn", () => {
  const carrier = (): IterationCarrier => ({
    state: initialKernelState({ maxIterations: 5, strategy: "reactive", kernelType: "react" }),
    currentInput: { task: "t" },
    currentOptions: { maxIterations: 5, strategy: "reactive" },
    currentContext: {} as KernelContext,
    prevActionCount: 0, prevStepCount: 0, prevStepCountForLearn: 0, prevDecisionLogCountForLearn: 0,
    prevArtifactCount: 0, consecutiveStalled: 0, requiredToolRedirects: 0, requiredToolNudgeCount: 0,
    failureRecoveryRedirects: 0, switchCount: 0, triedStrategies: [], autoCheckpointed: false,
    mutableScratchpad: new Map(),
  });
  const recordingOps = (calls: string[], stopAt?: { name: string; signal: TurnSignal }): TurnOperationImpls => {
    const ops: Record<string, TurnOperation> = {};
    for (const { name } of KERNEL_TURN_OPERATIONS) {
      ops[name] = () => {
        calls.push(name);
        return Effect.succeed(stopAt?.name === name ? stopAt.signal : "next");
      };
    }
    return ops as TurnOperationImpls;
  };
  const cfg = {} as IterationConfig;

  it("runs every operation in list order and falls through to continue", async () => {
    const calls: string[] = [];
    const signal = await Effect.runPromise(runKernelTurn(openTurnScope(carrier()), cfg, recordingOps(calls)));
    expect(signal).toBe("continue");
    expect(calls).toEqual(KERNEL_TURN_OPERATIONS.map((op) => op.name));
  });

  it("stops at the first operation that ends the pass and returns its signal", async () => {
    const calls: string[] = [];
    const signal = await Effect.runPromise(
      runKernelTurn(openTurnScope(carrier()), cfg, recordingOps(calls, { name: "stall", signal: "break" })),
    );
    expect(signal).toBe("break");
    expect(calls.at(-1)).toBe("stall");
    expect(calls).not.toContain("ics-nudge");
  });
});

// A real terminate() call: not a method, not a comment line, not the definition.
const TERMINATE_CALL = /(?<![.\w])terminate\(/;
const isCommentLine = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

function terminateCallCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  const files = readdirSync(KERNEL_DIR, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  for (const rel of files) {
    const n = readFileSync(join(KERNEL_DIR, rel), "utf8")
      .split("\n")
      .filter((l) => TERMINATE_CALL.test(l) && !isCommentLine(l) && !l.includes("export function terminate("))
      .length;
    if (n > 0) counts[rel.split("\\").join("/")] = n;
  }
  return counts;
}

describe("terminate() ownership (Phase 4 exit: only the exit gate calls terminate())", () => {
  // Ceilings, not targets: a count may drop (then lower it here), never grow,
  // and a file not listed may not start calling terminate(). New run-ending
  // behavior goes through the exit gate (proposeGuardExit / proposeCapExit).
  const CEILINGS: Record<string, number> = {
    "loop/exit-gate.ts": 2, // the owner
    "loop/iterate-pass.ts": 1, // zero-evidence stand-down (assess-pass-start)
    "loop/iterate-control-plane-seams.ts": 3,
    "loop/iterate-run-ctl-checkpoint.ts": 1,
    "loop/runner-helpers/loop-resolution.ts": 1,
    "loop/runner-helpers/pace-terminal.ts": 1,
    "loop/runner-post-loop-deliverable.ts": 1,
    "loop/runner.ts": 2,
    "capabilities/act/act.ts": 2,
    "capabilities/reason/dispatch-think-response.ts": 1,
    "capabilities/reason/unresolved-tool-call.ts": 1,
  };

  it("the turn-operation module never ends a run directly", () => {
    expect(terminateCallCounts()["loop/turn-operations.ts"]).toBeUndefined();
  });

  it("no kernel file exceeds its terminate() ceiling and no new caller appears", () => {
    const over = Object.entries(terminateCallCounts())
      .filter(([file, n]) => n > (CEILINGS[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} > ${CEILINGS[file] ?? 0}`);
    expect(over).toEqual([]);
  });
});
